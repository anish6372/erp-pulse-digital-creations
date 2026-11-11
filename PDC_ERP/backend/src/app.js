const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { UPLOADS, router: uploadsRouter } = require('./routes/uploads.routes');
const authRoutes = require('./routes/auth.routes');
const bootstrapRoutes = require('./routes/bootstrap.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const workRoutes = require('./routes/work.routes');
const tasksRoutes = require('./routes/tasks.routes');
const reportsRoutes = require('./routes/reports.routes');
const leavesRoutes = require('./routes/leaves.routes');
const payrollRoutes = require('./routes/payroll.routes');
const usersRoutes = require('./routes/users.routes');
const clientsRoutes = require('./routes/clients.routes');
const chatRoutes = require('./routes/chat.routes');
const groupsRoutes = require('./routes/groups.routes');
const meetingsRoutes = require('./routes/meetings.routes');
const deliverablesRoutes = require('./routes/deliverables.routes');
const marketingRoutes = require('./routes/marketing.routes');
const instagramRoutes = require('./routes/instagram.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const atsRoutes = require('./routes/ats.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const adminRoutes = require('./routes/admin.routes');
const settingsRoutes = require('./routes/settings.routes');
const exportRoutes = require('./routes/export.routes');
const leadsRoutes = require('./routes/leads.routes');
const contentRoutes = require('./routes/content.routes');
const clientReportRoutes = require('./routes/clientreport.routes');
const prospectRoutes = require('./routes/prospect.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Number of reverse proxies in front of the API (Nginx = 1; host Nginx + container Nginx = 2).
  // Without it every client appears as the proxy's IP, so the login rate limit is shared by everyone.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  app.use(helmet({ contentSecurityPolicy: false }));

  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
  app.use(cors({ origin: corsOrigins, credentials: false }));

  app.use(express.json({ limit: '15mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));

  app.use('/api', uploadsRouter);
  app.use('/api', authRoutes);
  app.use('/api', bootstrapRoutes);
  app.use('/api', attendanceRoutes);
  app.use('/api', workRoutes);
  app.use('/api', tasksRoutes);
  app.use('/api', reportsRoutes);
  app.use('/api', leavesRoutes);
  app.use('/api', payrollRoutes);
  app.use('/api', usersRoutes);
  app.use('/api', clientsRoutes);
  app.use('/api', chatRoutes);
  app.use('/api', groupsRoutes);
  app.use('/api', meetingsRoutes);
  app.use('/api', deliverablesRoutes);
  app.use('/api', marketingRoutes);
  app.use('/api', instagramRoutes);
  app.use('/api', notificationsRoutes);
  app.use('/api', atsRoutes);
  app.use('/api', onboardingRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', settingsRoutes);
  app.use('/api', exportRoutes);
  app.use('/api', leadsRoutes);
  app.use('/api', contentRoutes);
  app.use('/api', clientReportRoutes);
  app.use('/api', prospectRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: process.env.NODE_ENV === 'development' ? String(err) : undefined });
  });

  return app;
}

module.exports = { createApp };
