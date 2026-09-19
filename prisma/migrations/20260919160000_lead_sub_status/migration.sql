-- Lead STATUS: where the conversation stands, across every stage.
--
-- A lead's STAGE (Lead.statusId -> CrmLeadStatus) says where it sits in the
-- pipeline. It does not say what is happening to it: two leads both in
-- Follow-Up can be "Connected On Call" and "Details Sent and Not Responding",
-- and nothing told them apart. This is the second, orthogonal axis — one value
-- per lead, filterable across every stage. The stage side is untouched.
--
-- Named SubStatus in code only because CrmLeadStatus already spells "status"
-- and renaming that would touch 70 call sites and break saved ?status= links.
CREATE TABLE "CrmLeadSubStatus" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "group"        TEXT NOT NULL DEFAULT '',
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "color"        TEXT,
  "isDefault"    BOOLEAN NOT NULL DEFAULT false,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmLeadSubStatus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmLeadSubStatus_code_key" ON "CrmLeadSubStatus"("code");
CREATE INDEX "CrmLeadSubStatus_active_idx" ON "CrmLeadSubStatus"("active");
CREATE INDEX "CrmLeadSubStatus_displayOrder_idx" ON "CrmLeadSubStatus"("displayOrder");

ALTER TABLE "Lead" ADD COLUMN "subStatusId" TEXT;
-- Ageing only — see the schema comment. Whether the candidate is responding is
-- said by the status itself, never inferred from message traffic.
ALTER TABLE "Lead" ADD COLUMN "subStatusSince" TIMESTAMP(3);

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_subStatusId_fkey"
  FOREIGN KEY ("subStatusId") REFERENCES "CrmLeadSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Lead_subStatusId_idx" ON "Lead"("subStatusId");
CREATE INDEX "Lead_subStatusSince_idx" ON "Lead"("subStatusSince");

-- Seed the starting vocabulary. Admin-editable from CRM Settings afterwards, so
-- this is a first draft rather than a fixed list — but it has to exist before
-- the field is worth showing.
--
-- Every "we sent / we asked" action carries the Awaiting vs Not Responding
-- split, so a stalled chase is always sayable: "Details Sent and Awaiting
-- Confirmation" and "Details Sent and Not Responding" are the same action and
-- opposite situations, and separating them is the point of the field. The
-- Not Responding rows are red on purpose — they are the work queue.
--
-- Nothing here duplicates a STAGE: Not Interested, Not Eligible, Already
-- Processing Elsewhere, Enrolled and Duplicate stay stages.
INSERT INTO "CrmLeadSubStatus" ("id", "code", "label", "group", "displayOrder", "color", "isDefault", "active", "createdAt", "updatedAt")
VALUES
  ('lss_not_contacted',         'not_contacted',                      'Not Contacted',                          'Not reached', 10,  '#9aa0a6', true,  true, NOW(), NOW()),
  ('lss_not_answering',         'not_answering_call',                 'Not Answering Call',                     'Not reached', 20,  '#94a3b8', false, true, NOW(), NOW()),
  ('lss_wrong_number',          'wrong_invalid_number',               'Wrong / Invalid Number',                 'Not reached', 30,  '#64748b', false, true, NOW(), NOW()),
  ('lss_call_back_requested',   'call_back_requested',                'Call Back Requested',                    'Not reached', 40,  '#60a5fa', false, true, NOW(), NOW()),

  ('lss_connected_on_call',     'connected_on_call',                  'Connected On Call',                      'Reached',     50,  '#3b82f6', false, true, NOW(), NOW()),
  ('lss_clarification_pending', 'clarification_pending',              'Clarification Pending',                  'Reached',     60,  '#6366f1', false, true, NOW(), NOW()),
  ('lss_counselling_done',      'counselling_done',                   'Counselling Done',                       'Reached',     70,  '#818cf8', false, true, NOW(), NOW()),

  ('lss_details_awaiting',      'details_sent_awaiting_confirmation', 'Details Sent and Awaiting Confirmation', 'Details',     80,  '#f59e0b', false, true, NOW(), NOW()),
  ('lss_details_no_response',   'details_sent_not_responding',        'Details Sent and Not Responding',        'Details',     90,  '#ef4444', false, true, NOW(), NOW()),

  ('lss_docs_awaiting',         'documents_requested_awaiting',       'Documents Requested and Awaiting',       'Documents',   100, '#f59e0b', false, true, NOW(), NOW()),
  ('lss_docs_no_response',      'documents_requested_not_responding', 'Documents Requested and Not Responding', 'Documents',   110, '#ef4444', false, true, NOW(), NOW()),
  ('lss_docs_received',         'documents_received',                 'Documents Received',                     'Documents',   120, '#16a34a', false, true, NOW(), NOW()),

  ('lss_payment_awaiting',      'payment_link_sent_awaiting',         'Payment Link Sent and Awaiting',         'Payment',     130, '#f59e0b', false, true, NOW(), NOW()),
  ('lss_payment_no_response',   'payment_link_sent_not_responding',   'Payment Link Sent and Not Responding',   'Payment',     140, '#ef4444', false, true, NOW(), NOW()),
  ('lss_part_payment',          'part_payment_received',              'Part Payment Received',                  'Payment',     150, '#22c55e', false, true, NOW(), NOW()),
  ('lss_confirmed',             'confirmed_awaiting_enrollment',      'Confirmed — Awaiting Enrollment',        'Payment',     160, '#16a34a', false, true, NOW(), NOW()),

  ('lss_awaiting_english',      'awaiting_english_test',              'Awaiting English Test (OET / IELTS)',    'Waiting on an external event', 170, '#fbbf24', false, true, NOW(), NOW()),
  ('lss_awaiting_exam',         'awaiting_exam_result',               'Awaiting Exam Result (NCLEX / CGFNS)',   'Waiting on an external event', 180, '#fbbf24', false, true, NOW(), NOW()),
  ('lss_awaiting_experience',   'awaiting_experience_completion',     'Awaiting Experience Completion',         'Waiting on an external event', 190, '#fcd34d', false, true, NOW(), NOW()),
  ('lss_arranging_funds',       'arranging_funds',                    'Arranging Funds',                        'Waiting on an external event', 200, '#f97316', false, true, NOW(), NOW()),
  ('lss_family_decision',       'family_decision_pending',            'Family Decision Pending',                'Waiting on an external event', 210, '#fb923c', false, true, NOW(), NOW()),
  ('lss_comparing_others',      'comparing_other_consultancies',      'Comparing Other Consultancies',          'Waiting on an external event', 220, '#fdba74', false, true, NOW(), NOW()),

  ('lss_postponed',             'postponed_by_candidate',             'Postponed by Candidate',                 'Dormant',     230, '#a1a1aa', false, true, NOW(), NOW()),
  ('lss_unreachable',           'unreachable_after_multiple_attempts','Unreachable After Multiple Attempts',    'Dormant',     240, '#71717a', false, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- Every lead gets one, so the field means something from day one rather than
-- reading as "nobody has filled this in yet" across 10k rows. `subStatusSince`
-- is left NULL on the backfill on purpose: nobody actually moved these leads
-- here, and stamping NOW() would tell every consultant that all ten thousand
-- entered this status today.
UPDATE "Lead"
SET "subStatusId" = 'lss_not_contacted'
WHERE "subStatusId" IS NULL;
