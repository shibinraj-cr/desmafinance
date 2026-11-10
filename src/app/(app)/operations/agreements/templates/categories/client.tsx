"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, api, inputCls, primaryBtn, secondaryBtn } from "../../_ui";

export type CategoryRow = {
  id: string;
  name: string;
  active: boolean;
  /** Active templates in this category. */
  templates: number;
  archivedTemplates: number;
};

const iconBtn = secondaryBtn + " !px-sm !py-xs";

export function CategoriesClient({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<string | null | void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return setError("Give the category a name.");
    const ok = await run("new", async () => {
      await api("/api/esign/categories", "POST", { name: newName });
    });
    if (ok) setNewName("");
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await run(editing.id, async () => {
      const res = await api<{ templatesRenamed: number }>(`/api/esign/categories/${editing.id}`, "PATCH", {
        name: editing.name,
      });
      return res.templatesRenamed
        ? `Renamed on ${res.templatesRenamed} template${res.templatesRenamed === 1 ? "" : "s"}.`
        : null;
    });
    if (ok) setEditing(null);
  }

  const patch = (c: CategoryRow, body: Record<string, unknown>) =>
    run(c.id, async () => {
      await api(`/api/esign/categories/${c.id}`, "PATCH", body);
    });

  function setActive(c: CategoryRow, active: boolean) {
    if (
      !active &&
      !window.confirm(
        `Archive "${c.name}"? It will no longer be offered for templates. Templates already in it keep it, and you can restore it later.`,
      )
    ) {
      return;
    }
    void patch(c, { active });
  }

  function remove(c: CategoryRow) {
    if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    void run(c.id, async () => {
      await api(`/api/esign/categories/${c.id}`, "DELETE");
    });
  }

  return (
    <div className="space-y-md max-w-3xl">
      <p className="text-body-md text-on-surface-variant">
        Renaming a category renames it on every template in it. Agreements already sent keep the category they were
        sent under. Archive a category to stop offering it; only a category no template uses can be deleted.
      </p>

      <form onSubmit={add} className="flex flex-wrap items-center gap-sm">
        <input
          className={inputCls + " flex-1 min-w-[220px]"}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category, e.g. UK Agreement"
          aria-label="New category name"
          maxLength={80}
        />
        <button type="submit" className={primaryBtn} disabled={busy === "new"}>
          <Icon name="add" /> {busy === "new" ? "Adding…" : "Add category"}
        </button>
      </form>

      {error && (
        <p className="text-body-md text-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-body-md text-on-surface-variant" role="status">
          {notice}
        </p>
      )}

      {categories.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-lg text-center">
          No categories yet. Add one above before creating a template.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Category</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Templates</th>
                <th className="px-md py-sm" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => {
                const inUse = c.templates + c.archivedTemplates;
                const rowBusy = busy === c.id;
                const faded = c.active ? "" : " opacity-60";
                return (
                  <tr key={c.id} className="border-t border-outline-variant">
                    <td className={"px-md py-sm align-middle" + (editing?.id === c.id ? "" : faded)}>
                      {editing?.id === c.id ? (
                        <form onSubmit={rename} className="flex flex-wrap items-center gap-xs">
                          <input
                            className={inputCls + " flex-1 min-w-[180px]"}
                            value={editing.name}
                            onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                            aria-label={`New name for ${c.name}`}
                            maxLength={80}
                            autoFocus
                          />
                          <button type="submit" className={primaryBtn + " !py-xs"} disabled={rowBusy}>
                            {rowBusy ? "Saving…" : "Save"}
                          </button>
                          <button type="button" className={secondaryBtn + " !py-xs"} onClick={() => setEditing(null)} disabled={rowBusy}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="font-semibold">{c.name}</span>
                          {!c.active && (
                            <span className="ml-sm text-caption px-xs py-[1px] rounded bg-surface-container text-on-surface-variant">
                              Archived
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className={"px-md py-sm align-middle text-right tabular-nums whitespace-nowrap" + faded}>
                      {c.templates}
                      {c.archivedTemplates > 0 && (
                        <span className="text-caption text-on-surface-variant"> + {c.archivedTemplates} archived</span>
                      )}
                    </td>
                    <td className="px-md py-sm align-middle">
                      <div className="flex flex-wrap justify-end gap-xs">
                        <button
                          type="button"
                          className={iconBtn}
                          onClick={() => patch(c, { move: "up" })}
                          disabled={rowBusy || i === 0}
                          title="Move up"
                          aria-label={`Move ${c.name} up`}
                        >
                          <Icon name="arrow_upward" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          onClick={() => patch(c, { move: "down" })}
                          disabled={rowBusy || i === categories.length - 1}
                          title="Move down"
                          aria-label={`Move ${c.name} down`}
                        >
                          <Icon name="arrow_downward" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          onClick={() => {
                            setError(null);
                            setEditing({ id: c.id, name: c.name });
                          }}
                          disabled={rowBusy}
                          title="Rename"
                          aria-label={`Rename ${c.name}`}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          onClick={() => setActive(c, !c.active)}
                          disabled={rowBusy}
                          title={c.active ? "Archive" : "Restore"}
                          aria-label={`${c.active ? "Archive" : "Restore"} ${c.name}`}
                        >
                          <Icon name={c.active ? "archive" : "unarchive"} />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          onClick={() => remove(c)}
                          disabled={rowBusy || inUse > 0}
                          title={inUse > 0 ? "In use by templates. Archive it instead." : "Delete"}
                          aria-label={`Delete ${c.name}`}
                        >
                          <Icon name="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
