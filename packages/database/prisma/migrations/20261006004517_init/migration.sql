-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IMPORTED', 'ANALYZING', 'QUALIFIED', 'NOT_QUALIFIED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'WAITING_FOR_USER', 'REVIEW_REQUIRED', 'READY', 'SUBMITTED', 'FAILED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApplicationOutcome" AS ENUM ('NONE', 'RESPONDED', 'INTERVIEW', 'OFFER', 'DECLINED');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('MANUAL', 'REVIEW', 'AUTO');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('WORKDAY', 'GREENHOUSE', 'LEVER', 'ASHBY', 'SMARTRECRUITERS', 'LINKEDIN_EASY_APPLY', 'GENERIC', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FailureType" AS ENUM ('NETWORK_ERROR', 'TIMEOUT', 'SELECTOR_ERROR', 'VALIDATION_ERROR', 'AUTH_REQUIRED', 'CAPTCHA', 'UNKNOWN_FIELD', 'SITE_CHANGED', 'UNKNOWN_ERROR');

-- CreateEnum
CREATE TYPE "AttentionReason" AS ENUM ('CAPTCHA', 'MFA', 'AUTH_REQUIRED', 'QUESTION_REVIEW', 'LOW_CONFIDENCE_MAPPING', 'UNSUPPORTED_SITE', 'VALIDATION_ERROR', 'REPEATED_FAILURE', 'CONTRADICTION', 'FINAL_REVIEW');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'FREELANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('SKILL', 'SOFTWARE', 'TECHNICAL', 'LANGUAGE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RESUME', 'COVER_LETTER', 'CERTIFICATION', 'TRANSCRIPT', 'PORTFOLIO', 'OTHER');

-- CreateEnum
CREATE TYPE "AnswerCategory" AS ENUM ('MOTIVATION', 'FIT', 'COMPENSATION', 'WORK_AUTHORIZATION', 'SPONSORSHIP', 'RELOCATION', 'TRAVEL', 'EXPERIENCE', 'LINKS', 'AVAILABILITY', 'DEMOGRAPHIC', 'OTHER');

