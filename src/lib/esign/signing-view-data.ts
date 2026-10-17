import { head } from "@vercel/blob";
import type { EsignSigner } from "@prisma/client";
import { formatLongDate } from "@/lib/esign/merge-values";
import type { LoadedRequest } from "@/lib/esign/signing";
import { fieldFromRow } from "@/lib/esign/store";
import { signerFields } from "@/lib/esign/submission";
import { readPageGeometry } from "@/lib/esign/templates";

/** Everything the signing screen needs for one signer, from the server's view of the agreement. */
export async function signingViewData(request: LoadedRequest, signer: EsignSigner) {
  const version = request.templateVersion!;
  const fields = version.fields.map(fieldFromRow);
  const pendingRoles = new Set(request.signers.filter((s) => s.id !== signer.id && s.status !== "signed").map((s) => s.role));
  const later = fields
    .filter((f) => !f.mergeKey && f.role !== signer.role && pendingRoles.has(f.role))
    .map((f) => ({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, role: f.role }));
  const pathname = request.currentPathname ?? request.originalPathname!;
  const fileSize = (await head(pathname).catch(() => null))?.size ?? 0;
  return {
    title: version.template.name,
    signer: { name: signer.name, email: signer.email, phone: signer.phone, role: signer.role },
    fields: signerFields(fields, signer.role),
    later,
    pages: readPageGeometry(version.pages, version.numPages),
    fileSize,
    today: formatLongDate(new Date()),
  };
}
