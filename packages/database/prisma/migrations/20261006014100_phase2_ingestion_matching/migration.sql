-- CreateEnum
CREATE TYPE "JobImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'NEEDS_DETAILS';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "importId" TEXT,
ADD COLUMN     "qualification" JSONB,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "JobImportStatus" NOT NULL DEFAULT 'RUNNING',
    "fileName" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "JobImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobImport_userId_createdAt_idx" ON "JobImport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_userId_fingerprint_idx" ON "Job"("userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "JobImport" ADD CONSTRAINT "JobImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobImport" ADD CONSTRAINT "JobImport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_importId_fkey" FOREIGN KEY ("importId") REFERENCES "JobImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
