// Source of truth for transaction categories & sub-items.
// Mirrors the `_Dropdowns` sheet from the original Excel tracker so the web tool
// captures the same vocabulary used by the finance team.

export const TYPES = ["Revenue", "Expense"] as const;
export type TxType = (typeof TYPES)[number];

export const FLOWS = ["Inflow", "Outflow"] as const;
export type Flow = (typeof FLOWS)[number];

export const PAYMENT_MODES = [
  "HDFC Bank",
  "Axis Bank",
  "Wio Bank",
  "Credit Card",
  "Debit Card",
  "RCS",
  "STR",
  "Cash",
  "UPI",
] as const;

export const MONTHS = [
  "Apr-26",
  "May-26",
  "Jun-26",
  "Jul-26",
  "Aug-26",
  "Sep-26",
  "Oct-26",
  "Nov-26",
  "Dec-26",
  "Jan-27",
  "Feb-27",
  "Mar-27",
] as const;

export const REVENUE_CATEGORIES = [
  "Sales - Nursing Registrations",
  "Collection - Nursing Registrations",
  "Sales - Study Abroad",
  "Collection - Study Abroad",
  "Commissions",
] as const;

export const EXPENSE_CATEGORIES = [
  "Bank Fee and Charges",
  "Commissions",
  "Consulting Fee",
  "Legal and Professional Fees",
  "Marketing",
  "Office Supplies",
  "Recruitment Fee",
  "Refund",
  "Rent",
  "Repairs and Maintenance",
  "Salary",
  "Software Tools",
  "Staff Welfare",
  "Taxes",
  "Telephone and Internet",
  "Travel & Transportation",
] as const;

const REVENUE_SUB_ITEMS: Record<string, string[]> = {
  "Sales - Nursing Registrations": [
    "AHPRA OBA Pathway (Sales)",
    "AHPRA New Streamlined Pathway (Sales)",
    "New Zealand Direct Registration (Sales)",
    "New Zealand Pathway to Australia (Sales)",
    "Ireland Registration Process (Sales)",
    "AHPRA Final Registration Support (Sales)",
    "AHPRA Till NCLEX (Sales)",
    "ANMAC Skills Assessment (Sales)",
    "ANMAC + PR (Sales)",
    "AHPRA Final Reg + ANMAC + PR (Sales)",
    "RN Visa Processing (Sales)",
    "OSCE Visa + Final Registration (Sales)",
    "Renewal Service Charge",
  ],
  "Collection - Nursing Registrations": [
    "AHPRA OBA Pathway (Collection)",
    "AHPRA New Streamlined Pathway (Collection)",
    "New Zealand Direct Registration (Collection)",
    "New Zealand Pathway to Australia (Collection)",
    "Ireland Registration Process (Collection)",
    "AHPRA Final Registration Support (Collection)",
    "AHPRA Till NCLEX (Collection)",
    "ANMAC Skills Assessment (Collection)",
    "ANMAC + PR (Collection)",
    "AHPRA Final Reg + ANMAC + PR (Collection)",
    "RN Visa Processing (Collection)",
    "OSCE Visa + Final Registration (Collection)",
  ],
  "Sales - Study Abroad": [
    "Study Abroad - Registration Fee (Sales)",
    "Flight Ticket Booking",
    "PTE Coaching",
    "IELTS Coaching",
  ],
  "Collection - Study Abroad": [
    "Study Abroad - Registration Fee (Collection)",
  ],
  Commissions: ["OSCE Commission", "NCLEX Commission", "Verification Services", "Attestation"],
};

const EXPENSE_SUB_ITEMS: Record<string, string[]> = {
  "Bank Fee and Charges": ["Bank Fee and Charges"],
  Commissions: ["Commissions"],
  "Consulting Fee": ["Consulting Fee"],
  "Legal and Professional Fees": ["Legal and Professional Fees"],
  Marketing: [
    "Designs & Editing",
    "Digital Advertisement - Google",
    "Digital Advertisement - Meta",
    "Digital Marketing Management Fee",
  ],
  "Office Supplies": ["Office Supplies"],
  "Recruitment Fee": ["Recruitment Fee"],
  Refund: ["Refund"],
  Rent: ["Rent"],
  "Repairs and Maintenance": ["Repairs and Maintenance"],
  Salary: [
    "Cleaning Staff",
    "Directors",
    "Incentive",
    "Operational Team",
    "Sales Team",
    "Senior Team",
  ],
  "Software Tools": ["Software Tools"],
  "Staff Welfare": ["EPFO", "ESIC", "Meals and Entertainment"],
  Taxes: ["GST", "TDS"],
  "Telephone and Internet": ["Telephone and Internet"],
  "Travel & Transportation": ["Accommodation and Lodging", "Fuel"],
};

export function categoriesFor(type: TxType): readonly string[] {
  return type === "Revenue" ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES;
}

export function subItemsFor(type: TxType, category: string): string[] {
  const dict = type === "Revenue" ? REVENUE_SUB_ITEMS : EXPENSE_SUB_ITEMS;
  return dict[category] ?? [category];
}

export function flowFor(type: TxType): Flow {
  return type === "Revenue" ? "Inflow" : "Outflow";
}
