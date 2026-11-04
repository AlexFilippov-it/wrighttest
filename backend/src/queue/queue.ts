import { Queue } from 'bullmq';
import redis from '../redis';

export interface TestJobData {
  testRunId: string;
  testId: string;
  environmentId?: string;
}

const configuredPrefix = process.env.BULLMQ_PREFIX?.trim();
const runningNodeTests = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test';

export const testQueuePrefix = configuredPrefix || (runningNodeTests ? `wrighttest-test-${process.pid}` : 'bull');

if (runningNodeTests && testQueuePrefix === 'bull') {
  throw new Error('Backend tests must use an isolated BULLMQ_PREFIX, never the application queue prefix.');
}

export const testQueue = new Queue<TestJobData>('test-runs', {
  connection: redis,
  prefix: testQueuePrefix
});
