import cron from 'node-cron';
import type { Schedule } from '@prisma/client';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import { DATA_DRIVEN_CASE_REQUIRED_ERROR, hasTestDataCases } from '../utils/test-data';
import { createSuiteRun } from './suite-runner';

class SchedulerService {
  private tasks = new Map<string, ReturnType<typeof cron.schedule>>();

  register(schedule: Schedule) {
    this.unregister(schedule.id);

    if (!schedule.enabled) return;
    if (!cron.validate(schedule.cron)) return;

    const task = cron.schedule(schedule.cron, async () => {
      console.log(`[Scheduler] Running schedule "${schedule.name}"`);

      try {
        let queued = 0;
        if (schedule.suiteId) {
          const suite = await prisma.suite.findUnique({
            where: { id: schedule.suiteId }
          });
          if (suite) queued = (await createSuiteRun(suite, {
            environmentId: schedule.environmentId ?? undefined,
            scheduleId: schedule.id
          })).runs.length;
        } else if (schedule.testId) {
          const testId = schedule.testId;
          const test = await prisma.test.findUnique({ where: { id: testId } });
          if (test) {

            if (hasTestDataCases(test.testData)) {
              await prisma.testRun.create({
                data: {
                  testId,
                  status: 'FAILED',
                  environmentId: schedule.environmentId ?? undefined,
                  scheduleId: schedule.id,
                  finishedAt: new Date(),
                  durationMs: 0,
                  error: DATA_DRIVEN_CASE_REQUIRED_ERROR
                }
              });
              console.log(`[Scheduler] Skipped data-driven test "${test.name}" without explicit case`);
            } else {
              const run = await prisma.testRun.create({
                data: {
                  testId,
                  status: 'PENDING',
                  environmentId: schedule.environmentId ?? undefined,
                  scheduleId: schedule.id
                }
              });

              await enqueueTestRun({ id: run.id, testId, environmentId: schedule.environmentId ?? undefined });
              queued = 1;
            }
          }
        }

        await prisma.schedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: new Date() }
        });

        console.log(`[Scheduler] Schedule "${schedule.name}" queued ${queued} checks`);
      } catch (error) {
        console.error(`[Scheduler] Error in schedule "${schedule.name}":`, error);
      }
    });

    this.tasks.set(schedule.id, task);
    console.log(`[Scheduler] Registered "${schedule.name}" → ${schedule.cron}`);
  }

  unregister(scheduleId: string) {
    const task = this.tasks.get(scheduleId);
    if (!task) return;

    task.stop();
    this.tasks.delete(scheduleId);
  }

  async loadAll() {
    const schedules = await prisma.schedule.findMany({
      where: { enabled: true }
    });

    for (const schedule of schedules) {
      this.register(schedule);
    }

    console.log(`[Scheduler] Loaded ${schedules.length} schedules`);
  }
}

export const schedulerService = new SchedulerService();
