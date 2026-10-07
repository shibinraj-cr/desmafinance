import { existsSync } from "node:fs";
import type { Browser } from "playwright-core";
import { BankAutomationError } from "./errors";

/**
 * Headless Chromium for the statement downloader.
 *
 * On Vercel (Amazon Linux) the binary comes from @sparticuz/chromium, which
 * ships a brotli-packed Chromium sized for serverless functions; it is listed
 * in next.config.mjs as an external package and traced into the worker routes.
 * Locally, BANK_CHROMIUM_PATH or an installed Google Chrome is used.
 *
 * Every launch gets a fresh, throw-away context (see the downloader): no
 * profile directory, no persisted cookies or bank session.
 */

const LOCAL_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  if (isServerless()) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    sparticuz.setGraphicsMode = false;
    return chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
      headless: true,
    });
  }
  const exe = process.env.BANK_CHROMIUM_PATH?.trim() || LOCAL_CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    throw new BankAutomationError("CONFIG", "No Chromium found — set BANK_CHROMIUM_PATH to a Chrome/Chromium binary");
  }
  return chromium.launch({ executablePath: exe, headless: true });
}