-- CreateEnum
CREATE TYPE "AnswerSource" AS ENUM ('USER', 'PROFILE', 'AI_GENERATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "JobSourceType" AS ENUM ('MANUAL', 'LINKEDIN_SAVED', 'CSV_IMPORT', 'API');

-- CreateEnum
CREATE TYPE "ApplicationEventType" AS ENUM ('JOB_IMPORTED', 'JOB_ANALYZED', 'MATCH_CALCULATED', 'QUEUED', 'PLATFORM_DETECTED', 'BROWSER_LAUNCHED', 'PROFILE_LOADED', 'FIELDS_MAPPED', 'RESUME_UPLOADED', 'COVER_LETTER_UPLOADED', 'QUESTIONS_ANSWERED', 'VALIDATION_COMPLETED', 'HUMAN_INPUT_REQUIRED', 'HUMAN_INPUT_RECEIVED', 'SUBMITTED', 'FAILED', 'RETRY_SCHEDULED', 'STATUS_CHANGED', 'OUTCOME_UPDATED', 'NOTE');

-- CreateEnum
CREATE TYPE "EventLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'URL', 'NUMBER', 'DATE', 'SELECT', 'RADIO', 'CHECKBOX', 'FILE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'ANSWERED', 'NEEDS_REVIEW', 'APPROVED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BrowserSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "preferredName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "linkedinUrl" TEXT,
    "portfolioUrl" TEXT,
    "websiteUrl" TEXT,
    "githubUrl" TEXT,
    "currentTitle" TEXT,
    "targetTitles" TEXT[],
    "summary" TEXT,
    "industries" TEXT[],
    "yearsExperience" DECIMAL(4,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT,
    "major" TEXT,
    "concentrations" TEXT[],
    "minor" TEXT,
    "gpa" DECIMAL(4,2),
    "gpaScale" DECIMAL(4,2),
    "startDate" DATE,
    "graduationDate" DATE,
    "coursework" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "description" TEXT,
    "responsibilities" TEXT[],
    "achievements" TEXT[],
    "skills" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" "SkillCategory" NOT NULL DEFAULT 'SKILL',
    "proficiency" INTEGER,
    "yearsExperience" DECIMAL(4,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentId" TEXT,
    "jobId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverLetter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentId" TEXT,
    "jobId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" "AnswerCategory" NOT NULL,
    "source" "AnswerSource" NOT NULL DEFAULT 'USER',
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "autoSubmitAllowed" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "JobSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceType" "JobSourceType" NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "applicationUrl" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "postedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "easyApply" BOOLEAN NOT NULL DEFAULT false,
    "platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "status" "JobStatus" NOT NULL DEFAULT 'IMPORTED',
    "department" TEXT,
    "seniority" TEXT,
    "workArrangement" "WorkArrangement" NOT NULL DEFAULT 'UNKNOWN',
    "employmentType" "EmploymentType",
    "salaryText" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT,
    "salaryPeriod" TEXT,
    "salaryAnnualMax" INTEGER,
    "requiredQualifications" TEXT[],
    "preferredQualifications" TEXT[],
    "experienceYearsMin" INTEGER,
    "educationRequirement" TEXT,
    "skills" TEXT[],
    "industry" TEXT,
    "sponsorshipAvailable" BOOLEAN,
    "travelRequirement" TEXT,
    "analysis" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "matchScore" INTEGER,
    "matchBreakdown" JSONB,
    "processedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "AutomationMode" NOT NULL DEFAULT 'REVIEW',
    "platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "resumeId" TEXT,
    "coverLetterId" TEXT,
    "profileSnapshot" JSONB,
    "matchScore" INTEGER,
    "attentionReason" "AttentionReason",
    "attentionDetail" TEXT,
    "failureType" "FailureType",
    "lastError" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "confirmationNumber" TEXT,
    "outcome" "ApplicationOutcome" NOT NULL DEFAULT 'NONE',
    "outcomeAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationQuestion" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL DEFAULT 'UNKNOWN',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "pageIndex" INTEGER NOT NULL DEFAULT 0,
    "locator" JSONB,
    "mappedField" TEXT,
    "confidence" INTEGER,
    "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswerInstance" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "libraryAnswerId" TEXT,
    "value" TEXT NOT NULL,
    "source" "AnswerSource" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "approvedByUser" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationAnswerInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ApplicationEventType" NOT NULL,
    "level" "EventLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAttempt" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "workerId" TEXT,
    "browserSessionId" TEXT,
    "failureType" "FailureType",
    "errorMessage" TEXT,
    "screenshots" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ApplicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'UNKNOWN',
    "storageStateEncrypted" TEXT,
    "status" "BrowserSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minMatchScore" INTEGER NOT NULL DEFAULT 70,
    "minSalary" INTEGER,
    "preferredLocations" TEXT[],
    "workArrangements" "WorkArrangement"[],
    "employmentTypes" "EmploymentType"[],
    "excludedIndustries" TEXT[],
    "excludedCompanies" TEXT[],
    "excludedKeywords" TEXT[],
    "requiresSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "maxApplicationsPerDay" INTEGER NOT NULL DEFAULT 25,
    "maxConcurrentApplications" INTEGER NOT NULL DEFAULT 1,
    "autoSubmitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultMode" "AutomationMode" NOT NULL DEFAULT 'REVIEW',
    "matchWeights" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "fieldConfidenceThreshold" INTEGER NOT NULL DEFAULT 85,
    "answerConfidenceThreshold" INTEGER NOT NULL DEFAULT 85,
    "screenshotRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "queuePaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseAfterCurrent" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MasterProfile_userId_key" ON "MasterProfile"("userId");

-- CreateIndex
CREATE INDEX "Education_profileId_sortOrder_idx" ON "Education"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "Employment_profileId_startDate_idx" ON "Employment"("profileId", "startDate");

-- CreateIndex
CREATE INDEX "Skill_profileId_category_idx" ON "Skill"("profileId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_profileId_category_normalizedName_key" ON "Skill"("profileId", "category", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_userId_type_idx" ON "Document"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_documentId_key" ON "Resume"("documentId");

-- CreateIndex
CREATE INDEX "Resume_userId_isDefault_idx" ON "Resume"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "Resume_jobId_idx" ON "Resume"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverLetter_documentId_key" ON "CoverLetter"("documentId");

-- CreateIndex
CREATE INDEX "CoverLetter_userId_isDefault_idx" ON "CoverLetter"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "CoverLetter_jobId_idx" ON "CoverLetter"("jobId");

-- CreateIndex
CREATE INDEX "ApplicationAnswer_userId_category_idx" ON "ApplicationAnswer"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnswer_userId_questionKey_key" ON "ApplicationAnswer"("userId", "questionKey");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_userId_type_name_key" ON "JobSource"("userId", "type", "name");

-- CreateIndex
CREATE INDEX "Job_userId_deletedAt_savedAt_idx" ON "Job"("userId", "deletedAt", "savedAt");

-- CreateIndex
CREATE INDEX "Job_userId_status_idx" ON "Job"("userId", "status");

-- CreateIndex
CREATE INDEX "Job_userId_matchScore_idx" ON "Job"("userId", "matchScore");

-- CreateIndex
CREATE INDEX "Job_userId_company_idx" ON "Job"("userId", "company");

-- CreateIndex
CREATE INDEX "Job_userId_platform_idx" ON "Job"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Job_userId_canonicalUrl_key" ON "Job"("userId", "canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Job_userId_sourceType_externalId_key" ON "Job"("userId", "sourceType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_key" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_userId_status_priority_queuedAt_idx" ON "Application"("userId", "status", "priority", "queuedAt");

-- CreateIndex
CREATE INDEX "Application_userId_submittedAt_idx" ON "Application"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Application_userId_updatedAt_idx" ON "Application"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Application_status_nextAttemptAt_idx" ON "Application"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ApplicationQuestion_applicationId_pageIndex_idx" ON "ApplicationQuestion"("applicationId", "pageIndex");

-- CreateIndex
CREATE INDEX "ApplicationQuestion_applicationId_status_idx" ON "ApplicationQuestion"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnswerInstance_questionId_key" ON "ApplicationAnswerInstance"("questionId");

-- CreateIndex
CREATE INDEX "ApplicationAnswerInstance_libraryAnswerId_idx" ON "ApplicationAnswerInstance"("libraryAnswerId");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_userId_createdAt_idx" ON "ApplicationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationAttempt_applicationId_startedAt_idx" ON "ApplicationAttempt"("applicationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAttempt_applicationId_attemptNumber_key" ON "ApplicationAttempt"("applicationId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserSession_userId_domain_key" ON "BrowserSession"("userId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_userId_key" ON "AutomationRule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_userId_key" ON "UserSetting"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterProfile" ADD CONSTRAINT "MasterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MasterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MasterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MasterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_coverLetterId_fkey" FOREIGN KEY ("coverLetterId") REFERENCES "CoverLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationQuestion" ADD CONSTRAINT "ApplicationQuestion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswerInstance" ADD CONSTRAINT "ApplicationAnswerInstance_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ApplicationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswerInstance" ADD CONSTRAINT "ApplicationAnswerInstance_libraryAnswerId_fkey" FOREIGN KEY ("libraryAnswerId") REFERENCES "ApplicationAnswer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAttempt" ADD CONSTRAINT "ApplicationAttempt_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAttempt" ADD CONSTRAINT "ApplicationAttempt_browserSessionId_fkey" FOREIGN KEY ("browserSessionId") REFERENCES "BrowserSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserSession" ADD CONSTRAINT "BrowserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default (non job-specific) resume and cover letter per user.
CREATE UNIQUE INDEX "Resume_one_default_per_user" ON "Resume"("userId") WHERE "isDefault" AND "jobId" IS NULL;
CREATE UNIQUE INDEX "CoverLetter_one_default_per_user" ON "CoverLetter"("userId") WHERE "isDefault" AND "jobId" IS NULL;

-- Value ranges the application relies on.
ALTER TABLE "Job" ADD CONSTRAINT "Job_matchScore_range" CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 100));
ALTER TABLE "Application" ADD CONSTRAINT "Application_matchScore_range" CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 100));
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 100);
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_minMatchScore_range" CHECK ("minMatchScore" >= 0 AND "minMatchScore" <= 100);
