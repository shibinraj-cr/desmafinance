// Plain module (no "use client"): the server page validates ?tab= against this
// list, and a value imported from a client module is only a reference on the
// server — calling TABS.some() on it threw and took the whole page down.
export const TABS = [
  { key: "consolidated", label: "Consolidated", icon: "summarize" },
  { key: "transactions", label: "Transactions", icon: "receipt" },
  { key: "statements", label: "Statements", icon: "description" },
  { key: "automation", label: "Automation", icon: "autorenew" },
  { key: "reconciliation", label: "Reconciliation", icon: "fact_check" },
  { key: "audit", label: "Audit Log", icon: "history" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
