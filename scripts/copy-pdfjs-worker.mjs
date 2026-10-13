// Copy pdf.js's worker into public/ so the browser can load it from our origin.
//
// Letting webpack emit it instead (`new URL("pdfjs-dist/…worker.min.mjs",
// import.meta.url)`) breaks `next build`: the minifier re-processes the emitted
// .mjs and fails on its module syntax. A plain static file avoids the bundler.
//
// The pdfjs version is in the filename because the worker must match the API
// version exactly; a cached worker from an older release would refuse to talk
// to a newer page. src/components/esign/pdf-client.ts builds the same name.
//
// Run by scripts/build.mjs (Vercel) and `npm run dev` (predev). The output is
// gitignored.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("pdfjs-dist/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const src = join(dirname(pkgPath), "legacy/build/pdf.worker.min.mjs");
const outDir = new URL("../public/pdfjs/", import.meta.url).pathname;
const name = `pdf.worker-${version}.min.mjs`;

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f !== name) rmSync(join(outDir, f));
copyFileSync(src, join(outDir, name));
console.log(`[pdfjs] public/pdfjs/${name}`);
