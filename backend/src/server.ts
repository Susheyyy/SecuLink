import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { sequelize } from './config/database';
import vaultRouter from './routes/vault';
import { initCleanupJob, UPLOADS_DIR } from './services/cleanupService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

interface RateLimitRecord {
  timestamps: number[];
}
const uploadLimitStore: Record<string, RateLimitRecord> = {};
const globalLimitStore: Record<string, RateLimitRecord> = {};

function createRateLimiter(limit: number, windowMs: number, errorMessage: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): any => {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const store = req.path.includes('/upload') ? uploadLimitStore : globalLimitStore;

    if (!store[ip]) {
      store[ip] = { timestamps: [] };
    }

    store[ip].timestamps = store[ip].timestamps.filter(t => now - t < windowMs);

    if (store[ip].timestamps.length >= limit) {
      console.warn(`[SECURITY WARNING] Rate limit triggered for IP ${ip} on path ${req.path}`);
      return res.status(429).json({ error: errorMessage });
    }

    store[ip].timestamps.push(now);
    next();
  };
}

const globalLimiter = createRateLimiter(
  100,
  15 * 60 * 1000,
  'Too many requests. Please wait 15 minutes and try again.'
);

const uploadLimiter = createRateLimiter(
  5,
  60 * 60 * 1000,
  'Upload quota exceeded. Limit is 5 uploads per hour. Please wait before trying again.'
);

app.use('/api', globalLimiter);
app.use('/api/vault/upload', uploadLimiter);
app.use('/api/vault', vaultRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'HEALTHY', database: sequelize.getDialect(), time: new Date() });
});

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('[DATABASE] Connected to DB successfully.');
    
    await sequelize.sync({ alter: true });
    console.log('[DATABASE] Synced database models.');

    initCleanupJob();

    app.listen(PORT, () => {
      console.log(`[SERVER] SecuLink backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('[SERVER] Critical Boot Error:', error);
    process.exit(1);
  }
}

startServer();
