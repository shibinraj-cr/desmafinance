/**
 * Wabis adapter — today's transport, behind the provider interface.
 *
 * Wabis addresses by WORKFLOW, not by template: a Webhook Workflow URL has one
 * approved template welded into it, so "which template" and "which URL" are the
 * same question. `sendTemplate` therefore needs a resolved `endpointUrl` and
 * treats `template` as a label for logging. That awkwardness is not a modelling
 * mistake on our side — it is the constraint we are migrating away from, and
 * `WabisWebhookEndpoint` exists only to carry it.
 *
 * Two capabilities are reported as unsupported rather than faked:
 *
 *   - `sendText`, because a Wabis workflow cannot carry arbitrary text and we
 *     have not confirmed a send API exists. A shared inbox needs this, which is
 *     why it is the question gating whether the inbox can ship on Wabis at all.
 *   - `listTemplates`, because approved templates live in the WABA and Wabis
 *     exposes no catalogue to us.
 *
 * An adapter that quietly returned success for either would turn a known gap
 * into a silent one. Callers get a clear `unsupported` instead.
 */
import { getWabisWebhookConfig, postWebhook } from "../crm-webhook";
import {
  unsupportedResult,
  type WaCapability,
  type WaMedia,
  type WaSendResult,
  type WaSendTemplateInput,
  type WaSendTextInput,
  type WaTemplateSummary,
  type WhatsAppProvider,
} from "./provider";

const SUPPORTED: ReadonlySet<WaCapability> = new Set<WaCapability>(["sendTemplate"]);

export const wabisProvider: WhatsAppProvider = {
  key: "wabis",
  label: "Wabis (Webhook Workflows)",

  supports(capability: WaCapability): boolean {
    return SUPPORTED.has(capability);
  },

  async sendTemplate(input: WaSendTemplateInput): Promise<WaSendResult> {
    const url = (input.endpointUrl ?? "").trim();
    if (!url) {
      // Not a transport failure — the caller never resolved a workflow. Marked
      // unsupported so a retry loop does not hammer a destination that does not
      // exist; the fix is an endpoint mapping, not another attempt.
      return unsupportedResult("no Wabis workflow URL resolved for this template");
    }

    const { secret } = await getWabisWebhookConfig();
    const result = await postWebhook(url, { ...(input.params ?? {}), template: input.template }, secret);

    // Wabis returns no message id, so delivery statuses cannot be correlated by
    // key — they are matched by phone + campaign + touch downstream. See
    // handleWabisDeliveryStatus.
    return { ok: result.ok, providerMessageId: null, status: result.status, body: result.body };
  },

  async sendText(_input: WaSendTextInput): Promise<WaSendResult> {
    return unsupportedResult("Wabis has no free-text send API wired — see CRM → Settings → Integrations");
  },

  async fetchMedia(_mediaId: string): Promise<WaMedia | null> {
    return null;
  },

  async listTemplates(): Promise<WaTemplateSummary[]> {
    return [];
  },
};
