-- Phase 6: more failure classes for retries, and why an attempt stopped for a person.
ALTER TYPE "FailureType" ADD VALUE 'RATE_LIMITED';
ALTER TYPE "FailureType" ADD VALUE 'SITE_UNAVAILABLE';
ALTER TYPE "FailureType" ADD VALUE 'BROWSER_CRASHED';
ALTER TYPE "FailureType" ADD VALUE 'POSTING_CLOSED';

ALTER TABLE "ApplicationAttempt" ADD COLUMN "attentionReason" "AttentionReason";

CREATE INDEX "ApplicationAttempt_endedAt_idx" ON "ApplicationAttempt"("endedAt");
