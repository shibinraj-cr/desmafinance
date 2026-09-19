import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { SignClient } from "./sign-client";
import { Markdown } from "@/components/hiring/Markdown";

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
              Your login isn&apos;t linked to an employee record yet.
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
              {/* Policies are reference material — headings, lists and tables
                  carry most of the meaning. Rendered through the in-house
                  markdown subset (React elements, never an HTML string), so
                  HR-authored copy cannot inject markup. */}
              <Markdown source={p.body} className="mb-md" />
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
