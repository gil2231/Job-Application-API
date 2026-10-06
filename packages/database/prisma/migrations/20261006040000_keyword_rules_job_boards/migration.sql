-- AlterEnum
ALTER TYPE "JobSourceType" ADD VALUE 'JOB_BOARD';

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "requiredKeywords" TEXT[];
