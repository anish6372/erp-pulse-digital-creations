// Background jobs for work that takes too long for one HTTP request (Hunts, bulk CSV import,
// geocoding). A route calls enqueue() and returns 202 + a job id straight away; the browser
// polls GET /api/hunter/jobs/:id for progress.
//
//   With Redis  -> BullMQ: the job is stored in Redis, a Worker processes it (one at a time),
//                  progress/result are kept for an hour, and queued jobs survive a restart.
//   Without     -> a small in-process queue with the same interface, so local dev and a
//                  Redis outage still work (jobs are then lost if the process restarts).
//
// Handlers are registered by name:  register('hunt-run', async (data, ctx) => result)
// where ctx.progress({ done, total, message }) reports progress.
const { Queue, Worker } = require('bullmq');
const { getBullConnection, isEnabled, isReady, withTimeout } = require('./redis');

const QUEUE_NAME = 'erp-jobs';
const handlers = new Map();
let queue = null;
let worker = null;

const register = (name, fn) => handlers.set(name, fn);

// ---------- in-process fallback ----------
const memJobs = new Map(); // id -> { id, name, data, state, progress, result, error, created }
let memChain = Promise.resolve();
let memSeq = 0;

function memEnqueue(name, data) {
  const id = 'm' + ++memSeq + '-' + Date.now().toString(36);
  const job = { id, name, data, state: 'waiting', progress: null, result: null, error: '', created: Date.now() };
  memJobs.set(id, job);
  memChain = memChain.then(async () => {
    job.state = 'active';
    try {
      job.result = await handlers.get(name)(data, { progress: (p) => (job.progress = p) });
      job.state = 'completed';
    } catch (e) {
      job.error = e.message || 'Job failed';
      job.state = 'failed';
    }
    setTimeout(() => memJobs.delete(id), 60 * 60 * 1000).unref();
  });
  return id;
}

// ---------- public API ----------
function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: getBullConnection() });
  return queue;
}

/** Add a job. Returns its id. `data` must be JSON-serialisable (pass userId, not a user object). */
async function enqueue(name, data) {
  if (!handlers.has(name)) throw new Error('Unknown job: ' + name);
  if (!isEnabled() || !isReady()) return memEnqueue(name, data);
  try {
    const job = await withTimeout(
      getQueue().add(name, data, {
        attempts: 1, // never auto-retry: a Hunt costs money and a retry could create duplicate leads
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      }),
      3000
    );
    return String(job.id);
  } catch (e) {
    // Redis unreachable right now: still do the work in-process rather than refusing it
    return memEnqueue(name, data);
  }
}

/** Current status of a job: { id, name, state, progress, result, error, user_id } or null. */
async function getJob(id) {
  if (memJobs.has(id)) {
    const j = memJobs.get(id);
    return { id: j.id, name: j.name, state: j.state, progress: j.progress, result: j.result, error: j.error, user_id: j.data?.userId ?? null };
  }
  if (!isEnabled() || id.startsWith('m') || !isReady()) return null;
  try {
    const job = await withTimeout(getQueue().getJob(id));
    if (!job) return null;
    const state = await withTimeout(job.getState()); // waiting | active | completed | failed | delayed
    return { id: String(job.id), name: job.name, state, progress: job.progress || null, result: job.returnvalue ?? null, error: job.failedReason || '', user_id: job.data?.userId ?? null };
  } catch (e) {
    return null;
  }
}

/** Start the Worker that processes queued jobs. Call once at server start-up. */
function startWorker() {
  if (!isEnabled() || worker) return;
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const fn = handlers.get(job.name);
      if (!fn) throw new Error('No handler for job ' + job.name);
      return fn(job.data, { progress: (p) => job.updateProgress(p) });
    },
    { connection: getBullConnection(), concurrency: 1 }
  );
  worker.on('failed', (job, err) => console.error(`[jobs] ${job?.name} #${job?.id} failed: ${err.message}`));
  worker.on('error', () => {}); // connection errors are already reported once by redis.js
  console.log('[jobs] worker started (BullMQ)');
}

async function closeJobs() {
  await Promise.allSettled([worker?.close(), queue?.close()]);
}

module.exports = { register, enqueue, getJob, startWorker, closeJobs };
