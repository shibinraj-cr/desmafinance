/**
 * Seed the OCEAN (Big-Five) psychometric test using the public-domain
 * IPIP-50 item pool (https://ipip.ori.org/newBigFive5broadKey.htm).
 *
 * 10 items per dimension × 5 dimensions = 50 items, mixed positive (+)
 * and negative (–) keying. Plus 3 paired validity questions: each
 * validity item is a rewording of an existing item, linked by
 * `validityPairId`. Average abs diff across pairs ≤ 1 on the 5-point
 * scale = consistency pass.
 *
 * Idempotent — re-running skips if the test already has questions.
 *
 * Run with:  npx tsx prisma/seed-psych.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Item = { text: string; reverse: boolean };

const O: Item[] = [
  { text: "I have a vivid imagination.", reverse: false },
  { text: "I have a rich vocabulary.", reverse: false },
  { text: "I have excellent ideas.", reverse: false },
  { text: "I am quick to understand things.", reverse: false },
  { text: "I use difficult words.", reverse: false },
  { text: "I spend time reflecting on things.", reverse: false },
  { text: "I am full of ideas.", reverse: false },
  { text: "I have difficulty understanding abstract ideas.", reverse: true },
  { text: "I am not interested in abstract ideas.", reverse: true },
  { text: "I do not have a good imagination.", reverse: true },
];

const C: Item[] = [
  { text: "I am always prepared.", reverse: false },
  { text: "I pay attention to details.", reverse: false },
  { text: "I get chores done right away.", reverse: false },
  { text: "I like order.", reverse: false },
  { text: "I follow a schedule.", reverse: false },
  { text: "I am exacting in my work.", reverse: false },
  { text: "I leave my belongings around.", reverse: true },
  { text: "I make a mess of things.", reverse: true },
  { text: "I often forget to put things back in their proper place.", reverse: true },
  { text: "I shirk my duties.", reverse: true },
];

const E: Item[] = [
  { text: "I am the life of the party.", reverse: false },
  { text: "I feel comfortable around people.", reverse: false },
  { text: "I start conversations.", reverse: false },
  { text: "I talk to a lot of different people at parties.", reverse: false },
  { text: "I don't mind being the centre of attention.", reverse: false },
  { text: "I don't talk a lot.", reverse: true },
  { text: "I keep in the background.", reverse: true },
  { text: "I have little to say.", reverse: true },
  { text: "I don't like to draw attention to myself.", reverse: true },
  { text: "I am quiet around strangers.", reverse: true },
];

const A: Item[] = [
  { text: "I am interested in people.", reverse: false },
  { text: "I sympathise with others' feelings.", reverse: false },
  { text: "I have a soft heart.", reverse: false },
  { text: "I take time out for others.", reverse: false },
  { text: "I feel others' emotions.", reverse: false },
  { text: "I make people feel at ease.", reverse: false },
  { text: "I am not really interested in others.", reverse: true },
  { text: "I insult people.", reverse: true },
  { text: "I am not interested in other people's problems.", reverse: true },
  { text: "I feel little concern for others.", reverse: true },
];

const N: Item[] = [
  { text: "I get stressed out easily.", reverse: false },
  { text: "I worry about things.", reverse: false },
  { text: "I am easily disturbed.", reverse: false },
  { text: "I get upset easily.", reverse: false },
  { text: "I change my mood a lot.", reverse: false },
  { text: "I have frequent mood swings.", reverse: false },
  { text: "I get irritated easily.", reverse: false },
  { text: "I often feel blue.", reverse: false },
  { text: "I am relaxed most of the time.", reverse: true },
  { text: "I seldom feel blue.", reverse: true },
];

// Three paired validity items. Each rewords an existing item; the
// validityPairId on both this seed row and the matching original is
// the same string, so the scoring engine can pair them up.
type Validity = { text: string; pairId: string };
const validityItems: Validity[] = [
  { text: "I tend to be prepared ahead of time.", pairId: "PAIR_C_PREPARED" },
  { text: "I am at ease when meeting new people.", pairId: "PAIR_E_COMFORTABLE" },
  { text: "I take notice when others are upset.", pairId: "PAIR_A_FEELINGS" },
];

// The originals that the validity items rephrase. Their primary
// PsychDimension stays unchanged (C/E/A) — we only stamp the same
// validityPairId on them so the consistency check pairs them up.
const validityPairsOnOriginals: Record<string, { dim: "C" | "E" | "A"; text: string }> = {
  PAIR_C_PREPARED: { dim: "C", text: "I am always prepared." },
  PAIR_E_COMFORTABLE: { dim: "E", text: "I feel comfortable around people." },
  PAIR_A_FEELINGS: { dim: "A", text: "I sympathise with others' feelings." },
};

const TEST_NAME = "OCEAN Big-Five v1";

async function main() {
  const existing = await prisma.psychTest.findUnique({ where: { name: TEST_NAME } });
  if (existing) {
    const count = await prisma.psychQuestion.count({ where: { testId: existing.id } });
    if (count > 0) {
      console.log(`Test "${TEST_NAME}" already has ${count} questions — skipping.`);
      return;
    }
  }

  const test =
    existing ??
    (await prisma.psychTest.create({
      data: {
        name: TEST_NAME,
        description: "International Personality Item Pool 50-item Big-Five inventory (public domain).",
        active: true,
      },
    }));

  // Interleave the 50 items so the employee doesn't see all of one
  // dimension in a row.
  const buckets: Array<{ dim: "O" | "C" | "E" | "A" | "N"; items: Item[] }> = [
    { dim: "O", items: O },
    { dim: "C", items: C },
    { dim: "E", items: E },
    { dim: "A", items: A },
    { dim: "N", items: N },
  ];
  const interleaved: Array<{ dim: "O" | "C" | "E" | "A" | "N"; item: Item }> = [];
  for (let i = 0; i < 10; i++) {
    for (const b of buckets) interleaved.push({ dim: b.dim, item: b.items[i] });
  }

  let order = 1;
  const rows: Array<{
    testId: string;
    order: number;
    dimension: "O" | "C" | "E" | "A" | "N" | "VALIDITY";
    textEn: string;
    textMl: string | null;
    reverseScored: boolean;
    validityPairId: string | null;
    active: boolean;
  }> = [];

  for (const row of interleaved) {
    const pairKey = Object.entries(validityPairsOnOriginals).find(
      ([, v]) => v.dim === row.dim && v.text === row.item.text,
    )?.[0];
    rows.push({
      testId: test.id,
      order: order++,
      dimension: row.dim,
      textEn: row.item.text,
      textMl: null,
      reverseScored: row.item.reverse,
      validityPairId: pairKey ?? null,
      active: true,
    });
  }

  for (const v of validityItems) {
    rows.push({
      testId: test.id,
      order: order++,
      dimension: "VALIDITY",
      textEn: v.text,
      textMl: null,
      reverseScored: false,
      validityPairId: v.pairId,
      active: true,
    });
  }

  // Single batched insert — much faster + avoids any per-insert latency
  // pile-up against pooled Postgres.
  await prisma.psychQuestion.createMany({ data: rows });

  const total = await prisma.psychQuestion.count({ where: { testId: test.id } });
  console.log(`Seeded "${TEST_NAME}" with ${total} questions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
