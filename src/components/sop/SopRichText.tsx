import { parseSopRichText, type SopInline } from "@/lib/sop/richtext";

/**
 * Renders SOP rich text as React elements.
 *
 * No `dangerouslySetInnerHTML`: the parser produces a typed structure and this
 * walks it, so authored copy can never introduce markup. External links get
 * `rel="noopener noreferrer"` and open in a new tab; in-app links (which start
 * with "/") stay in the tab, since those are navigation inside DESGRO.
 */
export function SopRichText({
  source,
  className = "",
  empty = null,
}: {
  source: string | null | undefined;
  className?: string;
  empty?: React.ReactNode;
}) {
  const blocks = parseSopRichText(source);
  if (blocks.length === 0) return <>{empty}</>;

  return (
    <div className={"space-y-sm " + className}>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h4" : "h5";
          return (
            <Tag
              key={i}
              className={
                block.level === 2
                  ? "text-body-lg font-semibold text-on-surface mt-md first:mt-0"
                  : "text-body-md font-semibold text-on-surface mt-sm"
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

function Inlines({ content }: { content: SopInline[] }) {
  return (
    <>
      {content.map((token, i) => {
        if (token.type === "bold")
          return (
            <strong key={i} className="text-on-surface font-semibold">
              {token.value}
            </strong>
          );
        if (token.type === "italic") return <em key={i}>{token.value}</em>;
        if (token.type === "code")
          return (
            <code key={i} className="px-xs rounded bg-surface-container text-label-sm font-mono">
              {token.value}
            </code>
          );
        if (token.type === "link") {
          const external = !token.href.startsWith("/");
          return (
            <a
              key={i}
              href={token.href}
              className="text-accent underline underline-offset-2 hover:text-primary-container"
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {token.value}
            </a>
          );
        }
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}
