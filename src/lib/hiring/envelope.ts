import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, unprocessable } from "@/lib/http-error";
import { uploadProof, isBlobConfigured } from "@/lib/ops-blob";
import { renderPdf } from "./pdf";
import { letterHtml, letterPdfBlocks, type LetterData, type AuditEntry } from "./letter";

/**
 * The e-sign envelope.
 *
 * The link the candidate opens IS the credential, so the rules are:
 *   - the raw token exists only in the emailed URL; the row stores its SHA-256,
 *   - it expires,
 *   - it is single-use for SIGNING (opening it to read is not "use"),
 *   - every open, every view and the signature itself append to an audit trail
 *     that is never rewritten.
 */

const TOKEN_BYTES = 32;
const DEFAULT_TTL_DAYS = 14;

export function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** The signing URL a candidate receives. */
export function signingUrl(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/$/, "")}/offer/${rawToken}`;
}

/**
 * Create the envelope for an offer and return the RAW token exactly once — it
 * is never readable again, because only its hash is stored.
 */
export async function createEnvelope(opts: {
  offerId: string;
  signerName: string;
  signerEmail: string;
  letter: LetterData;
  ttlDays?: number;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ envelopeId: string; rawToken: string }> {
  const { raw, hash } = mintToken();
  const trail: AuditEntry[] = [
    { at: new Date().toISOString(), event: "created", ip: opts.ip, userAgent: opts.userAgent },
  ];

  const envelope = await prisma.hiringOfferEnvelope.create({
    data: {
      offerId: opts.offerId,
      documentHtml: letterHtml(opts.letter),
      signerName: opts.signerName,
      signerEmail: opts.signerEmail,
      accessTokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400_000),
      auditTrail: trail as never,
    },
  });

  return { envelopeId: envelope.id, rawToken: raw };
}

export type { LetterData, AuditEntry };
export { letterHtml, letterPdfBlocks };

export type ResolvedEnvelope = Awaited<ReturnType<typeof resolveEnvelope>>;

/**
 * Look an envelope up by the raw token from the URL.
 *
 * Deliberately returns a REASON rather than throwing a 404 for everything: the
 * candidate on the other end needs to be told "this link has expired" or "this
 * offer has already been signed", not shown a dead page.
 */
export async function resolveEnvelope(rawToken: string) {
  const envelope = await prisma.hiringOfferEnvelope.findUnique({
    where: { accessTokenHash: hashToken(rawToken) },
    include: {
      offer: {
        include: {
          location: { select: { name: true } },
          application: {
            select: {
              id: true,
              job: { select: { id: true, title: true, department: true } },
              candidate: { select: { id: true, fullName: true } },
            },
          },
        },
      },
    },
  });
  if (!envelope) return { state: "unknown" as const, envelope: null };
  if (envelope.signedAt) return { state: "signed" as const, envelope };
  if (envelope.offer.status === "withdrawn") return { state: "withdrawn" as const, envelope };
  if (envelope.offer.status === "declined") return { state: "declined" as const, envelope };
  if (envelope.tokenExpiresAt.getTime() < Date.now()) return { state: "expired" as const, envelope };
  return { state: "open" as const, envelope };
}

/** Append to the audit trail. Never rewrites an existing entry. */
export async function appendAudit(envelopeId: string, entry: AuditEntry): Promise<void> {
  const current = await prisma.hiringOfferEnvelope.findUnique({
    where: { id: envelopeId },
    select: { auditTrail: true },
  });
  const trail = Array.isArray(current?.auditTrail) ? (current!.auditTrail as unknown as AuditEntry[]) : [];
  await prisma.hiringOfferEnvelope.update({
    where: { id: envelopeId },
    data: { auditTrail: [...trail, entry] as never },
  });
}

/**
 * Record the signature, archive the countersigned PDF, and move the offer to
 * accepted. The whole thing is one transaction except the upload, which happens
 * first — an offer marked accepted with no artefact is worse than an orphaned
 * blob.
 */
export async function signEnvelope(opts: {
  rawToken: string;
  typedName: string;
  signatureImageDataUrl: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ offerId: string; applicationId: string; pdfUrl: string | null }> {
  const resolved = await resolveEnvelope(opts.rawToken);
  if (resolved.state === "unknown") throw notFound("That signing link is not valid.");
  if (resolved.state === "signed") {
    throw unprocessable("This offer has already been signed.", "already_signed");
  }
  if (resolved.state === "expired") {
    throw unprocessable("This signing link has expired. Ask us for a new one.", "expired");
  }
  if (resolved.state === "withdrawn" || resolved.state === "declined") {
    throw unprocessable("This offer is no longer open.", "offer_closed");
  }
  if (!opts.typedName.trim()) throw badRequest("Type your full name to sign.", "name_required");

  const envelope = resolved.envelope;
  const signedAt = new Date();

  const existingTrail = Array.isArray(envelope.auditTrail)
    ? (envelope.auditTrail as unknown as AuditEntry[])
    : [];
  const trail: AuditEntry[] = [
    ...existingTrail,
    { at: signedAt.toISOString(), event: "signed", ip: opts.ip, userAgent: opts.userAgent },
  ];

  const letter: LetterData = {
    candidateName: envelope.offer.application.candidate.fullName,
    jobTitle: envelope.offer.jobTitle,
    department: envelope.offer.department,
    locationName: envelope.offer.location?.name ?? null,
    startDate: envelope.offer.startDate,
    baseLakh: Number(envelope.offer.baseLakh),
    variableLakh: envelope.offer.variableLakh == null ? null : Number(envelope.offer.variableLakh),
    joiningBonusLakh:
      envelope.offer.joiningBonusLakh == null ? null : Number(envelope.offer.joiningBonusLakh),
    probationMonths: envelope.offer.probationMonths,
    noticePeriodDays: envelope.offer.noticePeriodDays,
    otherTermsMd: envelope.offer.otherTermsMd,
    expiresAt: envelope.offer.expiresAt,
  };

  let pdfUrl: string | null = null;
  if (isBlobConfigured()) {
    const pdf = renderPdf(
      letterPdfBlocks(
        letter,
        { name: opts.typedName.trim(), signedAt, ip: opts.ip, userAgent: opts.userAgent },
        trail,
      ),
    );
    pdfUrl = await uploadProof(
      `hiring/offers/${envelope.offerId}/countersigned-${signedAt.getTime()}.pdf`,
      pdf,
      "application/pdf",
    );
  }

  let signatureImageUrl: string | null = null;
  if (opts.signatureImageDataUrl && isBlobConfigured()) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(opts.signatureImageDataUrl);
    if (match) {
      const bytes = Buffer.from(match[1]!, "base64");
      if (bytes.byteLength <= 512 * 1024) {
        signatureImageUrl = await uploadProof(
          `hiring/offers/${envelope.offerId}/signature-${signedAt.getTime()}.png`,
          bytes,
          "image/png",
        );
      }
    }
  }

  await prisma.$transaction([
    prisma.hiringOfferEnvelope.update({
      where: { id: envelope.id },
      data: {
        signedAt,
        usedAt: signedAt,
        signerTypedName: opts.typedName.trim(),
        signatureImageUrl,
        signerIp: opts.ip,
        signerUserAgent: opts.userAgent?.slice(0, 500) ?? null,
        pdfUrl,
        auditTrail: trail as never,
      },
    }),
    prisma.hiringOffer.update({
      where: { id: envelope.offerId },
      data: { status: "accepted", respondedAt: signedAt },
    }),
    prisma.hiringApplicationEvent.create({
      data: {
        applicationId: envelope.offer.application.id,
        type: "offer_signed",
        actorId: null,
        payload: { offerId: envelope.offerId, signedBy: opts.typedName.trim(), pdfUrl },
      },
    }),
  ]);

  return {
    offerId: envelope.offerId,
    applicationId: envelope.offer.application.id,
    pdfUrl,
  };
}

