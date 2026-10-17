import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { PDFDocument } from "pdf-lib";
import type { EsignSigner, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/crm";
import { recordLeadActivity } from "@/lib/crm-activity";
import { conflict, notFound, unprocessable, HttpError } from "@/lib/http-error";
import { hashToken } from "@/lib/hiring/envelope";
import { cloudProvider } from "@/lib/wa/cloud-provider";
import { appendCertificate, type CertificateSigner } from "@/lib/esign/certificate";
import { recordEsignEvent } from "@/lib/esign/events";
import { loadStampFont } from "@/lib/esign/font";
import { activateSigners, deliverActivated, type Activated, type SignerDelivery } from "@/lib/esign/handoff";
import { onAgreementSigned } from "@/lib/esign/hooks";
import { sendOtpEmail, sendSignedCopies, type ChannelResult } from "@/lib/esign/notify";
import { OTP_TTL_MS, checkOtp, hashOtp, mintSession, newOtpCode } from "@/lib/esign/otp";
import { sha256Hex } from "@/lib/esign/pdf";
import { activeSigners, maskEmail, maskPhone } from "@/lib/esign/requests";
import { getOtpWhatsAppTemplate, signedCopyRecipients } from "@/lib/esign/settings";
import { openForStamping, stampInto } from "@/lib/esign/stamp";
import { deleteBlobQuietly, fieldFromRow, readBlobBytes } from "@/lib/esign/store";
import { checkSubmission, type Submission } from "@/lib/esign/submission";
import { rateLimit } from "@/lib/hiring/rate-limit";

/**
 * Signing an agreement: opening the link, proving who you are, filling and
 * signing, declining — and, after the last signature, sealing the document
 * with its certificate.
 *
 * The document grows one signer at a time. Each completed signer's values are
 * burned into a new copy (`currentPathname`), so the next signer sees and
 * signs exactly what came before them; the final copy adds the certificate.
 */

export type Origin = { ip: string | null; userAgent: string | null };

const OPEN_FOR_SIGNING = ["sent", "viewed", "partially_signed"];

const requestInclude = {
  signers: { orderBy: { signOrder: "asc" } },
  lead: { select: { id: true, candidateName: true, phoneE164: true } },
  createdBy: { select: { email: true, username: true } },
  templateVersion: { include: { template: true, fields: { orderBy: { sortOrder: "asc" } } } },
} satisfies Prisma.EsignRequestInclude;

export type LoadedRequest = Prisma.EsignRequestGetPayload<{ include: typeof requestInclude }>;

export type LinkState =
  | { kind: "invalid" }
  | { kind: "expired" | "cancelled" | "declined" | "done" | "waiting_turn"; request: LoadedRequest; signer: EsignSigner }
  | { kind: "open"; request: LoadedRequest; signer: EsignSigner };

function judge(request: LoadedRequest, signer: EsignSigner, now: Date): Exclude<LinkState, { kind: "invalid" }> {
  if (signer.status === "signed") return { kind: "done", request, signer };
  if (request.status === "declined" || signer.status === "declined") return { kind: "declined", request, signer };
  if (request.status === "cancelled" || signer.status === "cancelled") return { kind: "cancelled", request, signer };
  const expired =
    request.status === "expired" ||
    (request.expiresAt && request.expiresAt <= now) ||
    (signer.tokenExpiresAt && signer.tokenExpiresAt <= now);
  if (expired) return { kind: "expired", request, signer };
  if (!OPEN_FOR_SIGNING.includes(request.status) || !activeSigners(request.signers).some((s) => s.id === signer.id)) {
    return { kind: "waiting_turn", request, signer };
  }
  return { kind: "open", request, signer };
}

/** The signer and agreement behind a public link, and what state they are in. */
export async function resolveLink(rawToken: string, now = new Date()): Promise<LinkState> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { kind: "invalid" };
  const signer = await prisma.esignSigner.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!signer) return { kind: "invalid" };
  const request = await prisma.esignRequest.findUnique({ where: { id: signer.requestId }, include: requestInclude });
  if (!request) return { kind: "invalid" };
  return judge(request, signer, now);
}

/** The DESMA signer seat a logged-in user holds on an agreement, and its state. */
export async function resolveInternalSeat(requestId: string, userId: string, now = new Date()): Promise<LinkState> {
  const request = await prisma.esignRequest.findUnique({ where: { id: requestId }, include: requestInclude });
  const signer = request?.signers.find((s) => s.userId === userId);
  if (!request || !signer) return { kind: "invalid" };
  return judge(request, signer, now);
}

