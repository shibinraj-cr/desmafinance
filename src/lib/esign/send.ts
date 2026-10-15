import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from "@/lib/http-error";
import { mintToken } from "@/lib/hiring/envelope";
import { recordEsignEvent, requestOrigin } from "@/lib/esign/events";
import { siteBaseUrl } from "@/lib/site-url";
import { loadStampFont } from "@/lib/esign/font";
import { notifySigner, type ChannelResult } from "@/lib/esign/notify";
import { sha256Hex } from "@/lib/esign/pdf";
import { stampPdf, type StampItem } from "@/lib/esign/stamp";
import { deleteBlobQuietly, fieldFromRow, readBlobBytes } from "@/lib/esign/store";
import { isSendingEnabled } from "@/lib/esign/settings";
import {
  AGREEMENTS_PAGE,
  ESIGN_REQUEST_BLOB_PREFIX,
  MAX_EXPIRY_DAYS,
  SignerInputSchema,
  activeSigners,
  expiryFrom,
  isOpenStatus,
  maskEmail,
  maskPhone,
  mergeKeysOf,
  requestReference,
  sendProblems,
  type SendInput,
} from "@/lib/esign/requests";

/**
 * Agreement requests: saving drafts, sending, and the follow-up actions staff
 * take on a sent agreement (resend, change a contact, extend, cancel). Every
 * state change writes to the request's audit trail.
 */

export type AgreementCtx = {
  userId: string;
  /** How the actor appears on the audit trail. */
  actor: string;
  ip: string | null;
  userAgent: string | null;
  /** Absolute origin for signing links, e.g. https://desgro.in */
  baseUrl: string;
};

export type SignerDelivery = { signerId: string; name: string; role: string; results: ChannelResult[] };

/** Creating, sending and tracking agreements needs the Agreements page grant. */
export async function requireAgreementsUser(): Promise<{ userId: string; actor: string; isAdmin: boolean }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms || !canSeePage(perms, AGREEMENTS_PAGE)) throw forbidden();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
  return { userId, actor: user?.email ?? user?.username ?? userId, isAdmin: perms.isAdmin };
}

/** Who is acting, from where — for routes that change an agreement. */
export async function agreementContext(req: Request): Promise<AgreementCtx & { isAdmin: boolean }> {
  const user = await requireAgreementsUser();
  return { ...user, ...requestOrigin(req), baseUrl: siteBaseUrl(req) };
}

