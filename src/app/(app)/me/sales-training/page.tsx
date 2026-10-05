import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { Bar, ModuleStatusPill } from "@/components/sales-training/ui";
import { activeLearner, loadProgress, summarise, toVideos } from "@/lib/sales-training-db";

export const dynamic = "force-dynamic";

function Notice({ text }: { text: string }) {
  return (
    <>
      <TopBar title="Sales Training" />
      <div className="p-margin">
        <Section title="">
          <p className="py-lg text-center text-on-surface-variant">{text}</p>
        </Section>
      </div>
    </>
  );
}

export default async function MySalesTrainingPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) return <Notice text="Your login isn't linked to an employee record yet — ask HR to link it." />;
  const learner = await activeLearner(emp.id);
  if (!learner) return <Notice text="You're not enrolled in Sales Consultant Training. HR will enrol you when it's your turn." />;

  const modules = await prisma.salesTrainingModule.findMany({
    where: { status: "published" },
    orderBy: { sortOrder: "asc" },
    select: { id: true, title: true, description: true, videos: true, maxAttempts: true, passMark: true, _count: { select: { questions: true } } },
  });
  const progress = (await loadProgress(modules, [emp.id])).get(emp.id)!;
  const s = summarise(modules.map((m) => progress.get(m.id)!));
  const due = learner.dueDate ? learner.dueDate.toISOString().slice(0, 10) : null;
  const overdue = !!due && due < new Date().toISOString().slice(0, 10) && s.passed < s.total;
  const next = modules.find((m) => !progress.get(m.id)!.passed && progress.get(m.id)!.status !== "failed");

  return (
    <>
      <TopBar title="Sales Training" subtitle="Sales Consultant Training & Development" />
      <div className="p-margin space-y-lg">
        <Section title="">
          <div className="flex flex-col md:flex-row md:items-center gap-md">
            <div className="flex-1">
              <p className="text-h3 font-bold text-on-surface">
                {s.passed} of {s.total} modules passed
              </p>
              <p className="text-label-sm text-on-surface-variant mt-[2px]">
                {s.avgScore != null ? `Average best score ${s.avgScore}%` : "No quiz taken yet"}
                {due && (
                  <span className={overdue ? "text-red-700 font-bold" : ""}>
                    {" "}
                    · complete by {new Date(`${due}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
              </p>
              <div className="mt-sm max-w-md">
                <Bar pct={s.completionPct} tone={s.total > 0 && s.passed === s.total ? "green" : "primary"} />
              </div>
            </div>
            {next && (
              <Link
                href={`/me/sales-training/${next.id}`}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold text-label-sm inline-flex items-center gap-xs self-start"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                {progress.get(next.id)!.status === "not_started" ? "Start" : "Continue"}: {next.title}
              </Link>
            )}
          </div>
        </Section>

        {modules.length === 0 ? (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No modules are live yet — you&apos;ll be notified when the first one is.</p>
          </Section>
        ) : (
          <ol className="space-y-md">
            {modules.map((m, i) => {
              const p = progress.get(m.id)!;
              const videos = toVideos(m.videos);
              return (
                <li key={m.id}>
                  <Link
                    href={`/me/sales-training/${m.id}`}
                    className="flex gap-md items-center bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md hover:border-primary"
                  >
                    {videos[0] ? (
                      <img src={`https://i.ytimg.com/vi/${videos[0].youtubeId}/mqdefault.jpg`} alt="" className="w-32 md:w-40 aspect-video rounded object-cover bg-surface-container flex-none" />
                    ) : (
                      <div className="w-32 md:w-40 aspect-video rounded bg-surface-container flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-sm flex-wrap">
                        <span className="text-label-sm font-bold text-on-surface-variant">Module {i + 1}</span>
                        <ModuleStatusPill status={p.status} />
                      </div>
                      <p className="font-semibold text-on-surface mt-[2px]">{m.title}</p>
                      {m.description && <p className="text-label-sm text-on-surface-variant line-clamp-2">{m.description}</p>}
                      <p className="text-[11px] text-on-surface-variant mt-xs">
                        {p.videosDone}/{videos.length} videos watched · {m._count.questions} questions · pass {m.passMark}%
                        {p.bestPercent != null && ` · best ${p.bestPercent}%`}
                        {m.maxAttempts && ` · ${Math.max(0, m.maxAttempts - p.attempts)} attempt(s) left`}
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}
