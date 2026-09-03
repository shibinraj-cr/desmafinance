import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consumeMagicLink, PARTNER_COOKIE } from "@/lib/hiring/partner-scope";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * The magic link lands here, is exchanged for a portal session cookie, and the
 * URL is left behind by the redirect — so the one-time token does not sit in
 * the address bar to be shoulder-read or pasted into a chat.
 */
export default async function PartnerLoginPage({ params }: { params: { token: string } }) {
  const result = await consumeMagicLink(params.token);

  if (result) {
    cookies().set(PARTNER_COOKIE, params.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    redirect("/partners");
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-lg px-md py-xl">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <h1 className="text-h2 text-on-surface">This link has already been used</h1>
          <p className="text-body-md text-on-surface-variant">
            Portal links work once and expire after 30 minutes. Reply to the email we sent you and we
            will send a fresh one.
          </p>
        </div>
      </div>
    </div>
  );
}
