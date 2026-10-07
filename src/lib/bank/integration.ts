import { prisma } from "@/lib/prisma";
import { BankAutomationError } from "./errors";
import { envSecretName, seal, unseal } from "./secrets";

/**
 * Integration-level helpers: per-bank defaults for a new account, and the one
 * place the statement password is ever read back into memory.
 */

export type BankDefaults = {
  bankName: string;
  emailSender: string;
  /** `{last4}` is filled with the account's last four digits. */
  emailSubjectPattern: string;
  passwordEnvVar: string;
};

export const BANK_DEFAULTS: Record<string, BankDefaults> = {
  HDFC: {
    bankName: "HDFC Bank",
    emailSender: "hdfcbanksmartstatement@hdfcbank.bank.in",
    emailSubjectPattern: "Email Account Statement of your HDFC Bank Account ***{last4} for the period",
    passwordEnvVar: "HDFC_STATEMENT_PASSWORD",
  },
};

export const STATEMENT_PASSWORD = "statement_password";

/**
 * The statement password, from wherever `passwordSecretRef` points: a
 * deployment secret (`env:NAME`) or the sealed DB copy (`db`). Returns null
 * when nothing is configured. The value goes straight to the PDF opener and
 * the browser field — never to a log, an event, a response or the client.
 */
export async function getStatementPassword(integration: { id: string; passwordSecretRef: string }): Promise<string | null> {
  const envName = envSecretName(integration.passwordSecretRef);
  if (envName) {
    const v = process.env[envName];
    return v && v.length > 0 ? v : null;
  }
  if (integration.passwordSecretRef === "db") {
    const s = await prisma.bankIntegrationSecret.findUnique({
      where: { integrationId_kind: { integrationId: integration.id, kind: STATEMENT_PASSWORD } },
      select: { valueEnc: true },
    });
    if (!s) return null;
    try {
      return unseal(s.valueEnc, "statement-password");
    } catch {
      throw new BankAutomationError("CONFIG", "The stored statement password can no longer be decrypted — set it again");
    }
  }
  return null;
}

/** Whether a password is configured, without reading it. Safe to show in the UI. */
export async function passwordStatus(integration: { id: string; passwordSecretRef: string }): Promise<{
  configured: boolean;
  source: "env" | "db" | "none";
  envName: string | null;
  updatedAt: Date | null;
}> {
  const envName = envSecretName(integration.passwordSecretRef);
  if (envName) {
    return { configured: !!process.env[envName], source: "env", envName, updatedAt: null };
  }
  const s = await prisma.bankIntegrationSecret.findUnique({
    where: { integrationId_kind: { integrationId: integration.id, kind: STATEMENT_PASSWORD } },
    select: { updatedAt: true },
  });
  return s
    ? { configured: true, source: "db", envName: null, updatedAt: s.updatedAt }
    : { configured: false, source: "none", envName: null, updatedAt: null };
}

/** Store (sealed) a new password and point the integration at it. Write-only. */
export async function setStatementPassword(integrationId: string, password: string, userId: string): Promise<void> {
  const valueEnc = seal(password, "statement-password");
  await prisma.$transaction([
    prisma.bankIntegrationSecret.upsert({
      where: { integrationId_kind: { integrationId, kind: STATEMENT_PASSWORD } },
      create: { integrationId, kind: STATEMENT_PASSWORD, valueEnc, updatedById: userId },
      update: { valueEnc, updatedById: userId },
    }),
    prisma.bankIntegration.update({ where: { id: integrationId }, data: { passwordSecretRef: "db", updatedById: userId } }),
  ]);
}

/** Drop the stored password and fall back to the deployment secret. */
export async function clearStatementPassword(integrationId: string, envName: string, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.bankIntegrationSecret.deleteMany({ where: { integrationId, kind: STATEMENT_PASSWORD } }),
    prisma.bankIntegration.update({
      where: { id: integrationId },
      data: { passwordSecretRef: `env:${envName}`, updatedById: userId },
    }),
  ]);
}

/** "••••1234" */
export function maskedAccount(last4: string): string {
  return `••••${last4}`;
}
