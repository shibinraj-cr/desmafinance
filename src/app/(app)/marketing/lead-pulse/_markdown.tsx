// Tiny markdown renderer shared across Lead Pulse AI surfaces (BDE insights,
// Growth Planner). Handles paragraphs, dash bullet lists, **bold** and *italic*
// — deliberately minimal so we don't pull in a markdown dependency.

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-[8px] text-[13px]" style={{ color: "var(--lp-on-surface)" }}>
      {blocks.map((b, i) => {
        const isList = b.split(/\n/).every((line) => /^\s*-\s/.test(line));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-[20px] space-y-[4px]">
              {b
                .split(/\n/)
                .map((line) => line.replace(/^\s*-\s/, ""))
                .map((line, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
                ))}
            </ul>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: renderInline(b) }} />;
      })}
    </div>
  );
}

export function renderInline(s: string): string {
  // bold first, then single-* italic (run second so it doesn't eat bold markers)
  let out = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}
