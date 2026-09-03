export const metadata = {
  title: "Link expired — DESMA International",
  robots: { index: false, follow: false },
};

export default function PartnerLinkExpiredPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-lg px-md py-xl">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <h1 className="text-h2 text-on-surface">This link has already been used</h1>
          <p className="text-body-md text-on-surface-variant">
            Portal links work once and expire after 30 minutes. Reply to the email we sent you and we
            will send a fresh one.
          </p>
          <p className="text-body-sm text-on-surface-variant">
            <a className="underline" href="mailto:hello@desma.in">
              hello@desma.in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
