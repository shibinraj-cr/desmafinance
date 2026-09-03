import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { draftJobDescription } from "@/lib/hiring/ai/job-description";
import { WORK_TYPES, EMPLOYMENT_TYPES, SENIORITIES } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";
// The model call can take a while; give it the platform's ceiling.
export const maxDuration = 60;

const schema = z.object({
  title: z.string().trim().min(2).max(140),
  department: z.string().trim().min(1).max(80),
  seniority: z.enum(SENIORITIES).default("mid"),
  workType: z.enum(WORK_TYPES).default("onsite"),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  locationName: z.string().trim().max(120).nullable().optional(),
  compMinLakh: z.number().min(0).max(9999).nullable().optional(),
  compMaxLakh: z.number().min(0).max(9999).nullable().optional(),
  outline: z.string().trim().max(4000).nullable().optional(),
});

/**
 * POST /api/hiring/jobs/ai-draft — wizard step 2, "Let AI write the first
 * draft". Standalone because the wizard drafts BEFORE the job row exists.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("job:write");
  const body = schema.parse(await req.json());
  const draft = await draftJobDescription({ ...body, userId: access.userId });
  return NextResponse.json({ draft });
});
