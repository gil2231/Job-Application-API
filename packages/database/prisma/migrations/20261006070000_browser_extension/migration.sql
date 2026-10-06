-- AlterEnum
ALTER TYPE "JobSourceType" ADD VALUE 'BROWSER_EXTENSION';

-- CreateTable
CREATE TABLE "ExtensionConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "browser" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionConnection_pairingCodeHash_key" ON "ExtensionConnection"("pairingCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionConnection_tokenHash_key" ON "ExtensionConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "ExtensionConnection_userId_idx" ON "ExtensionConnection"("userId");

-- AddForeignKey
ALTER TABLE "ExtensionConnection" ADD CONSTRAINT "ExtensionConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
