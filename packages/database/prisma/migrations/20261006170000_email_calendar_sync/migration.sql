-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "MailConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('CONFIRMATION', 'RESPONSE', 'INTERVIEW', 'OFFER', 'REJECTION');

-- CreateEnum
CREATE TYPE "EmailOutcome" AS ENUM ('MOVED', 'INTERVIEW_ADDED', 'SUGGESTED', 'NO_CHANGE', 'UNMATCHED', 'AMBIGUOUS', 'DISMISSED');

-- AlterTable
ALTER TABLE "InterviewRound" ADD COLUMN     "calendarConnectionId" TEXT,
ADD COLUMN     "calendarError" TEXT,
ADD COLUMN     "calendarEventId" TEXT,
ADD COLUMN     "calendarHash" TEXT,
ADD COLUMN     "calendarSyncedAt" TIMESTAMP(3),
ADD COLUMN     "fromInvite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "MailConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "readEmail" BOOLEAN NOT NULL DEFAULT true,
    "autoUpdate" BOOLEAN NOT NULL DEFAULT true,
    "calendarSync" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "syncedThrough" TIMESTAMP(3),
    "lastError" TEXT,
    "syncLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromName" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "stage" TEXT,
    "confidence" INTEGER NOT NULL,
    "outcome" "EmailOutcome" NOT NULL,
    "applicationId" TEXT,
    "interview" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventRemoval" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventRemoval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailConnection_status_readEmail_lastSyncedAt_idx" ON "MailConnection"("status", "readEmail", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailConnection_userId_provider_key" ON "MailConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_receivedAt_idx" ON "EmailMessage"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_outcome_idx" ON "EmailMessage"("userId", "outcome");

-- CreateIndex
CREATE INDEX "EmailMessage_connectionId_threadId_idx" ON "EmailMessage"("connectionId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_connectionId_externalId_key" ON "EmailMessage"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "CalendarEventRemoval_connectionId_idx" ON "CalendarEventRemoval"("connectionId");

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "MailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailConnection" ADD CONSTRAINT "MailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventRemoval" ADD CONSTRAINT "CalendarEventRemoval_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

