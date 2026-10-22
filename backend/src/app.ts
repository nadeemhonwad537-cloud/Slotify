import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFound, ok } from './middleware/error';
import { csrfProtection } from './middleware/security';
import { adminRouter } from './routes/admin';
import { assignmentsRouter } from './routes/assignments';
import { authRouter } from './routes/auth';
import { masterdataRouter } from './routes/masterdata';
import { facultyAvailabilityRouter, submissionsRouter } from './routes/submissions';
import { timetableRouter } from './routes/timetable';
import { usersRouter } from './routes/users';
import { workloadImportsRouter } from './routes/workloadImports';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(csrfProtection);

  app.get('/api/health', (_req, res) => res.json(ok({ status: 'up' })));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/masterdata', masterdataRouter);
  app.use('/api/faculty-submissions', submissionsRouter);
  app.use('/api/faculty-availability', facultyAvailabilityRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/workload-imports', workloadImportsRouter);
  app.use('/api/timetable', timetableRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