export function signingLink(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/$/, "")}/sign/${rawToken}`;
}

const signerSummary = (s: { role: string; name: string; email: string | null; phone: string | null; signOrder: number }) => ({
  role: s.role,
  name: s.name,
  email: maskEmail(s.email),
  phone: maskPhone(s.phone),
  signOrder: s.signOrder,
});

/**
 * Save a draft, or send. A send stamps the confirmed merge values into the
 * template PDF, stores it with its SHA-256, issues links to whoever signs
 * first, and then notifies them — notification results are returned and
 * logged, and a failed channel never undoes the send (staff can resend).
 */
export async function saveAgreement(input: SendInput, ctx: AgreementCtx): Promise<{ requestId: string; status: string; delivery: SignerDelivery[] }> {
  const version = await prisma.esignTemplateVersion.findUnique({
    where: { id: input.templateVersionId },
    include: { template: true, fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!version) throw notFound("That template version no longer exists.");
  if (!version.template.active) throw conflict("That template is archived.", "archived");
  if (version.template.currentVersionId !== version.id) {
    throw conflict("The template changed after you opened this page. Reload to use its latest version.", "stale_version");
  }
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true, candidateName: true } });
  if (!lead) throw notFound("That lead no longer exists.");

  const draft = input.draftId
    ? await prisma.esignRequest.findUnique({ where: { id: input.draftId }, select: { id: true, status: true, leadId: true } })
    : null;
  if (input.draftId && !draft) throw notFound("That draft no longer exists.");
  if (draft && draft.status !== "draft") throw conflict("That agreement has already been sent or cancelled.", "not_draft");
  if (draft && draft.leadId !== input.leadId) throw badRequest("That draft belongs to a different client.");

  const fields = version.fields.map(fieldFromRow);
  const problems = sendProblems({ input, fields });
  if (problems.length) throw unprocessable(problems.join(" "), "cannot_send");

  // Only the keys this template uses are kept: the snapshot is what was printed.
  const mergeData = Object.fromEntries(mergeKeysOf(fields).map((k) => [k, (input.mergeData[k] ?? "").trim()]));
  const now = new Date();
  const expiresAt = expiryFrom(now, input.expiresInDays);
  const common = {
    reference: requestReference(version.template.name, lead.candidateName),
    category: version.template.category,
    tags: [version.template.category],
    leadId: lead.id,
    templateVersionId: version.id,
    mergeData,
    reminderDays: input.reminderDays,
    cc: input.cc,
    message: input.message?.trim() || null,
    expiresAt,
  } satisfies Partial<Prisma.EsignRequestUncheckedCreateInput>;
  const signerRows = (requestId: string) =>
    input.signers.map((s) => ({ requestId, role: s.role, name: s.name, email: s.email, phone: s.phone, signOrder: s.signOrder }));

  if (input.action === "draft") {
    const requestId = await prisma.$transaction(async (tx) => {
      const req = draft
        ? await tx.esignRequest.update({ where: { id: draft.id }, data: common })
        : await tx.esignRequest.create({ data: { ...common, status: "draft", createdById: ctx.userId } });
      await tx.esignSigner.deleteMany({ where: { requestId: req.id } });
      await tx.esignSigner.createMany({ data: signerRows(req.id) });
      if (!draft) {
        await recordEsignEvent(tx, {
          requestId: req.id,
          action: "created",
          actor: ctx.actor,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          meta: { draft: true, templateVersionId: version.id, version: version.version },
        });
      }
      return req.id;
    });
    return { requestId, status: "draft", delivery: [] };
  }

  if (!(await isSendingEnabled())) {
    throw conflict(
      "Sending to clients is switched off until the signing page is live. Save it as a draft for now.",
      "sending_disabled",
    );
  }

  // The PDF exactly as sent: template + confirmed merge values.
  const items: StampItem[] = fields
    .filter((f) => f.mergeKey)
    .map((f) => ({
      kind: "text",
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      text: mergeData[f.mergeKey!] ?? "",
      fontSize: f.fontSize,
      alignment: f.alignment,
      multiline: f.type === "textarea",
    }));
  const pdf = await stampPdf(await readBlobBytes(version.blobPathname), await loadStampFont(), items);
  const originalSha256 = sha256Hex(pdf);
  const pathname = `${ESIGN_REQUEST_BLOB_PREFIX}${randomUUID()}/original.pdf`;
  await put(pathname, Buffer.from(pdf), { access: "private", contentType: "application/pdf", addRandomSuffix: false });

  let sent: { requestId: string; links: Array<{ signerId: string; raw: string }> };
  try {
    sent = await prisma.$transaction(async (tx) => {
      const data = { ...common, status: "sent" as const, sentAt: now, originalPathname: pathname, originalSha256 };
      const req = draft
        ? await tx.esignRequest.update({ where: { id: draft.id }, data })
        : await tx.esignRequest.create({ data: { ...data, createdById: ctx.userId } });
      await tx.esignSigner.deleteMany({ where: { requestId: req.id } });
      const signers = await Promise.all(signerRows(req.id).map((row) => tx.esignSigner.create({ data: { ...row, status: "waiting" } })));
      const links: Array<{ signerId: string; raw: string }> = [];
      for (const s of activeSigners(signers)) {
        const { raw, hash } = mintToken();
        await tx.esignSigner.update({ where: { id: s.id }, data: { status: "sent", tokenHash: hash, tokenExpiresAt: expiresAt } });
        links.push({ signerId: s.id, raw });
      }
      const origin = { actor: ctx.actor, ip: ctx.ip, userAgent: ctx.userAgent };
      if (!draft) {
        await recordEsignEvent(tx, { requestId: req.id, action: "created", ...origin, meta: { templateVersionId: version.id, version: version.version } });
      }
      await recordEsignEvent(tx, {
        requestId: req.id,
        action: "sent",
        ...origin,
        meta: {
          templateVersionId: version.id,
          version: version.version,
          originalSha256,
          expiresAt: expiresAt.toISOString(),
          signers: signers.map(signerSummary),
          linksIssuedTo: links.map((l) => signers.find((s) => s.id === l.signerId)!.role),
        },
      });
      return { requestId: req.id, links };
    });
  } catch (e) {
    await deleteBlobQuietly(pathname);
    throw e;
  }

  const delivery = await deliverLinks(sent.requestId, sent.links, ctx);
  return { requestId: sent.requestId, status: "sent", delivery };
}

/** Notify each signer of their new link and log what reached them. */
async function deliverLinks(requestId: string, links: Array<{ signerId: string; raw: string }>, ctx: AgreementCtx): Promise<SignerDelivery[]> {
  const req = await prisma.esignRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { signers: true, templateVersion: { include: { template: true } } },
  });
  const template = req.templateVersion!.template;
  const out: SignerDelivery[] = [];
  for (const { signerId, raw } of links) {
    const signer = req.signers.find((s) => s.id === signerId)!;
    const results = await notifySigner({
      request: { id: req.id, reference: req.reference, expiresAt: req.expiresAt!, message: req.message, leadId: req.leadId },
      template,
      signer,
      link: signingLink(ctx.baseUrl, raw),
      token: raw,
      actorId: ctx.userId,
    });
    await recordEsignEvent(prisma, {
      requestId: req.id,
      signerId,
      action: "notified",
      actor: "system",
      meta: { results: results as unknown as Prisma.InputJsonValue },
    });
    out.push({ signerId, name: signer.name, role: signer.role, results });
  }
  return out;
}

async function loadOpen(requestId: string) {
  const req = await prisma.esignRequest.findUnique({ where: { id: requestId }, include: { signers: true } });
  if (!req) throw notFound("That agreement no longer exists.");
  return req;
}

/**
 * Send a signer a fresh link. The old link stops working (only the new hash is
 * kept), which is also the remedy for a link sent to a wrong address.
 */
export async function resendLink(requestId: string, signerId: string, ctx: AgreementCtx): Promise<SignerDelivery> {
  const req = await loadOpen(requestId);
  if (!["sent", "viewed", "partially_signed"].includes(req.status)) {
    throw conflict("Only an agreement that is waiting for signatures can be resent.", "not_waiting");
  }
  if (!req.expiresAt || req.expiresAt <= new Date()) throw conflict("This agreement has expired. Extend it first.", "expired");
  if (!(await isSendingEnabled())) throw conflict("Sending to clients is switched off.", "sending_disabled");
  const signer = req.signers.find((s) => s.id === signerId);
  if (!signer) throw notFound("That signer is not on this agreement.");
  if (!activeSigners(req.signers).some((s) => s.id === signerId)) {
    throw conflict(`It is not ${signer.name}'s turn to sign yet.`, "not_their_turn");
  }

  const { raw, hash } = mintToken();
  await prisma.$transaction(async (tx) => {
    await tx.esignSigner.update({
      where: { id: signer.id },
      data: { tokenHash: hash, tokenExpiresAt: req.expiresAt, status: signer.status === "waiting" ? "sent" : signer.status },
    });
    await recordEsignEvent(tx, {
      requestId,
      signerId,
      action: "resent",
      actor: ctx.actor,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      meta: { previousLinkRevoked: !!signer.tokenHash },
    });
  });
  const [delivery] = await deliverLinks(requestId, [{ signerId, raw }], ctx);
  return delivery;
}

