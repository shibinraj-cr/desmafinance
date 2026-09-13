"use client";

import { useRef, useState } from "react";
import { Icon, taCls } from "./ui";
import { SopRichText } from "./SopRichText";

/**
 * The module's rich-text editor: a textarea over the markdown subset, with a
 * formatting toolbar and a live preview toggle.
 *
 * Deliberately not a WYSIWYG/contentEditable surface. A contentEditable field
 * produces HTML, which then has to be sanitised on the way in AND on the way
 * out, and one missed path is a stored-XSS hole. Markdown text is inert by
 * construction: the worst a paste can do is look odd. The toolbar means an
 * author never has to know that is what they are typing.
 */
export function RichTextInput({
  value,
  onChange,
  placeholder,
  rows = 6,
  disabled,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  /**
   * Wrap the selection (or insert a template at the caret) and restore the
   * selection afterwards, so clicking **B** twice in a row does the obvious
   * thing rather than dumping the caret at the end of the field.
   */
  function surround(before: string, after: string, placeholderText: string) {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  /** Prefix every selected line — how bullets and numbers actually work. */
  function prefixLines(make: (index: number) => string) {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
    const block = value.slice(lineStart, lineEnd) || "";
    const prefixed = block
      .split("\n")
      .map((line, i) => (line.trim() ? make(i) + line.replace(/^([-*]|\d+[.)])\s+/, "") : make(i)))
      .join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }

  const toolBtn =
    "h-8 min-w-8 px-xs grid place-items-center rounded border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40";

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
      <div className="flex flex-wrap items-center gap-xs px-sm py-xs border-b border-outline-variant bg-surface-container-low">
        <button type="button" className={toolBtn} disabled={disabled} title="Bold" onClick={() => surround("**", "**", "bold text")}>
          <Icon name="format_bold" size={16} />
        </button>
        <button type="button" className={toolBtn} disabled={disabled} title="Italic" onClick={() => surround("*", "*", "italic text")}>
          <Icon name="format_italic" size={16} />
        </button>
        <button type="button" className={toolBtn} disabled={disabled} title="Bullet list" onClick={() => prefixLines(() => "- ")}>
          <Icon name="format_list_bulleted" size={16} />
        </button>
        <button
          type="button"
          className={toolBtn}
          disabled={disabled}
          title="Numbered list"
          onClick={() => prefixLines((i) => `${i + 1}. `)}
        >
          <Icon name="format_list_numbered" size={16} />
        </button>
        <button type="button" className={toolBtn} disabled={disabled} title="Heading" onClick={() => prefixLines(() => "## ")}>
          <Icon name="title" size={16} />
        </button>
        <button
          type="button"
          className={toolBtn}
          disabled={disabled}
          title="Link"
          onClick={() => surround("[", "](https://)", "link text")}
        >
          <Icon name="link" size={16} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className={toolBtn + (preview ? " bg-surface-container-high text-on-surface" : "")}
          onClick={() => setPreview((p) => !p)}
          title={preview ? "Back to editing" : "Preview"}
        >
          <Icon name={preview ? "edit" : "visibility"} size={16} />
        </button>
      </div>

      {preview ? (
        <div className="p-md min-h-[8rem]">
          <SopRichText
            source={value}
            empty={<span className="text-body-sm text-on-surface-variant">Nothing to preview yet.</span>}
          />
        </div>
      ) : (
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={taCls + " border-0 rounded-none focus:ring-0"}
        />
      )}
    </div>
  );
}
