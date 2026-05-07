"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-md bg-surface">
      <div className="max-w-md w-full text-center bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-xl">
        <span className="material-symbols-outlined text-error" style={{ fontSize: 48 }}>
          error
        </span>
        <h1 className="text-h2 mt-md text-on-surface">Something went wrong</h1>
        <p className="text-body-md text-on-surface-variant mt-sm">
          The dashboard could not load. This is usually a temporary issue with the database
          connection — please try again in a moment.
        </p>
        {error.digest && (
          <p className="text-caption text-on-surface-variant mt-md font-mono">ref: {error.digest}</p>
        )}
        <div className="flex gap-base justify-center mt-lg">
          <button
            onClick={reset}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition"
          >
            Try again
          </button>
          <a
            href="/login"
            className="h-10 px-lg leading-10 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
          >
            Go to login
          </a>
        </div>
      </div>
    </main>
  );
}
