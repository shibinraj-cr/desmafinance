/**
 * Lead notes as the API enforces them: who may add and edit, and what a note
 * from someone who can't edit the lead does to its staleness clocks. Prisma is
 * mocked; the routes and the crm-rbac rules run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn() },
  leadNote: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
const lp = vi.hoisted(() => ({ canSubmitEntries: true, role: "l2" as string | null }));
const user = vi.hoisted(() => ({ id: "head", pages: ["/crm/leads"] as string[] }));
const activity = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: user.id,
    perms: { isAdmin: false, canApprove: false, needsApproval: false, draftFirst: false, pages: user.pages, roleName: "Test" },
  })),
}));
vi.mock("@/lib/lead-pulse-rbac", () => ({
  getLeadPulseAccess: vi.fn(async () => ({ ...lp, displayName: null })),
}));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: activity }));

import { POST as addNote } from "@/app/api/crm/leads/[id]/notes/route";
import { PATCH as editNote, DELETE as deleteNote } from "@/app/api/crm/leads/[id]/notes/[noteId]/route";
import { CRM_NOTES_ALL_PAGE, CRM_TEAM_LEAD_PAGE } from "@/lib/crm-rbac";

const params = { id: "lead1" };
const noteParams = { id: "lead1", noteId: "note1" };

function json(method: string, body: unknown) {
  return new Request("http://local/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The lead belongs to `bde1`; the caller is `head`, an L2 BDE. */
function storedNote(authorId: string) {
  return {
    id: "note1",
    leadId: "lead1",
    authorId,
    author: { name: "Someone" },
    body: "before",
    editedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    lead: { id: "lead1", assignedToId: "bde1" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  user.id = "head";
  user.pages = ["/crm/leads"];
  db.lead.findUnique.mockResolvedValue({ id: "lead1", assignedToId: "bde1" });
  db.leadNote.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...storedNote(String(data.authorId)),
    body: data.body,
  }));
  db.leadNote.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...storedNote("head"),
    ...data,
  }));
  db.leadNote.delete.mockResolvedValue({});
});

describe("POST a note", () => {
  it("lets a CRM_NOTES_ALL_PAGE holder note someone else's lead, as oversight", async () => {
    user.pages = ["/crm/leads", CRM_NOTES_ALL_PAGE];
    const res = await addNote(json("POST", { body: "Call this one today" }), { params });

    expect(res.status).toBe(201);
    expect(db.leadNote.create).toHaveBeenCalledOnce();
    expect(activity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OVERSIGHT_NOTE_ADDED", actorId: "head", bumpLastActivity: false }),
    );
  });

  it("still counts a holder's note on their OWN lead as work", async () => {
    user.pages = ["/crm/leads", CRM_NOTES_ALL_PAGE];
    db.lead.findUnique.mockResolvedValue({ id: "lead1", assignedToId: "head" });
    await addNote(json("POST", { body: "Spoke to them" }), { params });

    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTE_ADDED", bumpLastActivity: true }));
  });

  it("counts the owning consultant's note as work", async () => {
    user.id = "bde1";
    const res = await addNote(json("POST", { body: "Spoke to them" }), { params });

    expect(res.status).toBe(201);
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTE_ADDED", bumpLastActivity: true }));
  });

  it("still refuses another consultant, including a view-only team lead", async () => {
    for (const pages of [["/crm/leads"], ["/crm/leads", CRM_TEAM_LEAD_PAGE]]) {
      user.pages = pages;
      const res = await addNote(json("POST", { body: "Not mine" }), { params });
      expect(res.status).toBe(403);
    }
    expect(db.leadNote.create).not.toHaveBeenCalled();
  });
});

describe("PATCH a note", () => {
  beforeEach(() => {
    user.pages = ["/crm/leads", CRM_NOTES_ALL_PAGE];
  });

  it("lets the holder correct their own note without touching the clocks", async () => {
    db.leadNote.findUnique.mockResolvedValue(storedNote("head"));
    const res = await editNote(json("PATCH", { body: "after" }), { params: noteParams });

    expect(res.status).toBe(200);
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTE_EDITED", bumpLastActivity: false }));
  });

  it("refuses the holder on the consultant's note", async () => {
    db.leadNote.findUnique.mockResolvedValue(storedNote("bde1"));
    const res = await editNote(json("PATCH", { body: "after" }), { params: noteParams });

    expect(res.status).toBe(403);
    expect(db.leadNote.update).not.toHaveBeenCalled();
  });
});

describe("DELETE a note", () => {
  it("lets the holder remove their own note without touching the clocks", async () => {
    user.pages = ["/crm/leads", CRM_NOTES_ALL_PAGE];
    db.leadNote.findUnique.mockResolvedValue(storedNote("head"));
    const res = await deleteNote(new Request("http://local/api", { method: "DELETE" }), { params: noteParams });

    expect(res.status).toBe(200);
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTE_DELETED", bumpLastActivity: false }));
  });

  it("keeps the clock bump when the owner deletes", async () => {
    user.id = "bde1";
    db.leadNote.findUnique.mockResolvedValue(storedNote("bde1"));
    await deleteNote(new Request("http://local/api", { method: "DELETE" }), { params: noteParams });

    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTE_DELETED", bumpLastActivity: true }));
  });
});
