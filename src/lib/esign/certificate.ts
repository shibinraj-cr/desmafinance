import { rgb, type PDFPage } from "pdf-lib";
import { EVENT_LABELS } from "@/lib/esign/requests";
import { wrapLines, type StampSession } from "@/lib/esign/stamp";

/**
 * The certificate of completion appended to every signed agreement: who
 * signed, how they proved who they were, from where and when, the full event
 * history, the original document's fingerprint and the audit chain's hash at
 * completion — plus where anyone can check the file.
 */

export type CertificateSigner = {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  /** "One-time code by email (c***@x.com)" / "Signed in to DesGro as …" */
  verifiedBy: string;
  ip: string | null;
  userAgent: string | null;
  location: string | null;
  viewedAt: Date | null;
  signedAt: Date | null;
};

export type CertificateData = {
  reference: string;
  requestId: string;
  templateName: string;
  templateVersion: number | null;
  originalSha256: string | null;
  completedAt: Date;
  signers: CertificateSigner[];
  events: Array<{ at: Date; action: string; actor: string | null; ip: string | null }>;
  chainHash: string | null;
  verifyUrl: string;
  logoPng?: Uint8Array | null;
};


export function istTime(d: Date): string {
  return (
    d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Kolkata",
    }) + " IST"
  );
}

export function utcTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.8, 0.8, 0.82);

/** Append the certificate pages to an open stamping session. */
export async function appendCertificate(session: StampSession, data: CertificateData): Promise<void> {
  const { doc, font } = session;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const width = A4[0] - 2 * M;

  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
  };
  const ensure = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (s: string, opts: { size?: number; color?: typeof INK; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 9;
    const indent = opts.indent ?? 0;
    for (const line of wrapLines(s, width - indent, (t) => font.widthOfTextAtSize(t, size))) {
      ensure(size * 1.4);
      y -= size * 1.4;
      page.drawText(line, { x: M + indent, y, size, font, color: opts.color ?? INK });
    }
    y -= opts.gap ?? 0;
  };
  const field = (label: string, value: string | null) => text(`${label}: ${value ?? "—"}`, { indent: 12 });
  const rule = () => {
    ensure(10);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: RULE });
    y -= 4;
  };

  if (data.logoPng) {
    try {
      const logo = await doc.embedPng(data.logoPng);
      const h = 34;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
      y -= h + 10;
    } catch {
      /* a bad logo file must never block a signed agreement */
    }
  }
  text("Certificate of completion", { size: 18, gap: 4 });
  text("This page records how this agreement was signed electronically. It is part of the document.", { color: MUTED, gap: 6 });
  rule();
  field("Agreement", data.reference);
  field("Template", data.templateVersion ? `${data.templateName} (version ${data.templateVersion})` : data.templateName);
  field("Request ID", data.requestId);
  field("Completed", `${istTime(data.completedAt)}  ·  ${utcTime(data.completedAt)}`);
  field("Original document SHA-256", data.originalSha256);
  y -= 6;

  text("Signers", { size: 12, gap: 2 });
  rule();
  for (const s of data.signers) {
    ensure(110);
    text(`${s.name} — ${s.role}`, { size: 10.5 });
    field("Email", s.email);
    field("Phone", s.phone);
    field("Identity checked by", s.verifiedBy);
    field("IP address", s.ip);
    field("Device", s.userAgent ? s.userAgent.slice(0, 160) : null);
    field("Location", s.location ?? "Not shared");
    field("Opened", s.viewedAt ? `${istTime(s.viewedAt)}  ·  ${utcTime(s.viewedAt)}` : null);
    field("Signed", s.signedAt ? `${istTime(s.signedAt)}  ·  ${utcTime(s.signedAt)}` : null);
    y -= 6;
  }

  text("History", { size: 12, gap: 2 });
  rule();
  for (const e of data.events) {
    const who = [e.actor, e.ip].filter(Boolean).join(", ");
    text(`${istTime(e.at)} — ${EVENT_LABELS[e.action] ?? e.action}${who ? ` (${who})` : ""}`, { indent: 12, size: 8.5 });
  }
  y -= 8;
  rule();
  text("Audit trail hash at completion (SHA-256 chain):", { color: MUTED });
  text(data.chainHash ?? "—", { indent: 12 });
  text("Check this file at:", { color: MUTED });
  text(data.verifyUrl, { indent: 12 });
  text(
    "Upload the PDF there: it confirms whether this exact file is the one DESMA recorded when signing finished. Any change to the file — even one character — makes it fail.",
    { color: MUTED, size: 8 },
  );
}
