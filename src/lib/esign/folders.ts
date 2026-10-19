import { cleanName, extensionOf, safeBlobFileName } from "@/lib/finance-docs";

/**
 * Agreements → Folders — the pure rules behind filed agreement documents.
 *
 * Folders hold agreements that exist only as files: signed outside Desgro
 * (the Odoo Sign archive, paper scans), so there is no template, signer or
 * audit trail to rebuild. No I/O here; the Blob and database calls live in
 * folders-store.ts and the API routes. Two decisions worth knowing first:
 *
 * 1. **Folders are flat.** One level, named by where the agreements came from
 *    ("Odoo Agreements"). Uploading a folder from the computer files
 *    everything inside it, sub-folders included, into the folder being viewed.
 *
 * 2. **Only PDFs and images.** These are signed agreements, and a file of any
 *    other type would be served from our own origin.
 */

/** Folders sit under the Agreements grant: whoever sends agreements files them. */
export const AGREEMENT_FOLDERS_PAGE = "/operations/agreements/folders";

/** Every filed document lives under this prefix in the private Blob store. */
export const AGREEMENT_DOCS_BLOB_PREFIX = "esign/archive/";

/** A scanned, multi-page agreement can run large; 50 MB leaves plenty of room. */
export const MAX_AGREEMENT_DOC_BYTES = 50 * 1024 * 1024;

/** Content type → the extension a file of that type is saved with. */
export const AGREEMENT_DOC_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
} as const;

export type AgreementDocType = keyof typeof AGREEMENT_DOC_TYPES;

export const ALLOWED_AGREEMENT_DOC_TYPES = Object.keys(AGREEMENT_DOC_TYPES) as AgreementDocType[];

const EXTENSION_TYPES: Record<string, AgreementDocType> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export function isAgreementDocType(type: string): type is AgreementDocType {
  return (ALLOWED_AGREEMENT_DOC_TYPES as string[]).includes(type);
}

/**
 * What a file really is, from its first bytes. Browsers report no type at all
 * for a file without an extension (Odoo exports a few like that), so this is
 * the fallback that still lets a genuine PDF in.
 */
export function sniffAgreementDocType(head: Uint8Array): AgreementDocType | null {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/**
 * The type a picked file uploads as: the browser's, when it is one we accept,
 * else what the extension says, else what the first bytes say. Null means the
 * file is refused.
 */
export function agreementDocTypeOf(file: { name: string; type: string }, head?: Uint8Array): AgreementDocType | null {
  if (isAgreementDocType(file.type)) return file.type;
  const byExtension = EXTENSION_TYPES[extensionOf(file.name).toLowerCase()];
  if (byExtension) return byExtension;
  return head ? sniffAgreementDocType(head) : null;
}

/**
 * The display name a document is filed under: tidied, and given the extension
 * of its type when it has none, so it opens in the right app once downloaded.
 */
export function agreementDocName(raw: string, type: AgreementDocType): string | null {
  const name = cleanName(raw);
  if (!name) return null;
  return extensionOf(name) ? name : name + AGREEMENT_DOC_TYPES[type];
}

/**
 * The Blob pathname a file is uploaded to. Always passes
 * isAgreementUploadPath: a refused path surfaces only as the SDK's opaque
 * "Failed to retrieve the client token", so this finishes the clean-up that
 * safeBlobFileName leaves (a leading "_", runs of dots).
 */
export function agreementUploadPath(fileName: string, type: AgreementDocType): string {
  const ext = extensionOf(fileName);
  const stem = safeBlobFileName(ext ? fileName.slice(0, -ext.length) : fileName)
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[.]+$/, "");
  return `${AGREEMENT_DOCS_BLOB_PREFIX}${stem || "agreement"}${AGREEMENT_DOC_TYPES[type]}`;
}

/**
 * Whether a pathname is one we will issue an upload token for, or register as
 * a filed document: under our prefix, one level deep, no dot segments. Mixed
 * case is allowed because the store's random suffix ("-Ab3x….pdf") is.
 */
export function isAgreementUploadPath(pathname: string): boolean {
  if (!pathname.startsWith(AGREEMENT_DOCS_BLOB_PREFIX)) return false;
  const rest = pathname.slice(AGREEMENT_DOCS_BLOB_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|jpg|png)$/.test(rest) && !rest.includes("..");
}

/**
 * Two files are taken to be the same document when name and size both match.
 * Uploading a batch again after a dropped connection then fills in only what
 * is missing, while two different agreements that happen to share a filename
 * (Odoo exports have several) are both kept.
 */
export function sameDocumentKey(name: string, size: number): string {
  return `${name.trim().toLowerCase()}|${size}`;
}
