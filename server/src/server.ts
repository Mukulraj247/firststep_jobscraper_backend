import express from 'express';
import path from 'path';
import http from 'http';
import { Server } from "socket.io";
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import { record, workflow, storage, auth, proxy, webhook } from './routes';
import { BrowserPool } from "./browser-management/classes/BrowserPool";
import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import cookieParser from 'cookie-parser';
import { SERVER_PORT } from "./constants/config";
import { existsSync, readdirSync } from "fs"
import { fork } from 'child_process';
import { capture } from "./utils/analytics";
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger/config';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import { processQueuedRuns, recoverOrphanedRuns } from './routes/storage';
import { reenqueueStalePendingScraperRuns } from './services/automationRun';
import { startWorkers } from './pgboss-worker';
import Run from './models/Run';
import { closeAgenda } from './queue/scraperQueue';
import { startScraperWorker, stopScraperWorker } from './workers/scraperWorker';
import { rehydrateAutomationSchedules, startAutomationScheduleWorker, stopAutomationScheduleWorker } from './services/automationScheduler';
import { closeBrowserReusePool } from './services/browserReusePool';
import rateLimit from 'express-rate-limit';

if (process.env.NODE_ENV === 'production') {
  const sess = process.env.SESSION_SECRET;
  if (!sess || sess === 'mx-session') {
    logger.log('error', 'SESSION_SECRET must be set to a strong value when NODE_ENV=production');
    process.exit(1);
  }
}

const normalizeOrigin = (urlString?: string): string => {
  if (!urlString) return 'http://localhost:5173';
  try {
    const url = new URL(urlString);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'http://localhost:5173';
  }
};

const isCrossOriginDeployment = (() => {
  try {
    const publicOrigin = normalizeOrigin(process.env.PUBLIC_URL);
    const backendOrigin = normalizeOrigin(process.env.BACKEND_URL);
    return publicOrigin !== backendOrigin;
  } catch {
    return false;
  }
})();
/** Secure cookies require HTTPS. Never pair SameSite=None with plain HTTP. */
const sessionCookieSecure = (process.env.PUBLIC_URL || '').trim().toLowerCase().startsWith('https:');
const sessionCookieSameSite: 'none' | 'lax' =
  process.env.NODE_ENV === 'production' && isCrossOriginDeployment && sessionCookieSecure
    ? 'none'
    : 'lax';

const CORS_CONFIG = {
  origin: normalizeOrigin(process.env.PUBLIC_URL),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
};

const app = express();
app.use(cors(CORS_CONFIG));
app.use(express.json());

const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/maxun',
  collectionName: 'sessions',
});

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'mx-session',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: sessionCookieSecure,
      sameSite: sessionCookieSameSite,
      maxAge: 24 * 60 * 60 * 1000,
    }
  })
);

const server = http.createServer(app);

/**
 * Globally exported singleton instance of socket.io for socket communication with the client.
 */
export let io = new Server(server, {
  cleanupEmptyChildNamespaces: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  // 100MB default is dangerous on small instances — a single buffered message can OOM.
  // Run-status events are tiny; keep a modest default, overridable for self-hosted heavy payloads.
  maxHttpBufferSize: parseInt(process.env.SOCKET_MAX_HTTP_BUFFER_BYTES || String(10 * 1024 * 1024), 10),
  transports: ['websocket', 'polling'],
  cors: CORS_CONFIG
});

/**
 * {@link BrowserPool} globally exported singleton instance for managing browsers.
 */
export const browserPool = new BrowserPool();

export const recentRecoveries = new Map<string, any[]>();

app.use(cookieParser())

app.use('/webhook', webhook);
app.use('/record', record);
app.use('/workflow', workflow);
app.use('/storage', storage);
app.use('/auth', auth);
app.use('/proxy', proxy);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX ?? 600),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

readdirSync(path.join(__dirname, 'api')).forEach((r) => {
  const route = require(path.join(__dirname, 'api', r));
  const router = route.default || route;
  if (typeof router === 'function') {
    app.use('/api', router);
  } else {
    console.error(`Error: ${r} does not export a valid router`);
  }
});

