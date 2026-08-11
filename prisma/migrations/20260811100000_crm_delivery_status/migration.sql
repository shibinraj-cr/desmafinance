-- Lead: hard-undeliverable flag (Meta 131026) so a dead number is not re-touched
-- on later touch-points or a future re-marketing campaign.
ALTER TABLE "Lead" ADD COLUMN "whatsappUndeliverableAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "whatsappUndeliverableReason" TEXT;

-- CrmWebhookDelivery: async WhatsApp/Meta delivery status reported by the Wabis
-- delivery-status webhook AFTER our POST was accepted. Distinct from `status`,
-- which is only our transport/enqueue state.
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "waStatus" TEXT;
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "waErrorCode" TEXT;
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "waErrorMessage" TEXT;
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "waStatusAt" TIMESTAMP(3);
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "readAt" TIMESTAMP(3);

-- The campaign-delivery report scans failures by event.
CREATE INDEX "CrmWebhookDelivery_event_waStatus_idx" ON "CrmWebhookDelivery"("event", "waStatus");
