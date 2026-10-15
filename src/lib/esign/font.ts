import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The font merge values are drawn in (Noto Sans: Latin with accents, and ₹).
 * Lives in public/ so the browser preview fetches the same file; the server
 * reads it from disk, which next.config.mjs traces into the send route's
 * function bundle (public/ is not deployed with functions otherwise).
 */
export const STAMP_FONT_PUBLIC_PATH = "/fonts/esign/NotoSans-Regular.ttf";

let font: Promise<Uint8Array> | null = null;

export function loadStampFont(): Promise<Uint8Array> {
  font ??= readFile(path.join(process.cwd(), "public", STAMP_FONT_PUBLIC_PATH)).then((b) => new Uint8Array(b));
  return font;
}
