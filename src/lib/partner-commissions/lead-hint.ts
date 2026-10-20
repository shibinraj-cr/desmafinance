/**
 * The line under each lead in the enrollment form's lead search: service and
 * just enough of the phone and email to tell two same-named candidates apart.
 * Masked, because the search is open to people outside CRM (e.g. an OSCE/NCLEX
 * coordinator) — they can confirm a contact they typed without the list
 * handing out everyone else's.
 */

/** "asha.k@gmail.com" → "as***@gmail.com" */
export function maskEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  return `${e.slice(0, Math.min(2, at))}***${e.slice(at)}`;
}

/** "+91 98765 43210" → "…3210" */
export function maskPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `…${d.slice(-4)}` : null;
}

export function leadHint(l: { service?: string | null; phone?: string | null; altPhone?: string | null; email?: string | null }): string {
  return [l.service, maskPhone(l.phone) ?? maskPhone(l.altPhone), maskEmail(l.email)].filter(Boolean).join(" · ");
}
