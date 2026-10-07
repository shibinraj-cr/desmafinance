export type DownloadContext = {
  /** Timeline entry — the message must never contain the password or the link. */
  log: (step: string, message: string) => void;
  /** Present only when the integration opted into failure screenshots. */
  screenshot?: (png: Uint8Array) => Promise<void>;
};

export type DownloadResult = {
  pdf: Uint8Array;
  via: "download" | "response" | "embed" | "print";
};

/** Fetches one statement PDF from a bank's e-mailed statement link. */
export interface StatementDownloader {
  download(url: string, password: string, ctx: DownloadContext): Promise<DownloadResult>;
}
