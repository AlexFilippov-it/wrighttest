ALTER TABLE "TestRun"
ADD COLUMN "dataCaseName" TEXT,
ADD COLUMN "dataCaseIndex" INTEGER,
ADD COLUMN "dataCaseVariables" JSONB;
