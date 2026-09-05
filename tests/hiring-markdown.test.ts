import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline, markdownToPlainText } from "@/lib/hiring/markdown";

describe("job-description markdown", () => {
  it("parses headings, paragraphs and bullets", () => {
    const blocks = parseMarkdown("## About\n\nYou will sell.\n\n- Call people\n- Write notes");
    expect(blocks).toEqual([
      { type: "heading", level: 2, content: [{ type: "text", value: "About" }] },
      { type: "paragraph", content: [{ type: "text", value: "You will sell." }] },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", value: "Call people" }], [{ type: "text", value: "Write notes" }]],
      },
    ]);
  });

  it("flattens h1 down to h2 so a job ad never emits a second page title", () => {
    const [block] = parseMarkdown("# Big");
    expect(block).toMatchObject({ type: "heading", level: 2 });
  });

  it("treats deeper headings as h3", () => {
    const [block] = parseMarkdown("#### Small");
    expect(block).toMatchObject({ type: "heading", level: 3 });
  });

  it("keeps a numbered list separate from a bulleted one", () => {
    const blocks = parseMarkdown("- a\n\n1. b");
    expect(blocks.map((b) => b.type === "list" && b.ordered)).toEqual([false, true]);
  });

  it("joins wrapped lines into one paragraph", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ content: [{ type: "text", value: "one two" }] });
  });

  it("parses bold, italic and code inline", () => {
    expect(parseInline("a **b** c *d* e `f`")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c " },
      { type: "italic", value: "d" },
      { type: "text", value: " e " },
      { type: "code", value: "f" },
    ]);
  });

  it("keeps HTML as literal text — the renderer emits elements, never markup", () => {
    // The parser must not treat this as anything special; the React renderer
    // then escapes it by construction, so a pasted description cannot inject.
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { type: "paragraph", content: [{ type: "text", value: "<script>alert(1)</script>" }] },
    ]);
  });

  it("is empty for empty input", () => {
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown("   ")).toEqual([]);
  });

  it("flattens to plain text for meta descriptions", () => {
    expect(markdownToPlainText("## Role\n\nSell **things**.\n\n- One\n- Two")).toBe(
      "Role Sell things. One. Two",
    );
  });

  it("truncates plain text with an ellipsis", () => {
    expect(markdownToPlainText("a".repeat(50), 10)).toBe("aaaaaaaaa…");
  });
});
