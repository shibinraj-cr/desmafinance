/**
 * Finance-module mirror of /master-data/parties/[id]. Same UI, same
 * API — accessible to any authenticated user. Re-uses the master-data
 * page implementation by importing it directly.
 */
export { default } from "@/app/(app)/master-data/parties/[id]/page";
export const dynamic = "force-dynamic";
