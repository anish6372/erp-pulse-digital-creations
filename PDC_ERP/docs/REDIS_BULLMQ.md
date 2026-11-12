# Redis + BullMQ - background jobs, shared rate limits, caching

## The problem this solves

Three Client Hunter actions took a long time inside a single HTTP request:

| Action | Why it is slow |
| --- | --- |
| Run a Hunt | Calls Apify, then audits each business's website and may draft with AI (up to ~2.5 min) |
| Bulk CSV import | Audits a website + scores + optionally AI-drafts every row |
| Locate leads | OpenStreetMap allows ~1 request/second |

A long request ties up the browser, can hit proxy time-outs, and if the page is refreshed or the
server restarts the work is lost. Rate-limit counters also lived in process memory, so every
deploy reset them.

## The 30-second explanation (interview version)

> "Long-running work now runs in a background queue. The API validates the request, puts a job in
> Redis through BullMQ, and returns 202 with a job id immediately; a worker processes it and the
> browser polls for progress. Redis also stores the rate-limit counters, so limits survive
> deploys, and caches the dashboard numbers. I designed it to degrade gracefully: if Redis is
> missing or goes down, every piece falls back to an in-process version and the app keeps
> working - I tested that by stopping Redis under a running server."

## Flow of one job (bulk import)

```
Browser                      API (Express)                  Redis                 Worker (same process)
  | POST /hunter/leads/bulk     |                              |                          |
  |---------------------------->| validate (<=200 rows)        |                          |
  |                             |--- queue.add('bulk-import') ->| stored as job #12        |
  |<-- 202 { job_id: "12" } ----|                              |                          |
  |                             |                              |--- job #12 ------------->| for each row:
  | GET /hunter/jobs/12 (every 1.2 s)                          |<-- updateProgress -------|   audit, score, draft
  |---------------------------->|--- getJob(12) -------------->|                          |
  |<-- {state:"active", progress:{done:3,total:50}} ---------- |                          |
  | ...                                                        |<-- returnvalue ----------|
  |<-- {state:"completed", result:{added,skipped,drafted}} ----|                          |
```

## What each file does

| File | Role |
| --- | --- |
| `backend/src/utils/redis.js` | Creates the Redis connections only if `REDIS_URL` is set. `isReady()` says whether Redis is usable *right now*; `withTimeout()` makes sure a Redis call can never hang a request. Two connections: one for cache/limits, one for BullMQ (BullMQ needs `maxRetriesPerRequest: null`). |
| `backend/src/utils/jobs.js` | The queue. `register(name, handler)`, `enqueue(name, data)`, `getJob(id)`, `startWorker()`. Uses BullMQ when Redis is ready, otherwise a tiny in-process queue with the same interface. |
| `backend/src/utils/limiter.js` | `makeLimiter()` replaces direct `express-rate-limit` use everywhere. With Redis the counters are stored there; otherwise memory. |
| `backend/src/utils/cache.js` | `cached(key, ttl, compute)` read-through cache and `invalidate(prefix)`. |
| `backend/src/routes/hunter.routes.js` | Job handlers (`bulk-import`, `locate`, `hunt-run`), thin routes that return 202, and `GET /hunter/jobs/:id` for polling. |
| `frontend/src/lib/api.js` | `runJob(path, body, onProgress)` - starts a job and polls until it finishes. |
| `docker-compose.yml` | Adds the `redis` service (append-only file, 64 MB cap, no public port). |

## Key ideas, explained

**Why a queue.** It decouples "accept the work" from "do the work". The request returns in
milliseconds, work survives a page refresh, only one heavy job runs at a time (`concurrency: 1`),
and progress is visible.

**BullMQ.** A Node job queue stored in Redis. `Queue.add` puts a job in; a `Worker` pulls jobs
and runs your handler; `job.updateProgress` and the handler's return value are stored on the job
so any request can read them. Finished jobs are kept for an hour (`removeOnComplete`).

**`attempts: 1` on purpose.** A Hunt costs real money (Apify) and a retry could create duplicate
leads, so failed jobs are not retried automatically. If the server dies mid-job, BullMQ detects
the "stalled" job and resumes it once; handlers are written to be safe to re-run (the bulk import
and Hunt skip businesses that already exist; the geocoder remembers which leads it tried).

**Polling, not websockets.** Simple, works behind nginx, and a job id can be checked after a
refresh. The client tolerates a few failed polls before giving up.

**Authorization.** `GET /hunter/jobs/:id` only returns a job to the person who started it, or an
admin.

**Rate limits in Redis.** `rate-limit-redis` keeps the counters under `erp:rl:*`, so a deploy no
longer resets everyone's limits. `passOnStoreError` makes the limiter fail *open* if Redis is
down, so an outage never blocks logins (limits are simply not enforced until it is back).

**Caching.** The Client Hunter dashboard and market breakdown are cached for 15 seconds under
`erp:cache:hunter:*`. Any POST/PUT/DELETE in the module clears them, via one middleware. I cache
the numbers, not per-user pages, so there is no risk of showing someone else's data.

**Graceful degradation (the part worth stressing).**
- No `REDIS_URL` -> in-process cache, queue and limiter (local development).
- `REDIS_URL` set but Redis down -> `isReady()` is false, so every call goes straight to the
  fallback with no waiting; when Redis returns it is used again automatically.
- Found and fixed during testing: the first version waited on Redis time-outs when it was down, so
  health checks and enqueue hung. Adding the `isReady()` check plus `withTimeout()` fixed it.

## How it was tested

Against a real local Redis (Docker): enqueue and complete a bulk-import job with progress; cache
and rate-limit keys appear in Redis; the dashboard cache is cleared by a write; a job survives a
backend restart mid-run; with no Redis and with an unreachable Redis the same endpoints still
answer in ~0.2 s and jobs run in-process; stopping and restarting Redis under a running backend
degrades and then recovers; and a browser run of a CSV import shows "Queued…" then the result with
skipped rows and reasons.

## Honest limitations

- The worker runs inside the API process (one container). Fine at this size; at larger scale it
  would be a separate worker service.
- If Redis is down when a job is enqueued, that job runs in-process and is lost on a restart.
- Rate limits are not enforced during a Redis outage (fail-open by design).
- Cached dashboard numbers can be up to 15 seconds stale if data changes outside this module.

## Questions you might be asked

- *Why BullMQ rather than Kafka/RabbitMQ/SQS?* Single Node app, small volume, and Redis is
  already needed for limits and cache; BullMQ gives retries, progress and persistence with no
  extra infrastructure.
- *Why not just `setTimeout` or run it in the request?* Request time-outs, lost work on restart,
  no progress, and no concurrency control.
- *What happens if the server crashes mid-job?* BullMQ marks it stalled and resumes it; handlers
  are idempotent so a re-run does not duplicate data.
- *What if Redis goes down?* The app keeps working on in-process fallbacks; shown by test.
- *Why a 64 MB cap and `noeviction`?* The instance has 1 GB of RAM; BullMQ must never have queued
  jobs evicted, and the data here is tiny.
