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
  "Salary",
  "Sales Team",
  "Operational Team",
  "Directors",
  "Senior Team",
  "Cleaning Staff",
  "Marketing",
  "Management Fee",
  "Rent",
  "Loan Repayment",
  "Labor Charges",
  "Software Tools",
  "Uniform",
  "Repairs and Maintenance",
  "Consulting Fee",
  "R&D Expenses",
  "Taxes",
  "Bank Fee and Charges",
  "Insurance",
  "Commissions",
  "Petty Cash",
  "Telephone and Internet",
  "Gift",
  "Electricity",
  "Legal and Professional Fees",
  "Printing and Stationery",
  "Miscellaneous Expenses",
  "Utility Expenses",
  "Charity and Donations",
  "Travel & Transportation",
  "Buying Assets",
  "Office Supplies",
  "Recruitment Fee",
  "Refund",
  "Referral Bonus",
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
  Salary: ["Salary", "Bonus Given"],
  "Sales Team": ["Sales Team"],
  "Operational Team": ["Operational Team"],
  Directors: ["Directors"],
  "Senior Team": ["Senior Team"],
  "Cleaning Staff": ["Cleaning Staff"],
  Marketing: [
    "Digital Advertisement - Meta",
    "Digital Advertisement - Google",
    "Stall and Exhibition",
    "Marketing Tools",
    "Designs & Editing",
    "Video Development",
    "PR Activity",
    "Offline Advertisement",
  ],
  "Management Fee": ["Management Fee", "Incentive", "Sales Training"],
  Rent: ["Rent"],
  "Loan Repayment": ["Loan Repayment"],
  "Labor Charges": ["Labor Charges"],
  "Software Tools": ["Software Tools"],
  Uniform: ["Uniform"],
  "Repairs and Maintenance": ["Repairs and Maintenance"],
  "Consulting Fee": ["Consulting Fee"],
  "R&D Expenses": ["R&D Expenses"],
  Taxes: ["GST", "Income Tax", "TDS", "Profession Tax"],
  "Bank Fee and Charges": ["Bank Fee and Charges"],
  Insurance: ["Insurance"],
  Commissions: ["Commissions"],
  "Petty Cash": ["Petty Cash"],
  "Telephone and Internet": ["Telephone and Internet"],
  Gift: ["Gift"],
  Electricity: ["Electricity"],
  "Legal and Professional Fees": ["Legal and Professional Fees"],
  "Printing and Stationery": ["Printing and Stationery"],
  "Miscellaneous Expenses": ["Miscellaneous Expenses"],
  "Utility Expenses": ["Utility Expenses", "ESIC", "EPFO"],
  "Charity and Donations": ["Charity and Donations"],
  "Travel & Transportation": [
    "Travel Allowance",
    "Domestic Travel",
    "International Travel",
    "Accommodation and Lodging",
    "Fuel",
    "Meals and Entertainment",
    "Training and Education",
  ],
  "Buying Assets": ["Buying Assets"],
  "Office Supplies": ["Office Supplies"],
  "Recruitment Fee": ["Recruitment Fee"],
  Refund: ["Refund"],
  "Referral Bonus": ["Referral Bonus"],
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
