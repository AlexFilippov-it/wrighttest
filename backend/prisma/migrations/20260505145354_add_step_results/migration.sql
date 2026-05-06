-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "stepResults" JSONB NOT NULL DEFAULT '[]';
