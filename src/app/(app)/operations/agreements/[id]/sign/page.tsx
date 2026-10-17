import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { SigningView } from "@/components/esign/SigningView";
import { formatLongDate } from "@/lib/esign/merge-values";
import { recordOpened, resolveInternalSeat } from "@/lib/esign/signing";
import { signingViewData } from "@/lib/esign/signing-view-data";

export const dynamic = "force-dynamic";

/**
 * DESMA staff fill DESMA's part and sign inside DesGro. Being the signer on
 * the agreement (by login) is the whole permission; no code is needed.
 */
export default async function SignAsDesmaPage({ params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const state = await resolveInternalSeat(params.id, userId);
  if (state.kind === "invalid") notFound();
  const { request, signer } = state;
  const back = (
    <Link href={`/operations/agreements/${request.id}`} className="text-body-md text-on-surface-variant hover:underline">
      Back to the agreement
    </Link>
  );
  const message = (title: string, body: string) => (
    <>
      <TopBar title={title} subtitle={request.reference} action={back} />
      <div className="p-margin text-body-md max-w-2xl">{body}</div>
    </>
  );
  if (state.kind === "done") return message("Already signed", `You signed this${signer.signedAt ? ` on ${formatLongDate(signer.signedAt)}` : ""}.`);
  if (state.kind === "waiting_turn") return message("Not your turn yet", "Another signer has to sign first. You will get an email when it is your turn.");
  if (state.kind !== "open") return message("Not open for signing", `This agreement is ${request.status}.`);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
  const h = headers();
  await recordOpened(
    request,
    signer,
    { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") },
    user?.email ?? user?.username ?? signer.name,
  );
  const data = await signingViewData(request, signer);
  return (
    <>
      <TopBar title="Sign as DESMA" subtitle={request.reference} action={back} />
      <SigningView
        mode="internal"
        {...data}
        fileUrl={`/api/esign/requests/${request.id}/file?kind=current`}
        completeUrl={`/api/esign/requests/${request.id}/sign/complete`}
        declineUrl={`/api/esign/requests/${request.id}/sign/decline`}
      />
    </>
  );
}
