import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const QuizQuestion = z.object({
  id: z.string(),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(8),
  correctIndex: z.number().int().min(0).max(7),
  explanation: z.string().optional(),
});

const Schema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  videoUrl: z.string().url().nullable().optional().or(z.literal("")),
  quiz: z.array(QuizQuestion).default([]),
  passingScore: z.number().int().min(0).max(100).default(70),
  publish: z.boolean().default(false),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const trainings = await prisma.hrTraining.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { progress: true } } },
  });
  return NextResponse.json({ trainings });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const training = await prisma.hrTraining.create({
    data: {
      title: d.title,
      description: d.description ?? null,
      videoUrl: d.videoUrl || null,
      quiz: d.quiz,
      passingScore: d.passingScore,
      status: d.publish ? "published" : "draft",
      createdById: userId,
    },
  });
  if (d.publish) {
    const employees = await prisma.employee.findMany({ where: { active: true, userId: { not: null } } });
    const notif = await prisma.hrNotification.create({
      data: {
        title: `New training: ${training.title}`,
        body: training.description ?? "A new training has been assigned to you.",
        linkUrl: `/me/trainings/${training.id}`,
        kind: "training",
        requiresAck: false,
      },
    });
    for (const e of employees) {
      await prisma.hrNotificationReceipt.upsert({
        where: { notificationId_employeeId: { notificationId: notif.id, employeeId: e.id } },
        update: {},
        create: { notificationId: notif.id, employeeId: e.id },
      });
    }
  }
  return NextResponse.json({ training });
}
