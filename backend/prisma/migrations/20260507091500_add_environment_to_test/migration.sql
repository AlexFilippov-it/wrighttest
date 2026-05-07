-- Add persisted default environment to checks/tests.
ALTER TABLE "Test"
ADD COLUMN "environmentId" TEXT;

ALTER TABLE "Test"
ADD CONSTRAINT "Test_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "Environment"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Test_environmentId_idx" ON "Test"("environmentId");
