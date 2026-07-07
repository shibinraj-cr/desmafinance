// Server-only helpers for CRM message templates (email + WhatsApp). The pure,
// client-safe definitions (DTO, merge fields, var builder) live in `crm.ts`.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { MessageChannel, MessageTemplateDTO } from "./crm";

export const MESSAGE_CHANNELS: MessageChannel[] = ["email", "whatsapp"];

type MessageTemplateRow = Prisma.CrmMessageTemplateGetPayload<Record<string, never>>;

/** ISO-serialize a template row for the client. */
export function serializeMessageTemplate(t: MessageTemplateRow): MessageTemplateDTO {
  return {
    id: t.id,
    channel: (t.channel === "whatsapp" ? "whatsapp" : "email"),
    name: t.name,
    subject: t.subject,
    body: t.body,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Every template, ordered channel → active-first → name. Used by the management
 * page. Pass `activeOnly` to fetch only the templates the composers should show.
 */
export async function listMessageTemplates(opts?: {
  channel?: MessageChannel;
  activeOnly?: boolean;
}): Promise<MessageTemplateDTO[]> {
  const rows = await prisma.crmMessageTemplate.findMany({
    where: {
      ...(opts?.channel ? { channel: opts.channel } : {}),
      ...(opts?.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ channel: "asc" }, { isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(serializeMessageTemplate);
}
