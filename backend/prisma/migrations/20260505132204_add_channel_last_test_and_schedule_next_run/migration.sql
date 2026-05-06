-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN     "lastTestAt" TIMESTAMP(3),
ADD COLUMN     "lastTestStatus" TEXT;
