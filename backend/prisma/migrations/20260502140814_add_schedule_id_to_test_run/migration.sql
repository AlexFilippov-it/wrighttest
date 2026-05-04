-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "scheduleId" TEXT;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
