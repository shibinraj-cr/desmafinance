import { recordLeadActivity } from "@/lib/crm-activity";

/**
 * Called once, after an agreement is fully signed and sealed. The one place
 * for follow-on work (CRM today; invoicing can plug in here later) so it never
 * has to be threaded through the signing code.
 */
export async function onAgreementSigned(request: { id: string; reference: string; leadId: string | null; signedSha256: string | null }): Promise<void> {
  if (request.leadId) {
    await recordLeadActivity({
      leadId: request.leadId,
      type: "AGREEMENT_SIGNED",
      summary: `Agreement signed: ${request.reference}`,
      metadata: { esignRequestId: request.id, signedSha256: request.signedSha256 },
    });
  }
}