const isProduction = process.env.NODE_ENV === 'production';
const runEmbeddedWorkers = process.env.RUN_EMBEDDED_WORKERS !== 'false';
const recordingWorkerPath = path.resolve(__dirname, isProduction ? './pgboss-worker.js' : './pgboss-worker.ts');
/** Forked .ts workers must run under ts-node (same as nodemon); plain node resolves imports as ESM and breaks on Windows dev. */
const serverTsconfigPath = path.resolve(__dirname, '../tsconfig.json');
const workerForkEnv = { ...process.env, TS_NODE_PROJECT: serverTsconfigPath };

let recordingWorkerProcess: any;

/** Vite production output (projectRoot/build). Served by API for single-Droplet HTTP deploys. */
const frontendBuildPath = path.resolve(__dirname, '../../../../build');
const serveFrontend =
  process.env.SERVE_FRONTEND !== 'false' &&
  existsSync(path.join(frontendBuildPath, 'index.html'));

const isSpaAssetRequest = (reqPath: string): boolean => {
  const apiPrefixes = [
    '/api',
    '/auth',
    '/record',
    '/workflow',
    '/storage',
    '/proxy',
    '/webhook',
    '/api-docs',
    '/socket.io',
  ];
  return !apiPrefixes.some((prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`));
};

if (serveFrontend) {
  app.use(express.static(frontendBuildPath, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!isSpaAssetRequest(req.path)) return next();
    return res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
  logger.log('info', `Serving frontend from ${frontendBuildPath}`);
} else {
  app.get('/', function (req, res) {
    capture(
      'maxun-oss-server-run', {
      event: 'server_started',
    }
    );
    return res.send('Maxun server started 🚀');
  });
}

if (require.main === module) {
  const serverIntervals: NodeJS.Timeout[] = [];

  // Legacy `queued`-status poller. The Agenda scraper path uses `pending`, so this rarely
  // has work — poll less often by default to cut idle DB traffic (tunable for self-host).
  const queuedRunsPollMs = parseInt(process.env.QUEUED_RUNS_POLL_MS || '15000', 10);
  const processQueuedRunsInterval = setInterval(async () => {
    try {
      await processQueuedRuns();
    } catch (error: any) {
      logger.log('error', `Error in processQueuedRuns interval: ${error.message}`);
    }
  }, queuedRunsPollMs);
  serverIntervals.push(processQueuedRunsInterval);

  const browserPoolCleanupInterval = setInterval(() => {
    browserPool.cleanupStaleBrowserSlots();
  }, 60000);
  serverIntervals.push(browserPoolCleanupInterval);

  const stalePendingInterval = setInterval(async () => {
    try {
      await reenqueueStalePendingScraperRuns();
    } catch (error: any) {
      logger.log('error', `Error in reenqueueStalePendingScraperRuns: ${error.message}`);
    }
  }, 90_000);
  serverIntervals.push(stalePendingInterval);

  server.listen(SERVER_PORT, '0.0.0.0', async () => {
    try {
      await connectDB();
      await syncDB();

      logger.log('info', 'Cleaning up stale browser slots...');
      browserPool.cleanupStaleBrowserSlots();

      await recoverOrphanedRuns();

      if (runEmbeddedWorkers) {
        if (process.env.LOW_MEMORY_MODE === 'true') {
          logger.log(
            'warn',
            'LOW_MEMORY_MODE enabled: Chromium is lean, browsers close after each job, retries/fallbacks are reduced. Suitable for Render free (512MB); disable on paid ≥2GB instances.'
          );
        }
        await startWorkers();
        await startScraperWorker();
        await startAutomationScheduleWorker();
        await rehydrateAutomationSchedules();
      } else {
        logger.log('info', 'Embedded workers disabled for this API process');
      }

      // Immediately ensure Agenda jobs exist for any pending runs (not only after 3 min / 90s poll).
      await reenqueueStalePendingScraperRuns({ minAgeMs: 0, maxRuns: 200 });

      // Middleware: accept either `userId` (browser app, JWT-authenticated) or
      // an `x-api-key` (Chrome extension) and resolve to userId via the User
      // model, mirroring the HTTP `requireSignInOrApiKey` semantics.
      io.of('/queued-run').use(async (socket, next) => {
        try {
          const queryUserId = socket.handshake.query.userId as string | undefined;
          const rawApiKey =
            (socket.handshake.auth as any)?.apiKey ||
            (socket.handshake.headers['x-api-key'] as string | undefined) ||
            (socket.handshake.query.apiKey as string | undefined);
          const apiKey = Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey;

          if (apiKey && String(apiKey).trim()) {
            const User = (await import('./models/User')).default;
            const user = await User.findOne({ api_key: String(apiKey).trim() });
            if (!user) return next(new Error('Invalid API key'));
            (socket.data as any).userId = String(user.id);
            return next();
          }

          if (queryUserId) {
            (socket.data as any).userId = String(queryUserId);
            return next();
          }

          return next(new Error('Missing userId or API key'));
        } catch (err: any) {
          logger.log('warn', `queued-run auth middleware error: ${err?.message || err}`);
          return next(new Error('Authentication failed'));
        }
      });

      io.of('/queued-run').on('connection', (socket) => {
        const userId = (socket.data as any)?.userId as string | undefined;

        if (userId) {
          socket.join(`user-${userId}`);
          logger.log('info', `Client joined queued-run namespace for user: ${userId}, socket: ${socket.id}`);

          if (recentRecoveries.has(userId)) {
            const recoveries = recentRecoveries.get(userId)!;
            recoveries.forEach(recoveryData => {
              socket.emit('run-recovered', recoveryData);
              logger.log('info', `Sent stored recovery notification for run: ${recoveryData.runId} to user: ${userId}`);
            });
            recentRecoveries.delete(userId);
          }

          socket.on('disconnect', () => {
            logger.log('info', `Client disconnected from queued-run namespace: ${socket.id}`);
          });
        } else {
          logger.log('warn', `Client connected to queued-run namespace without userId: ${socket.id}`);
          socket.disconnect();
        }
      });

      if (!isProduction && runEmbeddedWorkers) {
        // Development mode
        if (process.platform === 'win32') {
          // Schedule triggers must run in this process (Mongoose + same Agenda definitions as
          // registerScheduleProcessor). Forking schedule-worker left jobs to a child without DB init.
          try {
            await import('./schedule-worker');
          } catch (error) {
            console.error('Failed to load schedule-worker:', error);
          }

          recordingWorkerProcess = fork(recordingWorkerPath, [], {
            execArgv: ['-r', 'ts-node/register', '--inspect=5860'],
            env: workerForkEnv,
          });
          recordingWorkerProcess.on('message', (message: any) => {
            console.log(`Message from recording worker: ${message}`);
          });
          recordingWorkerProcess.on('error', (error: any) => {
            console.error(`Error in recording worker: ${error}`);
          });
          recordingWorkerProcess.on('exit', (code: any) => {
            console.log(`Recording worker exited with code: ${code}`);
          });
        } else {
          // Run in same process for non-Windows development
          try {
            await import('./schedule-worker');
            await import('./pgboss-worker');
            console.log('Workers started in main process for memory sharing');
          } catch (error) {
            console.error('Failed to start workers in main process:', error);
          }
        }
      } else if (runEmbeddedWorkers) {
        // Production mode - run workers in same process for memory sharing
        try {
          await import('./schedule-worker');
          await import('./pgboss-worker');
          logger.log('info', 'Workers started in main process');
        } catch (error: any) {
          logger.log('error', `Failed to start workers: ${error.message}`);
          process.exit(1);
        }
      }

      logger.log('info', `Server listening on port ${SERVER_PORT}`);
    } catch (error: any) {
      logger.log('error', `Failed to connect to the database: ${error.message}`);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    console.log('Main app shutting down...');
    let shutdownSuccessful = true;

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const runningBrowsers = browserPool.getAllBrowsers();

      for (const [browserId, browser] of runningBrowsers) {
        try {
          if (browser && browser.interpreter) {
            const hasData = (browser.interpreter.serializableDataByType?.scrapeSchema?.length > 0) ||
              (browser.interpreter.serializableDataByType?.scrapeList?.length > 0) ||
              (browser.interpreter.binaryData?.length > 0);

            if (hasData) {
              const run = await Run.findOne({ browserId, status: 'running' });
              if (run) {
                const limitedData = {
                  scrapeSchemaOutput: browser.interpreter.serializableDataByType?.scrapeSchema || {},
                  scrapeListOutput: browser.interpreter.serializableDataByType?.scrapeList || {},
                  binaryOutput: browser.interpreter.binaryData || []
                };

                const binaryOutputRecord = limitedData.binaryOutput.reduce((acc: Record<string, any>, item: any, index: number) => {
                  const key = item.name || `Screenshot ${index + 1}`;
                  acc[key] = { data: item.data, mimeType: item.mimeType };
                  return acc;
                }, {});

                let uploadedBinaryOutput = {};
                if (Object.keys(binaryOutputRecord).length > 0) {
                  try {
                    const { BinaryOutputService } = require('./storage/binaryOutputService');
                    const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
                    uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, binaryOutputRecord);
                    logger.log('info', `Successfully uploaded ${Object.keys(uploadedBinaryOutput).length} screenshots to object storage for interrupted run`);
                  } catch (storageError: any) {
                    logger.log('error', `Failed to upload binary data to object storage during shutdown: ${storageError.message}`);
                    uploadedBinaryOutput = binaryOutputRecord;
                  }
                }

                run.status = 'failed';
                  run.finishedAt = new Date().toLocaleString();
                  run.log = 'Process interrupted during execution - partial data preserved';
                  run.serializableOutput = {
                    scrapeSchema: limitedData.scrapeSchemaOutput,
                    scrapeList: limitedData.scrapeListOutput,
                  };
                  run.binaryOutput = uploadedBinaryOutput;
                  await run.save();
              }
            }
          }
        } catch (browserError: any) {
          shutdownSuccessful = false;
        }
      }
    } catch (error: any) {
      shutdownSuccessful = false;
    }

    serverIntervals.forEach(clearInterval);

    try {
      const allBrowsers = browserPool.getAllBrowsers();
      for (const [browserId, browser] of allBrowsers) {
        try {
          if (browser) {
            await browser.switchOff();
          }
        } catch (browserCleanupError: any) {
          console.error(`Error shutting down browser ${browserId}:`, browserCleanupError.message);
        }
      }
    } catch (error: any) {
      console.error('Error during browser cleanup:', error.message);
    }

    if (!isProduction) {
      try {
        if (recordingWorkerProcess) {
          recordingWorkerProcess.kill('SIGTERM');
        }
      } catch (workerError: any) {
        console.error('Error terminating worker processes:', workerError.message);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
      await new Promise<void>((resolve) => {
        io.close(() => {
          resolve();
        });
      });
    } catch (ioError: any) {
      shutdownSuccessful = false;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (serverError: any) {
      console.error('Error closing HTTP server:', serverError.message);
      shutdownSuccessful = false;
    }

    if (runEmbeddedWorkers) {
      try {
        await stopScraperWorker();
      } catch (workerError: any) {
        console.error('Error stopping scraper worker:', workerError.message);
        shutdownSuccessful = false;
      }

      try {
        await stopAutomationScheduleWorker();
      } catch (workerError: any) {
        console.error('Error stopping automation schedule worker:', workerError.message);
        shutdownSuccessful = false;
      }
    }

    try {
      await closeAgenda();
    } catch (queueError: any) {
      console.error('Error closing Agenda queue:', queueError.message);
      shutdownSuccessful = false;
    }

    try {
      await closeBrowserReusePool();
    } catch (poolError: any) {
      console.error('Error closing browser reuse pool:', poolError.message);
      shutdownSuccessful = false;
    }

    try {
      await mongoose.connection.close();
    } catch (mongooseError: any) {
      console.error('Error closing Mongoose connection:', mongooseError.message);
      shutdownSuccessful = false;
    }

    console.log(`Shutdown ${shutdownSuccessful ? 'completed successfully' : 'completed with errors'}`);
    process.exit(shutdownSuccessful ? 0 : 1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection:', reason);

    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    }
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);

    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    }
  });
}
