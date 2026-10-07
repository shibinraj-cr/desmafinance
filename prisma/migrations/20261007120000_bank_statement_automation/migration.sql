-- CreateTable
CREATE TABLE "BankMailboxConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "emailAddress" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT,
    "connectedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankMailboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankIntegration" (
    "id" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountLastFour" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "emailSender" TEXT NOT NULL,
    "emailRecipient" TEXT,
    "emailSubjectPattern" TEXT NOT NULL,
    "mailProvider" TEXT NOT NULL DEFAULT 'gmail',
    "mailboxConnectionId" TEXT,
    "passwordSecretRef" TEXT NOT NULL DEFAULT 'env:HDFC_STATEMENT_PASSWORD',
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "statementFrequency" TEXT NOT NULL DEFAULT 'daily',
    "runTime" TEXT NOT NULL DEFAULT '09:30',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "lookbackDays" INTEGER NOT NULL DEFAULT 3,
    "browserAutomationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pdfArchiveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "failureScreenshots" BOOLEAN NOT NULL DEFAULT false,
    "sheetSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sheetId" TEXT,
    "sheetTab" TEXT NOT NULL DEFAULT 'Bank Transactions',
    "alertAfterBusinessDays" INTEGER NOT NULL DEFAULT 2,
    "lastEmailCheckedAt" TIMESTAMP(3),
    "lastStatementReceivedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSheetSyncAt" TIMESTAMP(3),
    "lastSheetSyncError" TEXT,
    "lastStatementDate" DATE,
    "lastScheduledRunOn" DATE,
    "lastMissingAlertOn" DATE,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankIntegrationSecret" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankIntegrationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "fromDate" DATE,
    "toDate" DATE,
    "testResult" JSONB,
    "discoveredAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gmailMessagesFound" INTEGER NOT NULL DEFAULT 0,
    "statementsProcessed" INTEGER NOT NULL DEFAULT 0,
    "statementsFailed" INTEGER NOT NULL DEFAULT 0,
    "transactionsCreated" INTEGER NOT NULL DEFAULT 0,
    "transactionsSkipped" INTEGER NOT NULL DEFAULT 0,
    "transactionsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "runId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'gmail',
    "gmailMessageId" TEXT,
    "gmailReceivedAt" TIMESTAMP(3),
    "sourceSubject" TEXT,
    "statementUrlEnc" TEXT,
    "attachmentId" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "duplicateOfId" TEXT,
    "fileName" TEXT,
    "fileSha256" TEXT,
    "fileSize" INTEGER,
    "blobPathname" TEXT,
    "openingBalance" DECIMAL(16,2),
    "closingBalance" DECIMAL(16,2),
    "totalDebit" DECIMAL(16,2),
    "totalCredit" DECIMAL(16,2),
    "debitCount" INTEGER,
    "creditCount" INTEGER,
    "transactionCount" INTEGER,
    "insertedCount" INTEGER,
    "duplicateCount" INTEGER,
    "validation" JSONB,
    "reviewPayload" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "txnDate" DATE NOT NULL,
    "valueDate" DATE,
    "description" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "chequeNumber" TEXT,
    "direction" TEXT NOT NULL,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(16,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "transactionType" TEXT NOT NULL,
    "paymentMode" TEXT,
    "counterpartyName" TEXT,
    "upiReference" TEXT,
    "bankReference" TEXT,
    "statementDate" DATE,
    "gmailMessageId" TEXT,
    "sourceSubject" TEXT,
    "rawText" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "reconciliationNote" TEXT,
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "sheetSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransactionMatch" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransactionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAutomationEvent" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "runId" TEXT,
    "statementId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankMailboxConnection_emailAddress_key" ON "BankMailboxConnection"("emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "BankIntegration_bankCode_accountLastFour_key" ON "BankIntegration"("bankCode", "accountLastFour");

-- CreateIndex
CREATE UNIQUE INDEX "BankIntegrationSecret_integrationId_kind_key" ON "BankIntegrationSecret"("integrationId", "kind");

-- CreateIndex
CREATE INDEX "BankStatementRun_integrationId_createdAt_idx" ON "BankStatementRun"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "BankStatementRun_status_idx" ON "BankStatementRun"("status");

-- CreateIndex
CREATE INDEX "BankStatement_integrationId_periodEnd_idx" ON "BankStatement"("integrationId", "periodEnd");

-- CreateIndex
CREATE INDEX "BankStatement_status_idx" ON "BankStatement"("status");

-- CreateIndex
CREATE INDEX "BankStatement_runId_idx" ON "BankStatement"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_integrationId_gmailMessageId_key" ON "BankStatement"("integrationId", "gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_integrationId_fileSha256_key" ON "BankStatement"("integrationId", "fileSha256");

-- CreateIndex
CREATE INDEX "BankTransaction_integrationId_txnDate_idx" ON "BankTransaction"("integrationId", "txnDate");

-- CreateIndex
CREATE INDEX "BankTransaction_statementId_idx" ON "BankTransaction"("statementId");

-- CreateIndex
CREATE INDEX "BankTransaction_txnDate_idx" ON "BankTransaction"("txnDate");

-- CreateIndex
CREATE INDEX "BankTransaction_reconciliationStatus_idx" ON "BankTransaction"("reconciliationStatus");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionType_idx" ON "BankTransaction"("transactionType");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_integrationId_transactionHash_key" ON "BankTransaction"("integrationId", "transactionHash");

-- CreateIndex
CREATE INDEX "BankTransactionMatch_transactionId_idx" ON "BankTransactionMatch"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransactionMatch_bankTransactionId_transactionId_key" ON "BankTransactionMatch"("bankTransactionId", "transactionId");

-- CreateIndex
CREATE INDEX "BankAutomationEvent_runId_createdAt_idx" ON "BankAutomationEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "BankAutomationEvent_statementId_createdAt_idx" ON "BankAutomationEvent"("statementId", "createdAt");

-- CreateIndex
CREATE INDEX "BankAutomationEvent_integrationId_createdAt_idx" ON "BankAutomationEvent"("integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "BankIntegration" ADD CONSTRAINT "BankIntegration_mailboxConnectionId_fkey" FOREIGN KEY ("mailboxConnectionId") REFERENCES "BankMailboxConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankIntegrationSecret" ADD CONSTRAINT "BankIntegrationSecret_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "BankIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementRun" ADD CONSTRAINT "BankStatementRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "BankIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "BankIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BankStatementRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "BankIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAutomationEvent" ADD CONSTRAINT "BankAutomationEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BankStatementRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAutomationEvent" ADD CONSTRAINT "BankAutomationEvent_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

