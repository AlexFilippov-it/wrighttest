CREATE TABLE "InstanceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeLocale" TEXT NOT NULL DEFAULT 'en',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstanceSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LanguagePack" (
    "locale" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "sourceHashes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LanguagePack_pkey" PRIMARY KEY ("locale")
);

INSERT INTO "InstanceSettings" ("id", "activeLocale", "updatedAt")
VALUES (1, 'en', CURRENT_TIMESTAMP);