/** First open moves the signer (and a just-sent agreement) to "viewed"; opens are logged at most hourly. */
export async function recordOpened(request: LoadedRequest, signer: EsignSigner, origin: Origin, actor: string): Promise<void> {
  const now = new Date();
  if (!signer.viewedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.esignSigner.update({ where: { id: signer.id }, data: { viewedAt: now, ...(signer.status === "sent" ? { status: "viewed" } : {}) } });
      if (request.status === "sent") await tx.esignRequest.update({ where: { id: request.id }, data: { status: "viewed" } });
      await recordEsignEvent(tx, { requestId: request.id, signerId: signer.id, action: "opened", actor, ...origin, meta: { first: true } });
    });
    return;
  }
  const last = await prisma.esignEvent.findFirst({
    where: { requestId: request.id, signerId: signer.id, action: "opened" },
    orderBy: { seq: "desc" },
    select: { createdAt: true },
  });
  if (!last || now.getTime() - last.createdAt.getTime() > 60 * 60 * 1000) {
    await recordEsignEvent(prisma, { requestId: request.id, signerId: signer.id, action: "opened", actor, ...origin });
  }
}

export type OtpChannel = "email" | "whatsapp";

/** Where a signer can receive a code (masked for display). */
export async function otpChannels(request: LoadedRequest, signer: EsignSigner): Promise<Array<{ channel: OtpChannel; to: string }>> {
  const out: Array<{ channel: OtpChannel; to: string }> = [];
  if (signer.email) out.push({ channel: "email", to: maskEmail(signer.email)! });
  const phone = normalizePhone(signer.phone) ?? (signer.role === "Client" ? request.lead?.phoneE164 ?? null : null);
  if (phone && (await getOtpWhatsAppTemplate())) out.push({ channel: "whatsapp", to: maskPhone(phone)! });
  return out;
}

/** Send a fresh one-time code. Rate-limited; refused while the signer is locked out. */
export async function sendOtp(request: LoadedRequest, signer: EsignSigner, channel: OtpChannel, origin: Origin): Promise<{ to: string }> {
  const now = new Date();
  if (signer.otpLockedUntil && signer.otpLockedUntil > now) {
    throw new HttpError(423, "Too many wrong codes. Try again after 30 minutes.", "otp_locked");
  }
  // At most one code every 30 seconds, and five an hour.
  if (signer.otpExpiresAt && signer.otpExpiresAt.getTime() - OTP_TTL_MS > now.getTime() - 30_000) {
    throw new HttpError(429, "A code was just sent. Wait half a minute before asking for another.", "otp_too_soon");
  }
  if (!rateLimit(`esign:otp:${signer.id}`, 5, 60 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many codes requested. Try again in an hour.", "otp_rate_limited");
  }
  const options = await otpChannels(request, signer);
  const target = options.find((o) => o.channel === channel);
  if (!target) throw unprocessable("That way of receiving a code is not available.", "otp_channel");

  const code = newOtpCode();
  const agreementName = request.templateVersion?.template.name ?? "agreement";
  if (channel === "email") {
    await sendOtpEmail(signer.email!, signer.name, code, agreementName);
  } else {
    const template = (await getOtpWhatsAppTemplate())!;
    const phone = normalizePhone(signer.phone) ?? request.lead?.phoneE164 ?? null;
    // Meta AUTHENTICATION templates: the code fills body {{1}} and the copy-code button.
    const res = await cloudProvider.sendTemplate({ toE164: phone!, template, params: { "1": code, "button.0.1": code }, endpointUrl: null });
    if (!res.ok) throw new HttpError(502, "WhatsApp did not accept the code message. Try email instead.", "otp_send_failed");
  }
  await prisma.$transaction(async (tx) => {
    await tx.esignSigner.update({
      where: { id: signer.id },
      data: { otpHash: hashOtp(signer.id, code), otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS), otpAttempts: 0, otpChannel: channel },
    });
    await recordEsignEvent(tx, { requestId: request.id, signerId: signer.id, action: "otp_sent", actor: signer.name, ...origin, meta: { channel, to: target.to } });
  });
  return { to: target.to };
}

