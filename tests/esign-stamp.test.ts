import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { displayToPdf, layoutText, stampPdf, wrapLines, MIN_FONT_SIZE } from "@/lib/esign/stamp";

const FONT = new Uint8Array(readFileSync("public/fonts/esign/NotoSans-Regular.ttf"));

async function pageWith(rotate: number, crop?: [number, number, number, number]) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([600, 800]);
  if (crop) p.setCropBox(...crop);
  if (rotate) p.setRotation(degrees(rotate));
  return doc.save();
}

/** Where pdf.js (an independent renderer) puts each text run, in displayed-page points. */
async function textOnScreen(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return {
    W: vp.width,
    H: vp.height,
    runs: content.items
      .filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i && !!i.str)
      .map((i) => {
        const [a, b, , , e, f] = i.transform;
        const [u, v] = vp.convertToViewportPoint(e, f);
        const [u2, v2] = vp.convertToViewportPoint(e + a, f + b);
        return { str: i.str, u, v, dir: [u2 - u, v2 - v] };
      }),
  };
}

describe("displayToPdf", () => {
  const f = { bx: 50, by: 100, bw: 500, bh: 600 };
  it("maps the top-left corner of the displayed page for every rotation", () => {
    expect(displayToPdf({ ...f, rotate: 0 }, 0, 0)).toEqual({ x: 50, y: 700 });
    expect(displayToPdf({ ...f, rotate: 90 }, 0, 0)).toEqual({ x: 50, y: 100 });
    expect(displayToPdf({ ...f, rotate: 180 }, 0, 0)).toEqual({ x: 550, y: 100 });
    expect(displayToPdf({ ...f, rotate: 270 }, 0, 0)).toEqual({ x: 550, y: 700 });
  });
});

describe("stampPdf places text where the box was drawn", () => {
  const box = { page: 1, x: 0.2, y: 0.3, w: 0.5, h: 0.05 };
  for (const rotate of [0, 90, 180, 270]) {
    for (const crop of [undefined, [50, 100, 500, 600] as [number, number, number, number]]) {
      it(`rotation ${rotate}°${crop ? ", cropped" : ""}`, async () => {
        const bytes = await stampPdf(await pageWith(rotate, crop), FONT, [
          { kind: "text", ...box, text: "Fee ₹1,50,000", fontSize: 11, alignment: "left", multiline: false },
        ]);
        const { W, H, runs } = await textOnScreen(bytes);
        expect(runs.map((r) => r.str).join("")).toBe("Fee ₹1,50,000");
        const r = runs[0];
        // Starts at the box's left edge (plus padding)…
        expect(r.u).toBeCloseTo(box.x * W + 2, 0);
        // …with the baseline inside the box, below its vertical middle (text is centred on it)…
        expect(r.v).toBeGreaterThan(box.y * H + (box.h * H) / 2);
        expect(r.v).toBeLessThan((box.y + box.h) * H);
        // …and reads left to right on screen.
        expect(r.dir[0]).toBeGreaterThan(0);
        expect(Math.abs(r.dir[1])).toBeLessThan(1e-6);
      });
    }
  }

  it("right-aligns and centres", async () => {
    const base = { kind: "text" as const, page: 1, x: 0.1, w: 0.8, h: 0.04, fontSize: 12, multiline: false, text: "X" };
    const bytes = await stampPdf(await pageWith(0), FONT, [
      { ...base, y: 0.1, alignment: "right" },
      { ...base, y: 0.2, alignment: "center" },
    ]);
    const { W, runs } = await textOnScreen(bytes);
    const [right, centre] = [...runs].sort((a, b) => a.v - b.v);
    expect(right.u).toBeGreaterThan(0.85 * W);
    expect(centre.u).toBeGreaterThan(0.45 * W);
    expect(centre.u).toBeLessThan(0.5 * W);
  });

  it("wraps multi-line text inside the box", async () => {
    const bytes = await stampPdf(await pageWith(0), FONT, [
      {
        kind: "text",
        page: 1,
        x: 0.1,
        y: 0.5,
        w: 0.3,
        h: 0.1,
        fontSize: 11,
        alignment: "left",
        multiline: true,
        text: "Flat 4B, Sea View Apartments, Marine Drive, Kochi, Kerala 682031",
      },
    ]);
    const { H, runs } = await textOnScreen(bytes);
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) {
      expect(r.v).toBeGreaterThan(0.5 * H);
      expect(r.v).toBeLessThan(0.6 * H);
    }
  });

  it("keeps the template's existing content", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Helvetica");
    doc.addPage([600, 800]).drawText("Original clause", { x: 50, y: 700, size: 12, font });
    const bytes = await stampPdf(await doc.save(), FONT, [
      { kind: "text", page: 1, x: 0.5, y: 0.5, w: 0.3, h: 0.03, fontSize: 11, alignment: "left", multiline: false, text: "Stamped" },
    ]);
    const { runs } = await textOnScreen(bytes);
    expect(runs.map((r) => r.str)).toEqual(expect.arrayContaining(["Original clause", "Stamped"]));
  });
});

describe("layoutText", () => {
  const measure = { widthOf: (s: string, size: number) => s.length * size * 0.5, capHeight: 0.7 };
  const frame = { W: 600, H: 800 };

  it("shrinks a long single line to fit, but not below the minimum", () => {
    const fit = layoutText({ x: 0, y: 0, w: 0.2, h: 0.03, text: "x".repeat(30), fontSize: 11, alignment: "left", multiline: false }, frame, measure);
    expect(fit.size).toBeLessThan(11);
    expect(30 * fit.size * 0.5).toBeLessThanOrEqual(120 - 4);
    const floor = layoutText({ x: 0, y: 0, w: 0.05, h: 0.03, text: "x".repeat(200), fontSize: 11, alignment: "left", multiline: false }, frame, measure);
    expect(floor.size).toBe(MIN_FONT_SIZE);
  });

  it("flattens newlines in a single-line field", () => {
    const l = layoutText({ x: 0, y: 0, w: 1, h: 0.05, text: "a\nb", fontSize: 10, alignment: "left", multiline: false }, frame, measure);
    expect(l.lines.map((x) => x.text)).toEqual(["a b"]);
  });

  it("wraps words greedily and keeps paragraph breaks", () => {
    expect(wrapLines("aa bb cc\ndd", 5, (s) => s.length)).toEqual(["aa bb", "cc", "dd"]);
    expect(wrapLines("averyverylongword", 3, (s) => s.length)).toEqual(["averyverylongword"]);
  });
});

