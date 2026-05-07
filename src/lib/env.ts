import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, "NEXTAUTH_SECRET must be at least 32 characters (run: openssl rand -base64 32)"),
  NEXTAUTH_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ALLOW_DESTRUCTIVE_SEED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Skip validation when Next.js is building (e.g. on Vercel before env vars
// are populated for the build environment). At runtime, NEXT_PHASE is unset
// and validation runs on the first env access.
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "1";

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;

  if (isBuildPhase) {
    cached = process.env as unknown as Env;
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("\n❌ Invalid environment variables:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("");
    throw new Error("Environment validation failed. Fix env vars and restart.");
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_t, key: string) {
    return load()[key as keyof Env];
  },
});
