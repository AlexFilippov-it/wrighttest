CREATE TYPE "DatabaseProvider" AS ENUM ('POSTGRESQL', 'MYSQL', 'SUPABASE');
CREATE TYPE "DatabaseAccessMode" AS ENUM ('READ_ONLY', 'READ_WRITE');
CREATE TYPE "DatabaseCheckStatus" AS ENUM ('CONNECTED', 'FAILED');

CREATE TABLE "DatabaseConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "DatabaseProvider" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "database" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "ssl" BOOLEAN NOT NULL DEFAULT true,
    "accessMode" "DatabaseAccessMode" NOT NULL DEFAULT 'READ_ONLY',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulCheckAt" TIMESTAMP(3),
    "lastCheckStatus" "DatabaseCheckStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DatabaseConnection_projectId_idx" ON "DatabaseConnection"("projectId");

ALTER TABLE "DatabaseConnection"
ADD CONSTRAINT "DatabaseConnection_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
