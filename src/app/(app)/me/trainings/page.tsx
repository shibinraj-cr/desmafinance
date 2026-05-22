import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { TrainingPlayer } from "./player";

export const dynamic = "force-dynamic";

function youTubeEmbed(url: string | null): string | null {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([\w-]+)/) ||
    url.match(/[?&]v=([\w-]+)/) ||
    url.match(/youtube\.com\/embed\/([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export default async function MeTrainingsPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="Trainings" />
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
  const trainings = await prisma.hrTraining.findMany({
    where: { status: "published" },
    orderBy: { createdAt: "desc" },
  });
  const progressRows = await prisma.hrTrainingProgress.findMany({
    where: { employeeId: emp.id },
  });
  const progressByTraining = new Map(progressRows.map((p) => [p.trainingId, p]));

  return (
    <>
      <TopBar title="Trainings" />
      <div className="p-margin space-y-lg">
        {trainings.map((t) => {
          const p = progressByTraining.get(t.id);
          const embed = youTubeEmbed(t.videoUrl);
          const quiz = (t.quiz as unknown as { id: string; prompt: string; choices: string[]; correctIndex: number }[]) ?? [];
          return (
            <Section
              key={t.id}
              title={t.title}
              action={
                p?.passed ? (
                  <span className="text-green-700 text-label-sm">Passed ({p.score}%)</span>
                ) : p ? (
                  <span className="text-yellow-700 text-label-sm">
                    Last score {p.score ?? 0}% · pass at {t.passingScore}%
                  </span>
                ) : null
              }
            >
              {t.description && <p className="text-on-surface-variant mb-md">{t.description}</p>}
              {embed ? (
                <div className="aspect-video w-full max-w-2xl mb-md">
                  <iframe
                    src={embed}
                    className="w-full h-full rounded"
                    allow="encrypted-media; fullscreen"
                  />
                </div>
              ) : t.videoUrl ? (
                <a href={t.videoUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline mb-md inline-block">
                  Watch video ↗
                </a>
              ) : null}
              {quiz.length > 0 ? (
                <TrainingPlayer
                  trainingId={t.id}
                  quiz={quiz.map(({ correctIndex: _ci, ...rest }) => rest)}
                  alreadyPassed={!!p?.passed}
                />
              ) : (
                <p className="text-on-surface-variant text-label-sm">No quiz attached to this training.</p>
              )}
            </Section>
          );
        })}
        {trainings.length === 0 && (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No published trainings yet.</p>
          </Section>
        )}
      </div>
    </>
  );
}
