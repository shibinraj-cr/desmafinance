export function TopBar({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 flex justify-between items-center w-full px-margin h-16 bg-surface/90 backdrop-blur border-b border-outline-variant">
      <div className="flex items-baseline gap-md">
        <h2 className="text-h2 text-on-surface font-extrabold">{title}</h2>
        {subtitle && <span className="text-body-md text-on-surface-variant">{subtitle}</span>}
      </div>
      {action ? <div className="flex items-center gap-md">{action}</div> : null}
    </header>
  );
}
