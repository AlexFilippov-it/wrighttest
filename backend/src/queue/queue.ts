import { Queue } from 'bullmq';
import redis from '../redis';

export interface TestJobData {
  testRunId: string;
  testId: string;
  environmentId?: string;
}

export const testQueuePrefix = process.env.BULLMQ_PREFIX?.trim() || 'bull';

export const testQueue = new Queue<TestJobData>('test-runs', {
  connection: redis,
  prefix: testQueuePrefix
});
