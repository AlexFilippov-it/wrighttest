CREATE TABLE "ProjectVariable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVariable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectVariable_projectId_name_key" ON "ProjectVariable"("projectId", "name");
CREATE INDEX "ProjectVariable_projectId_idx" ON "ProjectVariable"("projectId");
ALTER TABLE "ProjectVariable" ADD CONSTRAINT "ProjectVariable_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
