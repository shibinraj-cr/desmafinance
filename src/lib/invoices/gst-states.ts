/**
 * Indian states and union territories with their GST state codes (the first
 * two digits of a GSTIN). An invoice's place of supply is the candidate's
 * state: the same state as the issuer means CGST + SGST, any other state IGST.
 *
 * Pure and client-safe. Codes follow the GST portal's list; retired codes
 * (25 Daman and Diu, 28 the old Andhra Pradesh) are left out.
 */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
] as const;

export type GstState = (typeof GST_STATES)[number];

/** The state with this exact name (case-blind), or null. */
export function gstStateByName(name: string | null | undefined): GstState | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return GST_STATES.find((s) => s.name.toLowerCase() === n) ?? null;
}

/** The state a GSTIN is registered in, from its first two digits. */
export function gstStateOfGstin(gstin: string | null | undefined): GstState | null {
  const code = (gstin ?? "").trim().slice(0, 2);
  return GST_STATES.find((s) => s.code === code) ?? null;
}

/** "Kerala (32)", as printed for the place of supply. */
export function placeOfSupplyLabel(s: GstState): string {
  return `${s.name} (${s.code})`;
}
