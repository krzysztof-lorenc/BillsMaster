import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { seedProviders } from './db/seed.js';
import { createSyncWorker } from './queue/sync.worker.js';
import { setupDailySyncScheduler } from './queue/sync.queue.js';
import { BillService } from './services/BillService.js';
import { prisma } from './db/prisma.js';
import fs from 'node:fs/promises';

async function main() {
  logger.info('🚀 Starting BillsMaster Backend Server...');

  // Ensure storage directories exist
  await fs.mkdir(config.STORAGE_DIR, { recursive: true });
  await fs.mkdir(config.INVOICES_DIR, { recursive: true });
  await fs.mkdir(config.SESSIONS_DIR, { recursive: true });

  // Auto-seed providers if database is reachable
  try {
    await seedProviders();
  } catch (err) {
    logger.warn('Could not auto-seed providers on startup (database may not be migrated yet):', err);
  }

  // Initialize BullMQ worker
  let worker: ReturnType<typeof createSyncWorker> | null = null;
  try {
    worker = createSyncWorker();
    logger.info('⚙️  BullMQ Scraper Worker initialized');
  } catch (err) {
    logger.error('Failed to initialize BullMQ Worker (Redis may be offline):', err);
  }

  // Setup daily 3:00 AM sync scheduler
  try {
    await setupDailySyncScheduler();
  } catch (err) {
    logger.error('Failed to setup daily sync scheduler:', err);
  }

  // Initial cleanup: automatically delete bills older than 12 months
  try {
    const cleaned = await BillService.deleteBillsOlderThan12Months();
    if (cleaned > 0) {
      logger.info(`🧹 Startup cleanup: removed ${cleaned} bill(s) older than 12 months.`);
    }
  } catch (err) {
    logger.warn('Could not run startup bill cleanup (database may not be ready):', err);
  }

  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`✨ BillsMaster API running at http://${config.HOST}:${config.PORT}`);
    logger.info(`📡 WebSocket stream available at ws://${config.HOST}:${config.PORT}/ws/sync-stream`);
  } catch (err) {
    logger.error('Server failed to start:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully shutting down...`);
    try {
      await app.close();
      if (worker) await worker.close();
      await prisma.$disconnect();
      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal initialization error:', err);
  process.exit(1);
});
