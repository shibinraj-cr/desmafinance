-- AlterTable
ALTER TABLE "HiringTalentPool" ALTER COLUMN "state" SET DEFAULT 'shortlisted';

-- CreateTable
CREATE TABLE "HiringTalentPoolEvent" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringTalentPoolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringTalentPoolEvent_candidateId_occurredAt_idx" ON "HiringTalentPoolEvent"("candidateId", "occurredAt");

-- CreateIndex
CREATE INDEX "HiringTalentPoolEvent_type_occurredAt_idx" ON "HiringTalentPoolEvent"("type", "occurredAt");

-- AddForeignKey
ALTER TABLE "HiringTalentPoolEvent" ADD CONSTRAINT "HiringTalentPoolEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringTalentPoolEvent" ADD CONSTRAINT "HiringTalentPoolEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The pool stopped being a nurture list and became the working stages for
-- candidates who have no application. Remap what is already there rather than
-- stranding rows on values the UI can no longer display.
--
--   new        -> shortlisted        (they were picked out, nothing more)
--   nurturing  -> contacted          (somebody had reached out)
--   re_engage  -> contacted          (same, restarted)
--   cold       -> not_interested     (the honest reading of a cold prospect)
--   placed     -> placed             (unchanged)
UPDATE "HiringTalentPool" SET "state" = 'shortlisted'    WHERE "state" = 'new';
UPDATE "HiringTalentPool" SET "state" = 'contacted'      WHERE "state" IN ('nurturing', 're_engage');
UPDATE "HiringTalentPool" SET "state" = 'not_interested' WHERE "state" = 'cold';

-- Anything unrecognised lands on the first stage rather than on a value no
-- filter chip can select, which would make the row invisible.
UPDATE "HiringTalentPool" SET "state" = 'shortlisted'
 WHERE "state" NOT IN (
   'shortlisted','contacted','interview_scheduled','interview_attended',
   'rejected','placed','joined','not_interested'
 );

-- Give existing members a first history entry, so their timeline starts where
-- they actually entered the pool instead of appearing to begin today.
INSERT INTO "HiringTalentPoolEvent" ("id", "candidateId", "type", "toState", "note", "occurredAt")
SELECT gen_random_uuid()::text,
       tp."candidateId",
       'added',
       tp."state",
       'Added to the talent pool before activity history was recorded.',
       tp."createdAt"
  FROM "HiringTalentPool" tp;
