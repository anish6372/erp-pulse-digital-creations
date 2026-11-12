require('dotenv').config();
const http = require('node:http');
const { createApp } = require('./app');
const { startAutomationSweep } = require('./jobs/automationSweep');
const { initSocket } = require('./realtime/socket');
const jobs = require('./utils/jobs');

const app = createApp();
const server = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());

initSocket(server, corsOrigins);
startAutomationSweep();
jobs.startWorker(); // processes background jobs (Hunts, bulk import, geocoding) when Redis is configured

server.listen(port, host, () => {
  console.log(`PDC ERP API running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await jobs.closeJobs().catch(() => {});
    process.exit(0);
  });
}
