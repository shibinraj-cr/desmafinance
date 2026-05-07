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

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;
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

// Lazy proxy: validation runs the first time any field is read, not at import.
// This keeps `next build` from needing real env vars on Vercel — they only
// have to be set at runtime, when handlers actually run.
export const env = new Proxy({} as Env, {
  get(_target, key: string) {
    return load()[key as keyof Env];
  },
});