/** Change a signer's name, email or phone before they sign. Logged; resend to use it. */
export async function updateSignerContact(
  requestId: string,
  signerId: string,
  patch: { name?: string; email?: string | null; phone?: string | null },
  ctx: AgreementCtx,
): Promise<void> {
  const req = await loadOpen(requestId);
  if (!isOpenStatus(req.status)) throw conflict("This agreement is closed and cannot be changed.", "closed");
  const signer = req.signers.find((s) => s.id === signerId);
  if (!signer) throw notFound("That signer is not on this agreement.");
  if (["signed", "declined", "cancelled"].includes(signer.status)) throw conflict(`${signer.name} has already responded.`, "responded");

  const next = SignerInputSchema.pick({ name: true, email: true, phone: true }).parse({
    name: patch.name ?? signer.name,
    email: patch.email === undefined ? signer.email : patch.email,
    phone: patch.phone === undefined ? signer.phone : patch.phone,
  });
  if (!next.email && !next.phone) throw unprocessable(`${next.name} needs an email address or a WhatsApp number.`, "no_contact");

  const changed: Record<string, { from: string | null; to: string | null }> = {};
  if (next.name !== signer.name) changed.name = { from: signer.name, to: next.name };
  if (next.email !== signer.email) changed.email = { from: maskEmail(signer.email), to: maskEmail(next.email) };
  if (next.phone !== signer.phone) changed.phone = { from: maskPhone(signer.phone), to: maskPhone(next.phone) };
  if (!Object.keys(changed).length) return;

  await prisma.$transaction(async (tx) => {
    await tx.esignSigner.update({ where: { id: signerId }, data: next });
    await recordEsignEvent(tx, { requestId, signerId, action: "contact_changed", actor: ctx.actor, ip: ctx.ip, userAgent: ctx.userAgent, meta: { changed } });
  });
}

