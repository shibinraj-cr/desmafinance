import type { PdfBlock } from "./pdf";
import { formatHiringDate, formatHiringDateTime, totalCtcLakh } from "./core";

/**
 * The offer letter itself — the same terms rendered two ways: HTML for the
 * screen, and PDF blocks for the archived artefact.
 *
 * Deliberately free of any database import, so the offer simulator can render a
 * live preview from THIS code as the recruiter types. A preview built from a
 * second, parallel template is a preview that eventually disagrees with the
 * letter that actually gets sent.
 */

/** One line of the tamper-evident trail printed at the foot of the archived PDF. */
export type AuditEntry = {
  at: string;
  event: "created" | "viewed" | "signed" | "declined" | "expired";
  ip: string | null;
  userAgent: string | null;
  note?: string;
};

export type LetterData = {
  candidateName: string;
  jobTitle: string;
  department: string | null;
  locationName: string | null;
  startDate: Date | null;
  baseLakh: number;
  variableLakh: number | null;
  joiningBonusLakh: number | null;
  probationMonths: number | null;
  noticePeriodDays: number | null;
  otherTermsMd: string | null;
  expiresAt: Date | null;
};

const COMPANY = {
  name: "DESMA International Private Limited",
  address: "XVI 195/C, First Floor, Keltron Road, Aroor, Kerala 688534, India",
  cin: "U70200KL2023PTC084811",
  email: "hello@desma.in",
};

function money(lakh: number): string {
  return `₹${lakh.toFixed(2).replace(/\.00$/, "")} lakh per year`;
}

/** The letter as HTML, for the on-screen document. */
export function letterHtml(d: LetterData): string {
  const total = totalCtcLakh({
    baseLakh: d.baseLakh,
    variableLakh: d.variableLakh,
    joiningBonusLakh: d.joiningBonusLakh,
  });
  const rows: [string, string][] = [
    ["Role", d.jobTitle],
    ...(d.department ? ([["Department", d.department]] as [string, string][]) : []),
    ...(d.locationName ? ([["Place of work", d.locationName]] as [string, string][]) : []),
    ["Start date", d.startDate ? formatHiringDate(d.startDate) : "To be agreed"],
    ["Fixed base", money(d.baseLakh)],
    ...(d.variableLakh ? ([["Variable pay", money(d.variableLakh)]] as [string, string][]) : []),
    ...(d.joiningBonusLakh
      ? ([["Joining bonus", `₹${d.joiningBonusLakh.toFixed(2).replace(/\.00$/, "")} lakh`]] as [string, string][])
      : []),
    ["Total CTC", money(total)],
    ...(d.probationMonths ? ([["Probation", `${d.probationMonths} months`]] as [string, string][]) : []),
    ...(d.noticePeriodDays ? ([["Notice period", `${d.noticePeriodDays} days`]] as [string, string][]) : []),
  ];

  return `<article class="letter">
  <header>
    <h1>${esc(COMPANY.name)}</h1>
    <p>${esc(COMPANY.address)}<br />CIN: ${esc(COMPANY.cin)} · ${esc(COMPANY.email)}</p>
  </header>
  <h2>Offer of Employment</h2>
  <p>Dear ${esc(d.candidateName)},</p>
  <p>We are pleased to offer you a position with ${esc(COMPANY.name)} on the terms set out below.</p>
  <table>
    <tbody>
      ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n      ")}
    </tbody>
  </table>
  ${d.otherTermsMd ? `<h3>Other terms</h3><p>${esc(d.otherTermsMd).replace(/\n/g, "<br />")}</p>` : ""}
  <p>This offer is subject to satisfactory reference and document checks.${
    d.expiresAt ? ` It is open for acceptance until ${esc(formatHiringDate(d.expiresAt))}.` : ""
  }</p>
  <p>We hope you will join us.</p>
  <p>Yours sincerely,<br />${esc(COMPANY.name)}</p>
</article>`;
}

/** The same letter as PDF blocks — the archived artefact. */
export function letterPdfBlocks(
  d: LetterData,
  signature: { name: string; signedAt: Date; ip: string | null; userAgent: string | null } | null,
  auditTrail: AuditEntry[],
): PdfBlock[] {
  const total = totalCtcLakh({
    baseLakh: d.baseLakh,
    variableLakh: d.variableLakh,
    joiningBonusLakh: d.joiningBonusLakh,
  });

  const blocks: PdfBlock[] = [
    { type: "heading", text: COMPANY.name },
    { type: "text", text: COMPANY.address },
    { type: "text", text: `CIN: ${COMPANY.cin}  ·  ${COMPANY.email}` },
    { type: "rule" },
    { type: "heading", text: "Offer of Employment" },
    { type: "text", text: `Dear ${d.candidateName},` },
    { type: "spacer" },
    {
      type: "text",
      text: `We are pleased to offer you a position with ${COMPANY.name} on the terms set out below.`,
    },
    { type: "subheading", text: "Terms" },
    { type: "bullet", text: `Role: ${d.jobTitle}` },
  ];

  if (d.department) blocks.push({ type: "bullet", text: `Department: ${d.department}` });
  if (d.locationName) blocks.push({ type: "bullet", text: `Place of work: ${d.locationName}` });
  blocks.push({
    type: "bullet",
    text: `Start date: ${d.startDate ? formatHiringDate(d.startDate) : "To be agreed"}`,
  });
  blocks.push({ type: "bullet", text: `Fixed base: ${money(d.baseLakh)}` });
  if (d.variableLakh) blocks.push({ type: "bullet", text: `Variable pay: ${money(d.variableLakh)}` });
  if (d.joiningBonusLakh) {
    blocks.push({ type: "bullet", text: `Joining bonus: ₹${d.joiningBonusLakh} lakh` });
  }
  blocks.push({ type: "bullet", text: `Total CTC: ${money(total)}` });
  if (d.probationMonths) blocks.push({ type: "bullet", text: `Probation: ${d.probationMonths} months` });
  if (d.noticePeriodDays) blocks.push({ type: "bullet", text: `Notice period: ${d.noticePeriodDays} days` });

  if (d.otherTermsMd) {
    blocks.push({ type: "subheading", text: "Other terms" });
    for (const line of d.otherTermsMd.split("\n").filter(Boolean)) {
      blocks.push({ type: "text", text: line });
    }
  }

  blocks.push(
    { type: "spacer" },
    { type: "text", text: "This offer is subject to satisfactory reference and document checks." },
    { type: "spacer" },
    { type: "text", text: `Yours sincerely,` },
    { type: "text", text: COMPANY.name },
  );

  if (signature) {
    blocks.push(
      { type: "rule" },
      { type: "subheading", text: "Accepted by the candidate" },
      { type: "bullet", text: `Signed by: ${signature.name}` },
      { type: "bullet", text: `Signed at: ${formatHiringDateTime(signature.signedAt)} IST` },
      { type: "bullet", text: `IP address: ${signature.ip ?? "not recorded"}` },
      { type: "bullet", text: `Browser: ${(signature.userAgent ?? "not recorded").slice(0, 120)}` },
    );
  }

  if (auditTrail.length) {
    blocks.push({ type: "subheading", text: "Audit trail" });
    for (const entry of auditTrail) {
      blocks.push({
        type: "bullet",
        text: `${formatHiringDateTime(entry.at)} IST — ${entry.event}${entry.ip ? ` from ${entry.ip}` : ""}`,
      });
    }
  }

  return blocks;
}


/**
 * Escape a value being interpolated into the letter HTML. Every interpolation
 * in `letterHtml` goes through this, which is what makes it safe for the
 * signing page to render the stored document directly.
 */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
