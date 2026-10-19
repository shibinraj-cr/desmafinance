-- Per-person switch for the automated WhatsApp intro sent on lead assignment.
-- Defaults on, so every existing roster row keeps today's behaviour.
ALTER TABLE "LeadPulseRole" ADD COLUMN "sendAssignIntro" BOOLEAN NOT NULL DEFAULT true;
