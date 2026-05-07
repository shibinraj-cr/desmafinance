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
    <header className="sticky top-14 md:top-0 z-30 flex flex-wrap justify-between items-center w-full gap-base px-md md:px-margin py-sm md:py-0 md:h-16 bg-surface/90 backdrop-blur border-b border-outline-variant">
      <div className="flex items-baseline gap-sm md:gap-md min-w-0">
        <h2 className="text-h3 md:text-h2 text-on-surface font-extrabold truncate">{title}</h2>
        {subtitle && (
          <span className="text-caption md:text-body-md text-on-surface-variant truncate">
            {subtitle}
          </span>
        )}
      </div>
      {action ? <div className="flex items-center gap-base flex-shrink-0">{action}</div> : null}
    </header>
  );
}
