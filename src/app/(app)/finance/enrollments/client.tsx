"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EnrollmentDTO, EnrollmentTab } from "@/lib/crm-enrollment";
import { ENROLLMENT_STATUS_LABEL, MIN_FIRST_PAYMENT } from "@/lib/crm-enroll-confirm";
import { EnrollmentReview, enrollDate as date, enrollInr as inr, type EnrollmentReviewContext } from "@/components/finance/EnrollmentReview";
import { Callout, Pill, btnCls, cardCls, useToast } from "@/components/partner-commissions/ui";

export type EnrollmentsPageData = EnrollmentReviewContext & {
  tab: EnrollmentTab;
  rows: EnrollmentDTO[];
  counts: Record<"verify" | "submitted" | "sent-back" | "not-received", number>;
};

const TABS: Array<[EnrollmentTab, string]> = [
  ["verify", "To verify"],
  ["submitted", "Submitted for approval"],
  ["sent-back", "Sent back"],
  ["not-received", "Money not received"],
  ["verified", "Verified"],
];

export function EnrollmentsClient({ data }: { data: EnrollmentsPageData }) {
  const router = useRouter();
  const { show, node } = useToast();
  const [open, setOpen] = useState<EnrollmentDTO | null>(null);

  return (
    <div className="p-margin flex flex-col gap-md">
      <div className="flex gap-1 border-b border-outline-variant overflow-x-auto" role="tablist" aria-label="Sections">
        {TABS.map(([key, label]) => {
          const count = key === "verified" ? 0 : data.counts[key];
          return (
            <Link
              key={key}
              role="tab"
              aria-selected={data.tab === key}
              href={key === "verify" ? "?" : `?tab=${key}`}
              className={`px-md py-2.5 -mb-px border-b-[3px] text-body-md font-semibold whitespace-nowrap inline-flex items-center gap-2 ${data.tab === key ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
            >
              {label}
              {count ? <span className="text-[11px] px-2 rounded-full bg-primary text-on-primary">{count}</span> : null}
            </Link>
          );
        })}
      </div>

      {data.tab === "verify" &&
        (data.canApprove ? (
          <Callout icon="info">
            Each enrollment counts from the day the money landed, and the BDE&apos;s incentive counts it once you verify it (by the 7th of the next
            month). Check the payment against the bank, correct anything that&apos;s wrong (the BDE is told), then approve: the first payment goes
            into the ledger and the balance plan becomes the collection plan. Enrollments Finance has checked and submitted wait for you in{" "}
            <Link href="/finance/approvals/pending?type=Revenue" className="font-semibold text-accent hover:underline">
              Approvals › Revenue
            </Link>
            .
          </Callout>
        ) : (
          <Callout icon="info">
            Each enrollment counts from the day the money landed, and the BDE&apos;s incentive counts it once it&apos;s verified (by the 7th of the
            next month). Check the payment against the bank, correct anything that&apos;s wrong (the BDE is told), then <b>Submit for approval</b>: the
            Finance Manager approves it into the ledger and issues the invoice from Approvals › Revenue.
          </Callout>
        ))}
      {data.tab === "submitted" && (
        <Callout icon="info">
          Checked and waiting for the Finance Manager in{" "}
          {data.canApprove ? (
            <Link href="/finance/approvals/pending?type=Revenue" className="font-semibold text-accent hover:underline">
              Approvals › Revenue
            </Link>
          ) : (
            "Approvals › Revenue"
          )}
          . If the BDE changes one, it comes back to To verify.
        </Callout>
      )}

      {data.rows.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-md">Nothing here.</p>
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                <th className="px-md py-2 font-semibold">Candidate</th>
                <th className="px-md py-2 font-semibold">BDE</th>
                <th className="px-md py-2 font-semibold text-right">First payment</th>
                <th className="px-md py-2 font-semibold">Paid into</th>
                <th className="px-md py-2 font-semibold text-right">Total</th>
                <th className="px-md py-2 font-semibold">Flags</th>
                <th className="px-md py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant/60 last:border-0 align-top">
                  <td className="px-md py-2">
                    <Link href={`/crm/leads/${r.leadId}`} className="font-semibold text-accent hover:underline">
                      {r.candidateName}
                    </Link>
                    <div className="text-caption text-on-surface-variant">
                      {r.serviceName} · submitted {date(r.createdAt)}
                    </div>
                  </td>
                  <td className="px-md py-2 whitespace-nowrap">
                    {r.ownerName ?? r.submittedByName ?? "—"}
                    {r.checkedAt && r.status === "pending" ? (
                      <div className="text-caption text-on-surface-variant">
                        Checked{r.checkedByName ? ` by ${r.checkedByName}` : ""} {date(r.checkedAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-md py-2 text-right tabular-nums whitespace-nowrap">
                    {r.fields.firstAmount != null ? inr(r.fields.firstAmount) : "—"}
                    <div className="text-caption text-on-surface-variant">{date(r.fields.paidOn)}</div>
                  </td>
                  <td className="px-md py-2 whitespace-nowrap">
                    {r.fields.paymentMode ?? "—"}
                    {r.fields.utr ? <div className="text-caption text-on-surface-variant">UTR {r.fields.utr}</div> : null}
                  </td>
                  <td className="px-md py-2 text-right tabular-nums">{inr(r.fields.totalAmount)}</td>
                  <td className="px-md py-2">
                    <Flags r={r} />
                  </td>
                  <td className="px-md py-2 text-right">
                    <button type="button" className={btnCls} onClick={() => setOpen(r)}>
                      {data.tab === "verified" ? "View" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <EnrollmentReview
          key={open.id}
          row={open}
          data={data}
          onClose={(stale) => {
            setOpen(null);
            if (stale) router.refresh();
          }}
          onDone={(msg) => {
            setOpen(null);
            show(msg);
            router.refresh();
          }}
        />
      )}
      {node}
    </div>
  );
}

function Flags({ r }: { r: EnrollmentDTO }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.repeat && <Pill tone="info">Re-enrollment</Pill>}
      {r.fields.firstAmount == null && <Pill tone="bad">No payment details</Pill>}
      {r.returnNote && !r.checkedAt && r.status === "pending" && <Pill tone="warn">Returned by the Finance Manager</Pill>}
      {r.exception === "pending" && <Pill tone="warn">Under {inr(MIN_FIRST_PAYMENT)}: sales head</Pill>}
      {r.exception === "approved" && <Pill tone="ok">Small first payment approved</Pill>}
      {r.exception === "rejected" && <Pill tone="bad">Small first payment rejected</Pill>}
      {!r.fields.billingAddress && r.status !== "verified" && <Pill tone="neutral">No address</Pill>}
      {r.status !== "pending" && r.status !== "verified" && <Pill tone="bad">{ENROLLMENT_STATUS_LABEL[r.status]}</Pill>}
      {r.invoice && <Pill tone="ok">{r.invoice.number}</Pill>}
    </div>
  );
}
