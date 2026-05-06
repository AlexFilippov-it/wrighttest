-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onRecovered" BOOLEAN NOT NULL DEFAULT true;
