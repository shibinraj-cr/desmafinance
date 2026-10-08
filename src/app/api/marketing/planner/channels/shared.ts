import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { conflict } from "@/lib/http-error";

export const channelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ledgerSubItems: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  leadSourceIds: z.array(z.string().min(1)).max(50).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type ChannelInput = z.infer<typeof channelSchema>;

/**
 * A ledger sub-item can feed one channel only — otherwise the same rupee would
 * count as spend twice — and channel names must be unique.
 */
export async function checkChannelClaims(data: Partial<ChannelInput>, selfId?: string): Promise<void> {
  const others = await prisma.mktChannel.findMany({
    where: selfId ? { id: { not: selfId } } : {},
    select: { name: true, ledgerSubItems: true },
  });
  if (data.name && others.some((o) => o.name.toLowerCase() === data.name!.toLowerCase())) {
    throw conflict(`A channel called "${data.name}" already exists.`, "name_taken");
  }
  for (const sub of data.ledgerSubItems ?? []) {
    const owner = others.find((o) => o.ledgerSubItems.includes(sub));
    if (owner) throw conflict(`"${sub}" already feeds ${owner.name}.`, "sub_item_taken");
  }
}
