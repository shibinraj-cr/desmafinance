/** @type {import('next').NextConfig} */

const csp = [
  "default-src 'self'",
  // YouTube's IFrame Player API (Sales Training tracks how much of each video
  // actually played) loads its script from youtube.com, which pulls the
  // player code from s.ytimg.com.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://i.ytimg.com",
  // Training videos are unlisted YouTube embeds. Without this, frames fall
  // back to default-src 'self' and the player is blocked outright.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  // Finance Documents uploads go straight from the browser to Vercel Blob
  // (the only way past the 4.5 MB request cap), so the browser must be able to
  // reach the Blob API. Scoped to that path, not the whole of vercel.com; the
  // trailing slash makes it a prefix so multipart (`/mpu`) is covered too.
  "connect-src 'self' https://vercel.com/api/blob/",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `microphone=(self)`, not `()`. An empty allowlist disables the feature for
  // EVERY origin including our own, so `getUserMedia` was refused before the
  // browser's permission prompt was even reached — a consultant clicking Allow
  // could not have made it work, and the CRM reported it as their permission
  // problem. `(self)` grants only this origin; an embedded third party still
  // gets nothing, which is the part that was worth having.
  //
  // Camera, geolocation and payment stay fully closed: nothing here asks for
  // them, and a feature nobody uses should not be reachable.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: csp },
];

// Routes that may launch headless Chromium for Bank Statement Automation —
// each needs the packed browser binary traced into its function bundle, and
// all of playwright-core: it loads parts of itself by computed path at
// runtime, which the tracer cannot follow (only 7 of its files get traced
// otherwise, and the launch fails in production).
const CHROMIUM_BIN = ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"];
const BANK_BROWSER_ROUTES = [
  "/api/cron/bank-statements",
  "/api/finance/bank-automation/run",
  "/api/finance/bank-automation/backfill",
  "/api/finance/bank-automation/test-statement-access",
  "/api/finance/bank-statements/retry",
  "/api/finance/bank-statements/upload",
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Loaded at runtime from node_modules rather than bundled: the browser
    // binary is brotli-packed data webpack must not touch.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "playwright-core"],
    outputFileTracingIncludes: Object.fromEntries(BANK_BROWSER_ROUTES.map((r) => [r, CHROMIUM_BIN])),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};
export default nextConfig;
