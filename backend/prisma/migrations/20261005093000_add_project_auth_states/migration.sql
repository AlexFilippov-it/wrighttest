CREATE TYPE "RunMode" AS ENUM ('NORMAL', 'AUTH_REFRESH');

CREATE TYPE "AuthStateStatus" AS ENUM ('UNAVAILABLE', 'REFRESHING', 'AVAILABLE', 'REFRESH_FAILED');

ALTER TABLE "Test"
ADD COLUMN "useProjectAuthentication" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TestRun"
ADD COLUMN "runMode" "RunMode" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "authStateId" TEXT;

CREATE TABLE "ProjectAuthState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "authCheckId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "AuthStateStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "storageKey" TEXT,
    "refreshedAt" TIMESTAMP(3),
    "refreshedRunId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectAuthState_refreshedRunId_key"
ON "ProjectAuthState"("refreshedRunId");

CREATE UNIQUE INDEX "ProjectAuthState_projectId_environmentId_key"
ON "ProjectAuthState"("projectId", "environmentId");

CREATE INDEX "ProjectAuthState_authCheckId_idx"
ON "ProjectAuthState"("authCheckId");

CREATE INDEX "TestRun_authStateId_idx"
ON "TestRun"("authStateId");

ALTER TABLE "ProjectAuthState"
ADD CONSTRAINT "ProjectAuthState_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAuthState"
ADD CONSTRAINT "ProjectAuthState_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAuthState"
ADD CONSTRAINT "ProjectAuthState_authCheckId_fkey"
FOREIGN KEY ("authCheckId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectAuthState"
ADD CONSTRAINT "ProjectAuthState_refreshedRunId_fkey"
FOREIGN KEY ("refreshedRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TestRun"
ADD CONSTRAINT "TestRun_authStateId_fkey"
FOREIGN KEY ("authStateId") REFERENCES "ProjectAuthState"("id") ON DELETE SET NULL ON UPDATE CASCADE;
