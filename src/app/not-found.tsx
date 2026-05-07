import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-md bg-surface">
      <div className="max-w-md w-full text-center bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-xl">
        <h1 className="text-h1 text-accent">404</h1>
        <p className="text-body-lg text-on-surface mt-sm">Page not found.</p>
        <p className="text-body-md text-on-surface-variant mt-xs">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Link
          href="/overview"
          className="mt-lg inline-block h-10 px-lg leading-10 rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