/** Check a typed code. On success returns the session cookie value for this signer and link. */
export async function verifyOtp(request: LoadedRequest, signer: EsignSigner, code: string, origin: Origin): Promise<{ session: string }> {
  const now = new Date();
  const { result, nextState } = checkOtp(signer, signer.id, code, now);
  await prisma.$transaction(async (tx) => {
    if (Object.keys(nextState).length) await tx.esignSigner.update({ where: { id: signer.id }, data: nextState });
    await recordEsignEvent(tx, {
      requestId: request.id,
      signerId: signer.id,
      action: result.ok ? "otp_verified" : "otp_failed",
      actor: signer.name,
      ...origin,
      meta: result.ok ? { channel: signer.otpChannel } : { reason: result.reason, ...("attemptsLeft" in result ? { attemptsLeft: result.attemptsLeft } : {}) },
    });
  });
  if (result.ok) return { session: mintSession(signer.id, signer.tokenHash ?? "", now) };
  if (result.reason === "locked" || (result.reason === "wrong" && result.lockedUntil)) {
    throw new HttpError(423, "Too many wrong codes. Try again after 30 minutes.", "otp_locked");
  }
  if (result.reason === "wrong") {
    throw unprocessable(`That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left.`, "otp_wrong");
  }
  throw unprocessable("That code has expired. Ask for a new one.", "otp_expired");
}

let logo: Promise<Uint8Array | null> | null = null;
const loadLogo = () =>
  (logo ??= readFile(path.join(process.cwd(), "public", "desma-logo.png"))
    .then((b) => new Uint8Array(b))
    .catch(() => null));

const folderOf = (pathname: string) => pathname.slice(0, pathname.lastIndexOf("/") + 1);

export type CompleteResult = {
  status: "partially_signed" | "signed";
  next: SignerDelivery[];
  signedCopies: ChannelResult[];
};

/**
 * A signer finishes. Their values are checked, burned into the document as it
 * stands, and the agreement moves on: to the next signer, or — after the last
 * — sealed with the certificate and emailed to everyone.
 */
