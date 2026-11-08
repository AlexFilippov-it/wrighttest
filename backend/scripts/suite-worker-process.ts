import { startTestWorker, stopTestWorker } from '../src/queue/worker';
import prisma from '../src/prisma';
import redis from '../src/redis';

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[SuiteWorker] stopping on ${signal}`);
  await stopTestWorker();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

startTestWorker().then(() => {
  console.log('[SuiteWorker] ready');
}).catch((error) => {
  console.error('[SuiteWorker] startup failed:', error);
  process.exit(1);
});
