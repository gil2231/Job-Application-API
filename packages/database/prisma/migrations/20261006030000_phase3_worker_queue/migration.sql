-- AlterEnum
ALTER TYPE "ApplicationEventType" ADD VALUE 'PAGE_COMPLETED';

-- DropIndex
DROP INDEX "ApplicationQuestion_applicationId_pageIndex_idx";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "submitApprovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApplicationQuestion" ADD COLUMN     "reviewReason" TEXT;

-- CreateIndex
CREATE INDEX "Application_status_lockedUntil_idx" ON "Application"("status", "lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationQuestion_applicationId_pageIndex_normalizedKey_key" ON "ApplicationQuestion"("applicationId", "pageIndex", "normalizedKey");