export async function completeSigning(opts: {
  requestId: string;
  signerId: string;
  submission: Submission;
  origin: Origin;
  actor: string;
  verifiedBy: string;
  baseUrl: string;
  actorUserId: string | null;
}): Promise<CompleteResult> {
  const request = await prisma.esignRequest.findUnique({ where: { id: opts.requestId }, include: requestInclude });
  if (!request || !request.templateVersion) throw notFound("That agreement no longer exists.");
  const fields = request.templateVersion.fields.map(fieldFromRow);
  const signerRow = request.signers.find((s) => s.id === opts.signerId);
  if (!signerRow) throw notFound("You are not a signer on this agreement.");
  const checked = checkSubmission(fields, signerRow.role, opts.submission);
  if (checked.errors.length) throw unprocessable(checked.errors.join(" "), "incomplete");

  // A PNG that passes the signature check can still be undecodable; refuse it
  // here, before anything is stored, rather than failing mid-stamp.
  for (const v of checked.values) {
    if (!v.png) continue;
    try {
      await (await PDFDocument.create()).embedPng(v.png);
    } catch {
      throw unprocessable(`The ${v.field.type === "initial" ? "initials" : "signature"} in ${v.field.label ?? v.field.key} could not be read. Please sign it again.`, "bad_image");
    }
  }

  const folder = folderOf(request.originalPathname!);
  const uploaded: string[] = [];
  const store = async (name: string, bytes: Uint8Array, contentType: string) => {
    const pathname = `${folder}${name}`;
    await put(pathname, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: false });
    uploaded.push(pathname);
    return pathname;
  };

  // Signature images first (outside the transaction: they are not ordered).
  const imagePaths = new Map<string, string>();
  for (const v of checked.values) {
    if (v.png) imagePaths.set(v.field.key, await store(`sig-${opts.signerId}-${v.field.key}-${randomUUID().slice(0, 8)}.png`, v.png, "image/png"));
  }

  const font = await loadStampFont();
  let outcome: { status: "partially_signed" | "signed"; activated: Activated[]; signedPdf: Uint8Array | null };
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        // One signer at a time per agreement: each builds on the copy before it.
        await tx.$queryRaw`SELECT id FROM "EsignRequest" WHERE id = ${request.id} FOR UPDATE`;
        const fresh = await tx.esignRequest.findUniqueOrThrow({ where: { id: request.id }, include: { signers: { orderBy: { signOrder: "asc" } } } });
        const me = fresh.signers.find((s) => s.id === opts.signerId)!;
        const now = new Date();
        if (!OPEN_FOR_SIGNING.includes(fresh.status)) throw conflict("This agreement is no longer open for signing.", "closed");
        if (fresh.expiresAt && fresh.expiresAt <= now) throw conflict("This agreement has expired.", "expired");
        if (me.status === "signed") throw conflict("You have already signed this agreement.", "already_signed");
        if (!activeSigners(fresh.signers).some((s) => s.id === me.id)) throw conflict("It is not your turn to sign yet.", "not_your_turn");

        const session = await openForStamping(await readBlobBytes(fresh.currentPathname ?? fresh.originalPathname!), font);
        await stampInto(session, checked.items);

        await tx.esignFieldValue.createMany({
          data: checked.values.map((v) => ({
            requestId: fresh.id,
            signerId: me.id,
            fieldId: null,
            fieldKey: v.field.key,
            fieldType: v.field.type,
            page: v.field.page,
            x: v.field.x,
            y: v.field.y,
            w: v.field.w,
            h: v.field.h,
            value: v.png ? imagePaths.get(v.field.key)! : v.value,
          })),
        });
        await tx.esignSigner.update({
          where: { id: me.id },
          data: {
            status: "signed",
            signedAt: now,
            ip: opts.origin.ip,
            userAgent: opts.origin.userAgent?.slice(0, 500) ?? null,
            latitude: opts.submission.location?.lat ?? null,
            longitude: opts.submission.location?.lng ?? null,
          },
        });
        const origin = { actor: opts.actor, ...opts.origin };
        await recordEsignEvent(tx, {
          requestId: fresh.id,
          signerId: me.id,
          action: "field_saved",
          ...origin,
          meta: { fields: checked.values.map((v) => v.field.key) },
        });

        const remaining = fresh.signers.filter((s) => s.id !== me.id && s.status !== "signed");
        if (remaining.length > 0) {
          const bytes = await session.doc.save();
          const sha = sha256Hex(bytes);
          const stage = await store(`stage-${fresh.signers.length - remaining.length}-${randomUUID().slice(0, 8)}.pdf`, bytes, "application/pdf");
          await recordEsignEvent(tx, { requestId: fresh.id, signerId: me.id, action: "signed", ...origin, meta: { documentSha256: sha, verifiedBy: opts.verifiedBy } });
          await tx.esignRequest.update({ where: { id: fresh.id }, data: { status: "partially_signed", currentPathname: stage, currentSha256: sha } });
          const after = fresh.signers.map((s) => (s.id === me.id ? { ...s, status: "signed" } : s));
          const activated = await activateSigners(tx, after, fresh.expiresAt!);
          return { status: "partially_signed" as const, activated, signedPdf: null };
        }

        // Last signature: seal it.
        await recordEsignEvent(tx, { requestId: fresh.id, signerId: me.id, action: "signed", ...origin, meta: { verifiedBy: opts.verifiedBy } });
        await recordEsignEvent(tx, { requestId: fresh.id, action: "completed", actor: "system" });
        const events = await tx.esignEvent.findMany({ where: { requestId: fresh.id }, orderBy: { seq: "asc" } });
        const signedSigners = await tx.esignSigner.findMany({ where: { requestId: fresh.id }, orderBy: { signOrder: "asc" } });
        const verifiedFor = await verificationLines(tx, fresh.id);
        await appendCertificate(session, {
          reference: fresh.reference,
          requestId: fresh.id,
          templateName: request.templateVersion!.template.name,
          templateVersion: request.templateVersion!.version,
          originalSha256: fresh.originalSha256,
          completedAt: now,
          signers: signedSigners.map(
            (s): CertificateSigner => ({
              name: s.name,
              role: s.role,
              email: maskEmail(s.email),
              phone: maskPhone(s.phone),
              verifiedBy: s.id === me.id ? opts.verifiedBy : verifiedFor.get(s.id) ?? "—",
              ip: s.ip,
              userAgent: s.userAgent,
              location: s.latitude != null && s.longitude != null ? `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}` : null,
              viewedAt: s.viewedAt,
              signedAt: s.signedAt,
            }),
          ),
          events: events.map((e) => ({ at: e.createdAt, action: e.action, actor: e.actor, ip: e.ip })),
          chainHash: events[events.length - 1]?.hash ?? null,
          verifyUrl: `${opts.baseUrl.replace(/\/$/, "")}/verify/${fresh.id}`,
          logoPng: await loadLogo(),
        });
        const signedPdf = await session.doc.save();
        const signedSha256 = sha256Hex(signedPdf);
        const signedPathname = await store(`signed-${randomUUID().slice(0, 8)}.pdf`, signedPdf, "application/pdf");
        await tx.esignRequest.update({
          where: { id: fresh.id },
          data: { status: "signed", completedAt: now, signedPathname, signedSha256, currentPathname: signedPathname, currentSha256: signedSha256 },
        });
        return { status: "signed" as const, activated: [], signedPdf };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    for (const p of uploaded) await deleteBlobQuietly(p);
    throw e;
  }

  if (outcome.status === "partially_signed") {
    const next = await deliverActivated(request.id, outcome.activated, { baseUrl: opts.baseUrl, userId: opts.actorUserId });
    return { status: outcome.status, next, signedCopies: [] };
  }

  const done = await prisma.esignRequest.findUniqueOrThrow({ where: { id: request.id }, include: { signers: true } });
  const cc = (Array.isArray(done.cc) ? done.cc : []) as Array<{ name: string; email: string }>;
  const signedCopies = await sendSignedCopies({
    reference: done.reference,
    templateName: request.templateVersion.template.name,
    recipients: [
      ...done.signers.filter((s) => s.email).map((s) => ({ name: s.name, email: s.email! })),
      ...cc,
      ...(request.createdBy?.email ? [{ name: request.createdBy.username, email: request.createdBy.email }] : []),
      // DESMA's own inbox gets every signed agreement (hello@desma.in by default).
      ...(await signedCopyRecipients()).map((email) => ({ name: "DESMA International", email })),
    ],
    pdf: outcome.signedPdf!,
    verifyUrl: `${opts.baseUrl.replace(/\/$/, "")}/verify/${done.id}`,
  });
  await recordEsignEvent(prisma, { requestId: done.id, action: "notified", actor: "system", meta: { signedCopies: signedCopies as unknown as Prisma.InputJsonValue } });
  await onAgreementSigned({ id: done.id, reference: done.reference, leadId: done.leadId, signedSha256: done.signedSha256 });
  return { status: "signed", next: [], signedCopies };
}