/** Push the expiry out (also revives an expired agreement). `until` is an IST date, YYYY-MM-DD. */
export async function extendAgreement(requestId: string, until: string, ctx: AgreementCtx): Promise<{ expiresAt: string }> {
  const req = await loadOpen(requestId);
  if (!["sent", "viewed", "partially_signed", "expired"].includes(req.status)) {
    throw conflict("Only an agreement waiting for signatures can be extended.", "not_waiting");
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  if (!m) throw badRequest("Pick a date.");
  const now = new Date();
  // End of that IST day, the same convention as the original expiry.
  const expiresAt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
  if (expiresAt <= now) throw badRequest("Pick a date in the future.");
  if (expiresAt > expiryFrom(now, MAX_EXPIRY_DAYS)) throw badRequest(`An agreement can stay open at most ${MAX_EXPIRY_DAYS} days from today.`);

  await prisma.$transaction(async (tx) => {
    await tx.esignRequest.update({
      where: { id: requestId },
      data: { expiresAt, ...(req.status === "expired" ? { status: "sent" } : {}) },
    });
    await tx.esignSigner.updateMany({ where: { requestId, tokenHash: { not: null } }, data: { tokenExpiresAt: expiresAt } });
    await recordEsignEvent(tx, {
      requestId,
      action: "expiry_extended",
      actor: ctx.actor,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      meta: { from: req.expiresAt?.toISOString() ?? null, to: expiresAt.toISOString(), reopened: req.status === "expired" },
    });
  });
  return { expiresAt: expiresAt.toISOString() };
}

/** Cancel (or discard a draft). Every outstanding link stops working at once. */
export async function cancelAgreement(requestId: string, reason: string, ctx: AgreementCtx): Promise<void> {
  const req = await loadOpen(requestId);
  if (!isOpenStatus(req.status)) throw conflict("This agreement is already closed.", "closed");
  const why = reason.trim();
  if (!why) throw badRequest("Say why it is being cancelled.");
  await prisma.$transaction(async (tx) => {
    await tx.esignRequest.update({ where: { id: requestId }, data: { status: "cancelled", cancelledReason: why.slice(0, 500) } });
    await tx.esignSigner.updateMany({
      where: { requestId, status: { notIn: ["signed", "declined"] } },
      data: { status: "cancelled", tokenHash: null },
    });
    await recordEsignEvent(tx, {
      requestId,
      action: "cancelled",
      actor: ctx.actor,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      meta: { reason: why.slice(0, 500), wasDraft: req.status === "draft" },
    });
  });
}
