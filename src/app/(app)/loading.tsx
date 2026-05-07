export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen">
      <div className="flex items-center gap-sm text-on-surface-variant">
        <span
          className="material-symbols-outlined animate-spin"
          style={{ fontSize: 28 }}
          aria-hidden
        >
          progress_activity
        </span>
        <span className="text-body-md">Loading…</span>
      </div>
    </div>
  );
}