/** How each earlier signer proved who they were, read back from the trail. */
async function verificationLines(tx: Prisma.TransactionClient, requestId: string): Promise<Map<string, string>> {
  const signed = await tx.esignEvent.findMany({ where: { requestId, action: "signed" }, select: { signerId: true, meta: true } });
  return new Map(
    signed
      .filter((e) => e.signerId)
      .map((e) => [e.signerId!, String((e.meta as { verifiedBy?: string } | null)?.verifiedBy ?? "—")]),
  );
}

/** A signer declines. The agreement stops; every outstanding link is revoked; the sender is told. */
export async function declineSigning(opts: { requestId: string; signerId: string; reason: string; origin: Origin; actor: string }): Promise<void> {
  const why = opts.reason.trim().slice(0, 1000);
  if (!why) throw unprocessable("Tell us briefly why, so DESMA can follow up.", "no_reason");
  const request = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EsignRequest" WHERE id = ${opts.requestId} FOR UPDATE`;
    const fresh = await tx.esignRequest.findUniqueOrThrow({ where: { id: opts.requestId }, include: { signers: true, createdBy: { select: { email: true, username: true } } } });
    const me = fresh.signers.find((s) => s.id === opts.signerId);
    if (!me) throw notFound("You are not a signer on this agreement.");
    if (!OPEN_FOR_SIGNING.includes(fresh.status) || me.status === "signed") throw conflict("This agreement can no longer be declined.", "closed");
    const now = new Date();
    await tx.esignSigner.update({
      where: { id: me.id },
      data: { status: "declined", declinedAt: now, declineReason: why, ip: opts.origin.ip, userAgent: opts.origin.userAgent?.slice(0, 500) ?? null },
    });
    await tx.esignSigner.updateMany({
      where: { requestId: fresh.id, id: { not: me.id }, status: { notIn: ["signed", "declined"] } },
      data: { status: "cancelled", tokenHash: null },
    });
    await tx.esignRequest.update({ where: { id: fresh.id }, data: { status: "declined" } });
    await recordEsignEvent(tx, { requestId: fresh.id, signerId: me.id, action: "declined", actor: opts.actor, ...opts.origin, meta: { reason: why } });
    return { ...fresh, me };
  });

  if (request.leadId) {
    await recordLeadActivity({
      leadId: request.leadId,
      type: "AGREEMENT_DECLINED",
      summary: `${request.me.name} declined the agreement: ${why}`,
      metadata: { esignRequestId: request.id },
    });
  }
}
