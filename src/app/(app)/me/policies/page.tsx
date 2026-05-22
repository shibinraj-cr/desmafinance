import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { SignClient } from "./sign-client";

export const dynamic = "force-dynamic";

export default async function MePoliciesPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="Policies" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn't linked to an employee record yet.
            </p>
          </Section>
        </div>
      </>
    );
  }
  const [policies, acks] = await Promise.all([
    prisma.hrPolicy.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
    }),
    prisma.hrPolicyAcknowledgement.findMany({
      where: { employeeId: emp.id },
      select: { policyId: true, signedAt: true },
    }),
  ]);
  const ackedAt = new Map(acks.map((a) => [a.policyId, a.signedAt]));
  return (
    <>
      <TopBar title="Policies" subtitle={`${acks.length} / ${policies.length} acknowledged`} />
      <div className="p-margin space-y-base">
        {policies.map((p) => {
          const sa = ackedAt.get(p.id);
          return (
            <Section
              key={p.id}
              title={`${p.title} · ${p.version}`}
              action={
                sa ? (
                  <span className="text-green-700 text-label-sm">
                    Signed {new Date(sa).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-yellow-700 text-label-sm font-bold">Pending e-sign</span>
                )
              }
            >
              <p className="text-on-surface-variant whitespace-pre-wrap mb-md">{p.body}</p>
              {p.externalUrl && (
                <a
                  href={p.externalUrl}
                  target="_blank"
                  className="text-blue-700 underline text-label-sm"
                  rel="noreferrer"
                >
                  Open attached document ↗
                </a>
              )}
              {!sa && p.requiresAck && <SignClient policyId={p.id} />}
            </Section>
          );
        })}
        {policies.length === 0 && (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No published policies yet.</p>
          </Section>
        )}
      </div>
    </>
  );
}
