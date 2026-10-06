-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('NEEDS_ATTENTION', 'JOB_ALERT', 'TEST');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "ApplicationEvent" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "jobAlertEmails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "jobAlertHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "jobAlertsRanOn" TEXT;

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boards" TEXT[],
    "query" TEXT NOT NULL,
    "location" TEXT,
    "searchDescriptions" BOOLEAN NOT NULL DEFAULT false,
    "matchAny" BOOLEAN NOT NULL DEFAULT false,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastNewCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearchMatch" (
    "id" TEXT NOT NULL,
    "savedSearchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "salaryText" TEXT,
    "postedAt" TIMESTAMP(3),
    "wasNew" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedAt" TIMESTAMP(3),

    CONSTRAINT "SavedSearchMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "NotificationStatus" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "data" JSONB,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedSearch_alertsEnabled_idx" ON "SavedSearch"("alertsEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE INDEX "SavedSearchMatch_userId_firstSeenAt_idx" ON "SavedSearchMatch"("userId", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearchMatch_savedSearchId_canonicalUrl_key" ON "SavedSearchMatch"("savedSearchId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "Notification_userId_kind_createdAt_idx" ON "Notification"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_type_notifiedAt_idx" ON "ApplicationEvent"("type", "notifiedAt");

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearchMatch" ADD CONSTRAINT "SavedSearchMatch_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Alerts start with events from now on: earlier Needs Attention events count as already notified.
UPDATE "ApplicationEvent" SET "notifiedAt" = "createdAt" WHERE "type" = 'HUMAN_INPUT_REQUIRED';
