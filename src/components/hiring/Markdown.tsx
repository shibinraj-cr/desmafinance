import { parseMarkdown, type Inline } from "@/lib/hiring/markdown";

/**
 * Renders the job-description markdown subset as React elements. No HTML
 * string is ever constructed, so recruiter-authored copy cannot inject markup
 * into the public careers page.
 */
export function Markdown({ source, className = "" }: { source: string | null; className?: string }) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return null;

  return (
    <div className={"space-y-md " + className}>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return (
            <Tag
              key={i}
              className={
                block.level === 2
                  ? "text-h3 text-on-surface mt-lg first:mt-0"
                  : "text-body-lg font-semibold text-on-surface mt-md"
              }
            >
              <Inlines content={block.content} />
            </Tag>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={
                (block.ordered ? "list-decimal" : "list-disc") +
                " pl-lg space-y-xs text-body-md text-on-surface-variant"
              }
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines content={item} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="text-body-md text-on-surface-variant leading-relaxed">
            <Inlines content={block.content} />
          </p>
        );
      })}
    </div>
  );
}

function Inlines({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((token, i) => {
        if (token.type === "bold") return <strong key={i} className="text-on-surface font-semibold">{token.value}</strong>;
        if (token.type === "italic") return <em key={i}>{token.value}</em>;
        if (token.type === "code")
          return (
            <code key={i} className="px-xs rounded bg-surface-container text-label-sm font-mono">
              {token.value}
            </code>
          );
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}
