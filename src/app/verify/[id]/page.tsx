import type { Metadata } from "next";
import { VerifyClient } from "./client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify a signed agreement — DESMA International",
  robots: { index: false, follow: false },
};

export default function VerifyPage({ params }: { params: { id: string } }) {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/desma-logo.png" alt="DESMA International" className="h-9 w-auto" />
          <span className="text-sm text-gray-500">Document check</span>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <h1 className="text-2xl font-bold">Check a signed agreement</h1>
        <p className="text-gray-700">
          Choose the signed PDF. Your device works out its fingerprint (SHA-256) and we compare it with the one DESMA recorded
          when signing finished. The file itself is not uploaded.
        </p>
        <VerifyClient id={params.id} />
      </div>
    </main>
  );
}
