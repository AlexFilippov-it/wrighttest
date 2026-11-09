CREATE TYPE "SuiteExecutionMode" AS ENUM ('INDEPENDENT', 'SEQUENTIAL');
CREATE TYPE "SuiteRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED');

ALTER TABLE "Suite"
  ADD COLUMN "executionMode" "SuiteExecutionMode" NOT NULL DEFAULT 'INDEPENDENT',
  ADD COLUMN "executionConfig" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "TestRun"
  ADD COLUMN "suiteRunId" TEXT,
  ADD COLUMN "suiteOrder" INTEGER,
  ADD COLUMN "runInputsSnapshot" TEXT;

CREATE TABLE "SuiteRun" (
  "id" TEXT NOT NULL,
  "suiteId" TEXT,
  "projectId" TEXT NOT NULL,
  "suiteName" TEXT NOT NULL,
  "environmentId" TEXT,
  "scheduleId" TEXT,
  "triggeredBy" TEXT,
  "executionMode" "SuiteExecutionMode" NOT NULL,
  "status" "SuiteRunStatus" NOT NULL DEFAULT 'PENDING',
  "configSnapshot" JSONB NOT NULL,
  "outputSnapshot" TEXT,
  "outputMetadata" JSONB NOT NULL DEFAULT '[]',
  "currentOrder" INTEGER NOT NULL DEFAULT -1,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "handoffExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuiteRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestRun_suiteRunId_suiteOrder_idx" ON "TestRun"("suiteRunId", "suiteOrder");
CREATE UNIQUE INDEX "TestRun_suiteRunId_suiteOrder_key" ON "TestRun"("suiteRunId", "suiteOrder");
CREATE INDEX "SuiteRun_projectId_createdAt_idx" ON "SuiteRun"("projectId", "createdAt");
CREATE INDEX "SuiteRun_status_currentOrder_idx" ON "SuiteRun"("status", "currentOrder");
CREATE INDEX "SuiteRun_handoffExpiresAt_idx" ON "SuiteRun"("handoffExpiresAt");

ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_suiteRunId_fkey"
  FOREIGN KEY ("suiteRunId") REFERENCES "SuiteRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SuiteRun" ADD CONSTRAINT "SuiteRun_suiteId_fkey"
  FOREIGN KEY ("suiteId") REFERENCES "Suite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SuiteRun" ADD CONSTRAINT "SuiteRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuiteRun" ADD CONSTRAINT "SuiteRun_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
