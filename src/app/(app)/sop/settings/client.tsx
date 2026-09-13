"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ConfirmDialog,
  Empty,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Pill,
  Td,
  Th,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
  taCls,
} from "@/components/sop/ui";

type Category = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  sopCount: number;
};

/**
 * SOP category management.
 *
 * Deleting a category that is in use DEACTIVATES it instead — the server
 * decides that, and the dialog says so up front rather than letting an admin
 * press Delete and be surprised by what happened. An inactive category
 * disappears from the pickers but keeps classifying the SOPs already on it.
 */
export function CategoriesClient({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ item: Category | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive(c: Category) {
    setBusy(true);
    setError(null);
    const r = await sopApi(`/api/sop/categories/${c.id}`, "PATCH", { isActive: !c.isActive });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-md">
      {error && <ErrorNote>{error}</ErrorNote>}

      {categories.length === 0 ? (
        <Empty
          icon="category"
          title="No categories yet"
          hint="Add the classifications your SOPs should be filed under — Process, Policy, Compliance, Quality."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <Th className="w-16">Order</Th>
                <Th>Category</Th>
                <Th className="hidden md:table-cell">Description</Th>
                <Th className="w-20">SOPs</Th>
                <Th className="w-28">Status</Th>
                <Th className="w-32 text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b border-outline-variant last:border-0">
                  <Td className="text-on-surface-variant">{c.sortOrder}</Td>
                  <Td className="text-on-surface font-medium">{c.name}</Td>
                  <Td className="hidden md:table-cell text-on-surface-variant">{c.description ?? "—"}</Td>
                  <Td className="text-on-surface-variant">{c.sopCount}</Td>
                  <Td>
                    {c.isActive ? (
                      <Pill className="bg-primary text-on-primary">Active</Pill>
                    ) : (
                      <Pill className="bg-surface-container-high text-on-surface-variant">Inactive</Pill>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <button
                      type="button"
                      title={c.isActive ? "Deactivate" : "Reactivate"}
                      aria-label={c.isActive ? `Deactivate ${c.name}` : `Reactivate ${c.name}`}
                      disabled={busy}
                      onClick={() => toggleActive(c)}
                      className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40"
                    >
                      <Icon name={c.isActive ? "visibility_off" : "visibility"} size={18} />
                    </button>
                    <button
                      type="button"
                      title="Edit"
                      aria-label={`Edit ${c.name}`}
                      onClick={() => setEditing({ item: c })}
                      className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition"
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => setConfirmDelete(c)}
                      className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition"
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        className={primaryBtn + " inline-flex items-center gap-xs"}
        onClick={() => setEditing({ item: null })}
      >
        <Icon name="add" /> Add category
      </button>

      {editing && (
        <CategoryDialog
          item={editing.item}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.sopCount > 0 ? "Deactivate this category?" : "Delete this category?"}
          tone="danger"
          confirmLabel={confirmDelete.sopCount > 0 ? "Deactivate" : "Delete"}
          busy={busy}
          message={
            confirmDelete.sopCount > 0 ? (
              <>
                &ldquo;{confirmDelete.name}&rdquo; classifies {confirmDelete.sopCount} SOP
                {confirmDelete.sopCount === 1 ? "" : "s"}, so it will be deactivated rather than deleted:
                it disappears from the pickers, and those SOPs keep their classification.
              </>
            ) : (
              <>&ldquo;{confirmDelete.name}&rdquo; is unused and will be deleted.</>
            )
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setBusy(true);
            const r = await sopApi(`/api/sop/categories/${confirmDelete.id}`, "DELETE");
            setBusy(false);
            setConfirmDelete(null);
            if (!r.ok) {
              setError(r.error);
              return;
            }
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CategoryDialog({
  item,
  onClose,
  onSaved,
}: {
  item: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Give the category a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      sortOrder: Number(sortOrder || 0),
      isActive,
    };
    const r = item
      ? await sopApi(`/api/sop/categories/${item.id}`, "PATCH", body)
      : await sopApi("/api/sop/categories", "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={item ? "Edit category" : "Add category"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <Field label="Name" required>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Process"
        />
      </Field>
      <Field label="Description">
        <textarea
          rows={2}
          className={taCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Sort order" hint="Lower numbers come first in the pickers.">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active (shown in the pickers)
      </label>
    </Modal>
  );
}
