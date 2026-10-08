"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChannelDto } from "@/lib/mkt-planner-shared";
import { plannerApi } from "../_api";
import { Card, faintText, inputClass, inputStyle, mutedText, primaryBtnClass, primaryBtnStyle } from "../_ui";

type SubItem = { name: string; active: boolean };
type Source = { id: string; label: string; active: boolean };

export function ChannelsClient({ channels, subItems, sources }: { channels: ChannelDto[]; subItems: SubItem[]; sources: Source[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claimedBy = new Map<string, string>();
  for (const c of channels) for (const s of c.ledgerSubItems) claimedBy.set(s, c.id);
  const unclaimed = subItems.filter((s) => s.active && !claimedBy.has(s.name));

  async function add() {
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await plannerApi("POST", "/api/marketing/planner/channels", { name: newName.trim() });
      setNewName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the channel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {unclaimed.length > 0 && (
        <p className="text-[13px] rounded-[10px] px-[14px] py-[10px]" style={{ backgroundColor: "rgba(255, 182, 147, 0.08)", color: "var(--lp-orange)" }}>
          Not feeding any channel: {unclaimed.map((s) => s.name).join(", ")}. Spend on these shows as &ldquo;Not mapped&rdquo; and waits for a campaign tag.
        </p>
      )}
      <p className="text-[13px]" style={mutedText}>
        Sub-items come from Master Data › Categories › Marketing. To track a new kind of spend (events, print, influencers), ask Finance to add a sub-item there, then tick it here.
      </p>

      <div className="grid gap-[16px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))" }}>
        {channels.map((c) => (
          <ChannelCard key={c.id} channel={c} subItems={subItems} sources={sources} claimedBy={claimedBy} channels={channels} />
        ))}
        <Card title="Add a channel">
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Name
            <input className={inputClass} style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} placeholder="e.g. Radio" onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <button type="button" disabled={busy || !newName.trim()} onClick={add} className={primaryBtnClass} style={primaryBtnStyle}>
            Add channel
          </button>
          {error && <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>{error}</p>}
        </Card>
      </div>
    </div>
  );
}

function ChannelCard({
  channel,
  subItems,
  sources,
  claimedBy,
  channels,
}: {
  channel: ChannelDto;
  subItems: SubItem[];
  sources: Source[];
  claimedBy: Map<string, string>;
  channels: ChannelDto[];
}) {
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [active, setActive] = useState(channel.active);
  const [subs, setSubs] = useState<string[]>(channel.ledgerSubItems);
  const [srcs, setSrcs] = useState<string[]>(channel.leadSourceIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    name !== channel.name ||
    active !== channel.active ||
    subs.join("|") !== channel.ledgerSubItems.join("|") ||
    srcs.join("|") !== channel.leadSourceIds.join("|");

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? "another channel";
  // Mapped names that Finance has since renamed or removed — keep them visible so they can be unticked.
  const orphanSubs = channel.ledgerSubItems.filter((s) => !subItems.some((x) => x.name === s));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await plannerApi("PATCH", `/api/marketing/planner/channels/${channel.id}`, {
        name: name.trim(),
        active,
        ledgerSubItems: subs,
        leadSourceIds: srcs,
      });
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ opacity: active ? 1 : 0.7 }}>
      <div className="flex items-end gap-[10px]">
        <label className="flex-1 flex flex-col gap-[5px] text-[12px]" style={mutedText}>
          Channel name
          <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className="flex items-center gap-[6px] text-[12px] min-h-[40px]" style={mutedText}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ accentColor: "#facc15", width: 16, height: 16 }} />
          Active
        </label>
      </div>

      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[12px] font-semibold mb-[6px]">Ledger sub-items (spend)</legend>
        {subItems.length === 0 && <p className="text-[12px]" style={faintText}>No sub-items under Marketing in the finance master.</p>}
        {[...subItems.map((s) => s.name), ...orphanSubs].map((s) => {
          const owner = claimedBy.get(s);
          const takenElsewhere = !!owner && owner !== channel.id;
          const orphan = orphanSubs.includes(s);
          return (
            <label key={s} className="flex items-center gap-[8px] text-[13px] min-h-[28px]" style={takenElsewhere ? faintText : undefined}>
              <input type="checkbox" disabled={takenElsewhere} checked={subs.includes(s)} onChange={() => setSubs(toggle(subs, s))} style={{ accentColor: "#facc15", width: 16, height: 16 }} />
              <span>
                {s}
                {takenElsewhere && <span className="text-[11px]"> · feeds {channelName(owner!)}</span>}
                {orphan && <span className="text-[11px]" style={{ color: "var(--lp-orange)" }}> · no longer in the finance master</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[12px] font-semibold mb-[6px]">CRM lead sources (return)</legend>
        <div className="flex flex-wrap gap-[6px]">
          {sources.map((s) => {
            const on = srcs.includes(s.id);
            return (
              <label
                key={s.id}
                className="inline-flex items-center gap-[6px] min-h-[32px] px-[10px] rounded-full border text-[12px] cursor-pointer"
                style={{ borderColor: on ? "var(--lp-primary)" : "var(--lp-outline-variant)", color: on ? "var(--lp-primary)" : s.active ? "var(--lp-on-surface-variant)" : "var(--lp-outline)" }}
              >
                <input type="checkbox" checked={on} onChange={() => setSrcs(toggle(srcs, s.id))} style={{ accentColor: "#facc15", margin: 0 }} />
                {s.label}
                {!s.active && " (inactive)"}
              </label>
            );
          })}
        </div>
        <p className="text-[11px]" style={faintText}>Leave empty for channels that don&apos;t bring leads directly (agency fee, branding).</p>
      </fieldset>

      <div className="flex items-center gap-[10px]">
        <button type="button" disabled={busy || !dirty || !name.trim()} onClick={save} className={primaryBtnClass} style={primaryBtnStyle}>
          Save
        </button>
        {msg && (
          <span role={msg.ok ? undefined : "alert"} className="text-[13px]" style={{ color: msg.ok ? "var(--lp-cyan)" : "var(--lp-error)" }}>
            {msg.text}
          </span>
        )}
      </div>
    </Card>
  );
}
