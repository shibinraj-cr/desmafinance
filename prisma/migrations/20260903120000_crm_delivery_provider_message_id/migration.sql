-- CrmWebhookDelivery: store the Cloud-API message id (Meta wamid) on the touch's
-- outbox row so an async delivery-status callback (keyed by wamid on the WA
-- webhook) can join back to it — updating waStatus and, on a hard failure,
-- stopping the drip. Null on the Wabis transport.
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "providerMessageId" TEXT;

CREATE INDEX "CrmWebhookDelivery_providerMessageId_idx" ON "CrmWebhookDelivery"("providerMessageId");
