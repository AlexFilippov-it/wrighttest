-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED');

-- CreateTable
CREATE TABLE "TestRunBatch" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "environmentId" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalCases" INTEGER NOT NULL,
    "completedCases" INTEGER NOT NULL DEFAULT 0,
    "passedCases" INTEGER NOT NULL DEFAULT 0,
    "failedCases" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRunBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN "batchId" TEXT,
ADD COLUMN "batchOrder" INTEGER;

-- CreateIndex
CREATE INDEX "TestRunBatch_testId_idx" ON "TestRunBatch"("testId");

-- CreateIndex
CREATE INDEX "TestRunBatch_status_idx" ON "TestRunBatch"("status");

-- AddForeignKey
ALTER TABLE "TestRunBatch" ADD CONSTRAINT "TestRunBatch_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TestRunBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
