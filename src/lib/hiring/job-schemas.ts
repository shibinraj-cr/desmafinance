import { z } from "zod";
import {
  WORK_TYPES,
  EMPLOYMENT_TYPES,
  SENIORITIES,
  RESUME_MODES,
  ANSWER_TYPES,
  STAGE_KINDS,
} from "./constants";

/** Shared request shapes for the requisition endpoints and the wizard. */

export const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  helperText: z.string().trim().max(300).nullable().optional(),
  answerType: z.enum(ANSWER_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
});

export const rubricSchema = z.object({
  criterion: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  weight: z.number().int().min(0).max(100),
});

export const stageSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(STAGE_KINDS),
  slaDays: z.number().int().min(0).max(365).nullable().optional(),
});

const compLakh = z.number().min(0).max(9999).nullable().optional();

export const jobCoreSchema = z.object({
  title: z.string().trim().min(2).max(140),
  department: z.string().trim().min(1).max(80),
  jobRoleId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  workType: z.enum(WORK_TYPES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  seniority: z.enum(SENIORITIES).optional(),
  compMinLakh: compLakh,
  compMaxLakh: compLakh,
  compVisible: z.boolean().optional(),
  descriptionMd: z.string().max(20_000).nullable().optional(),
  mustHaves: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  niceToHaves: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  openings: z.number().int().min(1).max(500).optional(),
  ownerId: z.string().nullable().optional(),
  hiringManagerId: z.string().nullable().optional(),
  approvalRequired: z.boolean().optional(),
  resumeMode: z.enum(RESUME_MODES).optional(),
  askScreeningQs: z.boolean().optional(),
});

export const createJobSchema = jobCoreSchema.extend({
  questions: z.array(questionSchema).max(20).optional(),
  rubrics: z.array(rubricSchema).max(10).optional(),
  /** Wizard step 5 asks to publish straight away. */
  publish: z.boolean().optional(),
});

export const patchJobSchema = jobCoreSchema.partial().extend({
  questions: z.array(questionSchema).max(20).optional(),
  rubrics: z.array(rubricSchema).max(10).optional(),
  stages: z.array(stageSchema).min(1).max(20).optional(),
  status: z.enum(["draft", "live", "paused"]).optional(),
});
