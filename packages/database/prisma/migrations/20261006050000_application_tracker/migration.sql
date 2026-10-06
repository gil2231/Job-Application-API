-- Flightpath (application tracker). Additive only: new outcome and event
-- values, stage milestone columns on Application, and interview rounds.

-- CreateEnum
CREATE TYPE "InterviewKind" AS ENUM ('PHONE_SCREEN', 'RECRUITER', 'HIRING_MANAGER', 'TECHNICAL', 'BEHAVIORAL', 'CASE_STUDY', 'PANEL', 'ONSITE', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationEventType" ADD VALUE 'STAGE_CHANGED';
ALTER TYPE "ApplicationEventType" ADD VALUE 'INTERVIEW_SCHEDULED';
ALTER TYPE "ApplicationEventType" ADD VALUE 'INTERVIEW_UPDATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationOutcome" ADD VALUE 'ACCEPTED';
ALTER TYPE "ApplicationOutcome" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "interviewingAt" TIMESTAMP(3),
ADD COLUMN     "offerAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "stageChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "InterviewKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "location" TEXT,
    "interviewers" TEXT,
    "notes" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewRound_applicationId_scheduledAt_idx" ON "InterviewRound"("applicationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "InterviewRound_userId_status_scheduledAt_idx" ON "InterviewRound"("userId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Application_userId_status_outcome_idx" ON "Application"("userId", "status", "outcome");

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill milestones from outcomes recorded before Flightpath. Only the
-- pre-existing outcome values are referenced: Postgres can't use enum values
-- added in the same transaction.
UPDATE "Application"
SET "stageChangedAt" = "outcomeAt",
    "respondedAt" = "outcomeAt",
    "interviewingAt" = CASE WHEN "outcome" IN ('INTERVIEW', 'OFFER') THEN "outcomeAt" END,
    "offerAt" = CASE WHEN "outcome" = 'OFFER' THEN "outcomeAt" END,
    "closedAt" = CASE WHEN "outcome" = 'DECLINED' THEN "outcomeAt" END
WHERE "outcome" <> 'NONE' AND "outcomeAt" IS NOT NULL;
