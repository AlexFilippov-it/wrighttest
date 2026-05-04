import { Queue } from 'bullmq';
import redis from '../redis';

export interface TestJobData {
  testRunId: string;
  testId: string;
  environmentId?: string;
}

export const testQueue = new Queue<TestJobData>('test-runs', {
  connection: redis
});
