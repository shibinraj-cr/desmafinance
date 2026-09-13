"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  AuditDTO,
  MyAckDTO,
  SopHeaderDTO,
  VersionDTO,
  VersionHistoryDTO,
} from "@/lib/sop/editor-dto";
import {
  ACK_STATE_CLASSES,
  ACK_STATE_LABELS,
  EXCEPTION_PRIORITY_CLASSES,
  EXCEPTION_PRIORITY_LABELS,
  KPI_STATUS_CLASSES,
  KPI_STATUS_LABELS,
  confidentialityLabel,
  formatSla,
  reviewFrequencyLabel,
  sopAuditLabel,
  sopStatusClass,
  sopStatusLabel,
  triggerTypeLabel,
  type ExceptionPriority,
  type KpiStatus,
} from "@/lib/sop/constants";
import { SopRichText } from "@/components/sop/SopRichText";
import {
  ConfirmDialog,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Pill,
  Section,
  Td,
  Th,
  dangerBtn,
  formatDate,
  formatDateTime,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
  taCls,
} from "@/components/sop/ui";

export type ReadCapabilities = {
  canEdit: boolean;
  canCreateRevision: boolean;
  canArchive: boolean;
  canSeeAudit: boolean;
  canSeeAcknowledgements: boolean;
  canRecordKpi: boolean;
};

/**
 * The operational reading view (§14).
 *
 * Everything is on one page and printable, because the thing a published SOP
 * has to do well is be read end to end — by someone mid-task, or on paper.
 * `print:` utilities strip the chrome so Ctrl-P / "Download PDF" produces the
 * document rather than a screenshot of the app; there is no PDF library here,
 * and there does not need to be one.
 */
export function SopReadClient({
  sop,
  version,
  history,
  audit,
  myAck,
  isLiveVersion,
  capabilities,
}: {
  sop: SopHeaderDTO;
  version: VersionDTO;
  history: VersionHistoryDTO[];
  audit: AuditDTO[];
  myAck: MyAckDTO;
  isLiveVersion: boolean;
  capabilities: ReadCapabilities;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revising, setRevising] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const viewLogged = useRef(false);

  /**
   * Count the read once per mount, and mark the viewer's acknowledgement row as
   * viewed at the same time. Only for a PUBLISHED version — a draft being
   * previewed by its own author is not a readership signal.
   */
  useEffect(() => {
    if (viewLogged.current) return;
    if (version.status !== "published") return;
    viewLogged.current = true;
    void sopApi(`/api/sop/sops/${sop.id}/view?version=${version.id}`, "POST");
  }, [sop.id, version.id, version.status]);

  async function copyLink() {
    const url = `${window.location.origin}/sop/${sop.id}?version=${version.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link — your browser blocked clipboard access.");
    }
  }

  return (
    <div className="space-y-lg max-w-5xl">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* ── Header ── */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-xs">
              <span className="font-mono text-label-sm text-on-surface-variant">{sop.sopNumber}</span>
              <Pill className={sopStatusClass(version.status)}>{sopStatusLabel(version.status)}</Pill>
              <Pill className="bg-surface-container-high text-on-surface-variant">
                {version.versionLabel}
              </Pill>
              {version.confidentiality !== "general" && (
                <Pill className="bg-surface-container-high text-on-surface-variant">
                  <Icon name="lock" size={12} className="mr-px" />
                  {confidentialityLabel(version.confidentiality)}
                </Pill>
              )}
            </div>
            <h2 className="text-h2 text-on-surface mt-xs">{version.title}</h2>
          </div>

          {/* Actions (§14). Hidden from print — a printed SOP has no buttons. */}
          <div className="flex flex-wrap items-center gap-xs print:hidden">
            <button
              type="button"
              className={secondaryBtn + " inline-flex items-center gap-xs"}
              onClick={() => window.print()}
            >
              <Icon name="print" size={18} /> Print / PDF
            </button>
            <button
              type="button"
              className={secondaryBtn + " inline-flex items-center gap-xs"}
              onClick={copyLink}
            >
              <Icon name={copied ? "check" : "link"} size={18} /> {copied ? "Copied" : "Copy link"}
            </button>
            {capabilities.canEdit && (
              <Link
                href={`/sop/${sop.id}/edit?version=${version.id}`}
                className={secondaryBtn + " inline-flex items-center gap-xs"}
              >
                <Icon name="edit" size={18} /> Edit
              </Link>
            )}
            {capabilities.canCreateRevision && (
              <button type="button" className={primaryBtn} onClick={() => setRevising(true)}>
                Create revision
              </button>
            )}
            {capabilities.canArchive && !sop.isArchived && (
              <button type="button" className={dangerBtn} onClick={() => setArchiving(true)}>
                Archive
              </button>
            )}
          </div>
        </div>

        {/* Which version am I reading? The banner is the point — a reader who
            does not notice they are on a superseded revision follows the wrong
            procedure. */}
        {!isLiveVersion && (
          <div className="mt-md rounded-lg border border-error bg-error-container text-on-error-container px-md py-sm text-body-sm">
            <Icon name="history" size={16} className="align-text-bottom mr-xs" />
            You are reading {version.versionLabel}, which is not the version in force.{" "}
            {sop.currentVersionId ? (
              <Link href={`/sop/${sop.id}`} className="underline font-medium">
                Open the current version
              </Link>
            ) : (
              "This SOP has never been published."
            )}
          </div>
        )}

        {sop.isArchived && (
          <div className="mt-md rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-sm text-on-surface-variant">
            <Icon name="inventory_2" size={16} className="align-text-bottom mr-xs" />
            Archived {formatDate(sop.archivedAt)}
            {sop.archiveReason ? ` — ${sop.archiveReason}` : ""}
            {sop.replacement && (
              <>
                {" "}
                Replaced by{" "}
                <Link href={`/sop/${sop.replacement.id}`} className="underline font-medium">
                  {sop.replacement.sopNumber} {sop.replacement.title}
                </Link>
                .
              </>
            )}
          </div>
        )}

        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-md mt-lg">
          <Meta label="Department" value={version.department} />
          <Meta label="Process owner" value={version.owner} />
          <Meta label="Category" value={version.category} />
          <Meta label="Process / function" value={version.processFunction} />
          <Meta label="Effective date" value={formatDate(version.effectiveDate)} />
          <Meta label="Next review" value={formatDate(version.nextReviewDate)} />
          <Meta label="Review frequency" value={reviewFrequencyLabel(version.reviewFrequency)} />
          <Meta label="Review owner" value={version.reviewOwner ?? version.owner} />
        </dl>
      </div>

      {/* ── Acknowledgement (§13) ── */}
      {myAck && (
        <div
          className={
            "rounded-xl border p-lg print:hidden " +
            (myAck.acknowledgedAt ? "border-outline-variant bg-surface-container-lowest" : "border-primary bg-primary-fixed/20")
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-md">
            <div>
              <div className="flex items-center gap-xs">
                <Icon name="how_to_reg" size={20} className="text-on-surface-variant" />
                <span className="text-body-lg font-medium text-on-surface">
                  {myAck.acknowledgedAt ? "You have acknowledged this SOP" : "Acknowledgement required"}
                </span>
                <Pill className={ACK_STATE_CLASSES[myAck.state]}>{ACK_STATE_LABELS[myAck.state]}</Pill>
              </div>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                {myAck.acknowledgedAt
                  ? `Confirmed on ${formatDateTime(myAck.acknowledgedAt)}.`
                  : myAck.deadline
                    ? `Please confirm you have read and understood it by ${formatDate(myAck.deadline)}.`
                    : "Please confirm you have read and understood it."}
              </p>
            </div>
            {!myAck.acknowledgedAt && (
              <button type="button" className={primaryBtn} onClick={() => setAckOpen(true)}>
                I have read &amp; understood
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Purpose ── */}
      <Section title="Purpose">
        <SopRichText
          source={version.purpose}
          empty={<span className="text-body-sm text-on-surface-variant">No purpose recorded.</span>}
        />
      </Section>

      {/* ── Trigger ── */}
      <Section title="Trigger" description="What starts this process.">
        {version.triggerDescription ? (
          <p className="text-body-md text-on-surface-variant">{version.triggerDescription}</p>
        ) : (
          <p className="text-body-sm text-on-surface-variant">No trigger described.</p>
        )}
        {(version.triggerType || version.triggerSource || version.triggerCondition) && (
          <dl className="grid sm:grid-cols-3 gap-md mt-md pt-md border-t border-outline-variant">
            <Meta label="Trigger type" value={triggerTypeLabel(version.triggerType)} />
            <Meta label="Trigger source" value={version.triggerSource} />
            <Meta label="Trigger condition" value={version.triggerCondition} />
          </dl>
        )}
      </Section>

      {/* ── Steps ── */}
      <Section title="Process steps" description={`${version.steps.length} step${version.steps.length === 1 ? "" : "s"}.`}>
        {version.steps.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No steps recorded.</p>
        ) : (
          <ol className="space-y-md">
            {version.steps.map((s) => (
              <li key={s.id} className="border-l-4 border-primary pl-md break-inside-avoid">
                <div className="flex flex-wrap items-center gap-xs">
                  <span className="h-6 w-6 grid place-items-center rounded-full bg-primary text-on-primary text-label-sm font-semibold">
                    {s.seq}
                  </span>
                  <span className="text-body-lg font-medium text-on-surface">{s.title}</span>
                </div>

                <div className="flex flex-wrap items-center gap-xs mt-xs">
                  {(s.responsibleRole || s.responsibleRoleName) && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      {s.responsibleRole ?? s.responsibleRoleName}
                    </Pill>
                  )}
                  {s.responsibleDepartment && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      {s.responsibleDepartment}
                    </Pill>
                  )}
                  {s.assignedEmployee && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      {s.assignedEmployee}
                    </Pill>
                  )}
                  {s.slaValue != null && s.slaUnit && (
                    <Pill className="bg-primary-fixed text-on-primary">
                      SLA {formatSla(s.slaValue, s.slaUnit)}
                    </Pill>
                  )}
                </div>

                {s.instruction && <SopRichText source={s.instruction} className="mt-sm" />}

                {(s.requiredInput || s.expectedOutput || s.evidence) && (
                  <dl className="grid sm:grid-cols-3 gap-md mt-sm">
                    <Meta label="Required input" value={s.requiredInput} />
                    <Meta label="Expected output" value={s.expectedOutput} />
                    <Meta label="Evidence" value={s.evidence} />
                  </dl>
                )}

                {s.checklist.length > 0 && (
                  <ul className="mt-sm space-y-xs">
                    {s.checklist.map((c) => (
                      <li key={c.id} className="flex items-start gap-xs text-body-md text-on-surface-variant">
                        <Icon name="check_box_outline_blank" size={18} className="text-outline shrink-0" />
                        <span>
                          {c.text}
                          {!c.isMandatory && (
                            <span className="text-caption text-on-surface-variant"> (optional)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {(s.supportingDocument || s.templateRef || s.linkUrl || s.notes) && (
                  <div className="text-caption text-on-surface-variant mt-sm space-y-px">
                    {s.supportingDocument && <div>Supporting document: {s.supportingDocument}</div>}
                    {s.templateRef && <div>Template: {s.templateRef}</div>}
                    {s.linkUrl && <div>Link: {s.linkUrl}</div>}
                    {s.notes && <div>Notes: {s.notes}</div>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── Quality standard ── */}
      <Section title="Quality standard" description="What has to be true for the work to count as done.">
        <SopRichText
          source={version.qualityStandard}
          empty={
            version.qualityCriteria.length === 0 ? (
              <span className="text-body-sm text-on-surface-variant">No quality standard recorded.</span>
            ) : null
          }
        />
        {version.qualityCriteria.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-outline-variant mt-md">
            <table className="w-full min-w-[32rem] border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <Th className="w-10">#</Th>
                  <Th>Criterion</Th>
                  <Th className="w-56">Target</Th>
                  <Th className="w-28">Mandatory</Th>
                </tr>
              </thead>
              <tbody>
                {version.qualityCriteria.map((q) => (
                  <tr key={q.id} className="border-b border-outline-variant last:border-0">
                    <Td className="text-on-surface-variant">{q.seq}</Td>
                    <Td className="text-on-surface">{q.criterion}</Td>
                    <Td className="text-on-surface-variant">{q.target ?? "—"}</Td>
                    <Td className="text-on-surface-variant">{q.isMandatory ? "Yes" : "No"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Exceptions ── */}
      <Section title="Exceptions & escalations">
        {version.exceptions.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No exceptions recorded.</p>
        ) : (
          <ul className="space-y-sm">
            {version.exceptions.map((x) => (
              <li
                key={x.id}
                className={
                  "rounded-xl border p-md break-inside-avoid " +
                  (x.priority === "critical"
                    ? "border-error bg-error-container/30 border-l-4"
                    : "border-outline-variant")
                }
              >
                <div className="flex flex-wrap items-center gap-xs">
                  <Pill className={EXCEPTION_PRIORITY_CLASSES[x.priority as ExceptionPriority]}>
                    {EXCEPTION_PRIORITY_LABELS[x.priority as ExceptionPriority] ?? x.priority}
                  </Pill>
                  <span className="text-body-lg font-medium text-on-surface">{x.issue}</span>
                </div>
                {x.condition && (
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    <span className="font-medium text-on-surface">When: </span>
                    {x.condition}
                  </p>
                )}
                {x.requiredAction && (
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    <span className="font-medium text-on-surface">Do: </span>
                    {x.requiredAction}
                  </p>
                )}
                <div className="flex flex-wrap gap-xs mt-sm">
                  {(x.escalateToRole || x.escalateToEmployee) && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      Escalate to {[x.escalateToRole, x.escalateToEmployee].filter(Boolean).join(" · ")}
                    </Pill>
                  )}
                  {x.escalationSla != null && x.escalationUnit && (
                    <Pill className="bg-primary-fixed text-on-primary">
                      Within {formatSla(x.escalationSla, x.escalationUnit)}
                    </Pill>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── KPIs ── */}
      <Section
        title="KPIs"
        description="How this process is measured."
        action={
          capabilities.canRecordKpi && version.kpis.length > 0 ? (
            <Link href="/sop/kpi-reviews" className={secondaryBtn + " inline-flex items-center gap-xs print:hidden"}>
              <Icon name="add_chart" size={18} /> Record results
            </Link>
          ) : null
        }
      >
        {version.kpis.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No KPIs defined.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-outline-variant">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <Th>KPI</Th>
                  <Th className="w-32">Target</Th>
                  <Th className="w-32">Frequency</Th>
                  <Th className="w-40">Owner</Th>
                  <Th className="w-44">Latest result</Th>
                </tr>
              </thead>
              <tbody>
                {version.kpis.map((k) => (
                  <tr key={k.id} className="border-b border-outline-variant last:border-0 align-top">
                    <Td>
                      <div className="text-on-surface font-medium">{k.name}</div>
                      {k.description && (
                        <div className="text-caption text-on-surface-variant">{k.description}</div>
                      )}
                    </Td>
                    <Td className="text-on-surface-variant">
                      {[k.target, k.unit].filter(Boolean).join(" ") || "—"}
                    </Td>
                    <Td className="text-on-surface-variant">{reviewFrequencyLabel(k.reviewFrequency)}</Td>
                    <Td className="text-on-surface-variant">{k.kpiOwner ?? version.owner ?? "—"}</Td>
                    <Td>
                      {k.latestActual ? (
                        <span className="flex flex-col gap-px">
                          <span className="text-on-surface font-medium">{k.latestActual}</span>
                          {k.latestStatus && (
                            <Pill className={KPI_STATUS_CLASSES[k.latestStatus as KpiStatus]}>
                              {KPI_STATUS_LABELS[k.latestStatus as KpiStatus] ?? k.latestStatus}
                            </Pill>
                          )}
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">Not measured yet</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Related documents ── */}
      <Section title="Related documents">
        {version.attachments.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Nothing attached.</p>
        ) : (
          <ul className="divide-y divide-outline-variant rounded-xl border border-outline-variant">
            {version.attachments.map((a) => {
              const href = a.fileUrl ?? a.linkUrl;
              return (
                <li key={a.id} className="flex items-center gap-md px-md py-sm">
                  <Icon name={a.fileUrl ? "description" : "link"} size={20} className="text-on-surface-variant" />
                  <div className="min-w-0 flex-1">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-on-surface font-medium hover:text-accent hover:underline"
                      >
                        {a.title}
                      </a>
                    ) : (
                      <span className="text-on-surface font-medium">{a.title}</span>
                    )}
                    <div className="text-caption text-on-surface-variant">
                      {[a.docType, a.docVersion, a.uploadedBy, formatDate(a.createdAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── Revision history (§15) ── */}
      <Section title="Version history" description="Published versions are kept for good and stay readable.">
        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <Th className="w-24">Version</Th>
                <Th className="w-36">Status</Th>
                <Th>Change summary</Th>
                <Th className="hidden md:table-cell w-32">Effective</Th>
                <Th className="hidden lg:table-cell w-40">Approved by</Th>
                <Th className="w-24 text-right print:hidden">Open</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-outline-variant last:border-0">
                  <Td className="font-mono text-label-sm">{h.versionLabel}</Td>
                  <Td>
                    <Pill className={sopStatusClass(h.status)}>{sopStatusLabel(h.status)}</Pill>
                  </Td>
                  <Td className="text-on-surface-variant">{h.changeSummary ?? "—"}</Td>
                  <Td className="hidden md:table-cell text-on-surface-variant">{formatDate(h.effectiveDate)}</Td>
                  <Td className="hidden lg:table-cell text-on-surface-variant">{h.approvedBy ?? "—"}</Td>
                  <Td className="text-right print:hidden">
                    {h.id === version.id ? (
                      <span className="text-label-sm text-on-surface-variant">Reading</span>
                    ) : (
                      <Link
                        href={`/sop/${sop.id}?version=${h.id}`}
                        className="text-label-sm text-accent hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Approval trail ── */}
      {version.actions.length > 0 && (
        <Section title="Approval trail" description="Who moved this version, and what they said.">
          <ul className="space-y-sm">
            {version.actions.map((a) => (
              <li key={a.id} className="flex items-start gap-sm">
                <Icon
                  name={a.decision === "changes_requested" ? "undo" : "check_circle"}
                  size={18}
                  className={a.decision === "changes_requested" ? "text-error mt-px" : "text-accent mt-px"}
                />
                <div>
                  <div className="text-body-md text-on-surface">
                    {a.actor ?? "Someone"} — {decisionLabel(a.stage, a.decision)}
                  </div>
                  <div className="text-caption text-on-surface-variant">{formatDateTime(a.actedAt)}</div>
                  {a.comments && (
                    <p className="text-body-sm text-on-surface-variant mt-xs">{a.comments}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Audit log (§16) ── */}
      {capabilities.canSeeAudit && audit.length > 0 && (
        <Section title="Audit log" description="Every change to this SOP, and who made it.">
          <div className="overflow-x-auto rounded-xl border border-outline-variant max-h-96 overflow-y-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0">
                <tr>
                  <Th className="w-44">When</Th>
                  <Th className="w-32">Who</Th>
                  <Th className="w-48">Action</Th>
                  <Th>Change</Th>
                  <Th className="hidden lg:table-cell w-20">Version</Th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-outline-variant last:border-0">
                    <Td className="text-on-surface-variant whitespace-nowrap">{formatDateTime(a.occurredAt)}</Td>
                    <Td className="text-on-surface-variant">{a.user ?? "system"}</Td>
                    <Td className="text-on-surface">{sopAuditLabel(a.action)}</Td>
                    <Td className="text-on-surface-variant">
                      {a.field && <span className="font-medium">{a.field}: </span>}
                      {a.oldValue || a.newValue ? (
                        <>
                          <span className="line-through opacity-70">{a.oldValue ?? "—"}</span>
                          {" → "}
                          <span>{a.newValue ?? "—"}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="hidden lg:table-cell font-mono text-label-sm">{a.versionLabel ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {capabilities.canSeeAcknowledgements && version.requiresAcknowledgement && (
        <div className="print:hidden">
          <Link
            href={`/sop/acknowledgements?version=${version.id}`}
            className="inline-flex items-center gap-xs text-body-md text-accent hover:underline"
          >
            <Icon name="how_to_reg" size={18} /> See who has acknowledged this version
          </Link>
        </div>
      )}

      {revising && (
        <RevisionDialog
          sopId={sop.id}
          currentLabel={version.versionLabel}
          onClose={() => setRevising(false)}
          onDone={(versionId) => {
            setRevising(false);
            router.push(`/sop/${sop.id}/edit?version=${versionId}`);
          }}
        />
      )}

      {archiving && (
        <ArchiveDialog
          sopId={sop.id}
          sopNumber={sop.sopNumber}
          onClose={() => setArchiving(false)}
          onDone={() => {
            setArchiving(false);
            router.refresh();
          }}
        />
      )}

      {ackOpen && myAck && (
        <ConfirmDialog
          title="Confirm you have read this SOP"
          confirmLabel="I have read & understood"
          message={
            <>
              You are confirming that you have read and understood{" "}
              <strong>
                {sop.sopNumber} — {version.title} ({version.versionLabel})
              </strong>
              . The confirmation is recorded against your name, with the date and time.
            </>
          }
          onCancel={() => setAckOpen(false)}
          onConfirm={async () => {
            const r = await sopApi("/api/sop/acknowledgements", "POST", {
              versionId: version.id,
              action: "acknowledge",
            });
            setAckOpen(false);
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

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="text-body-md text-on-surface mt-px">{value || "—"}</dd>
    </div>
  );
}

function decisionLabel(stage: string, decision: string): string {
  const where = stage === "approval" ? "approval" : "review";
  if (decision === "submitted") return `submitted for ${where}`;
  if (decision === "changes_requested") return `requested changes at ${where}`;
  if (decision === "published") return "published the SOP";
  return `approved at ${where}`;
}

function RevisionDialog({
  sopId,
  currentLabel,
  onClose,
  onDone,
}: {
  sopId: string;
  currentLabel: string;
  onClose: () => void;
  onDone: (versionId: string) => void;
}) {
  const [bump, setBump] = useState<"minor" | "major">("minor");
  const [changeSummary, setChangeSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const r = await sopApi<{ versionId: string }>(`/api/sop/sops/${sopId}/revision`, "POST", {
      bump,
      changeSummary: changeSummary.trim() || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDone(r.data.versionId);
  }

  return (
    <Modal
      title="Create a revision"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={go} disabled={busy}>
            {busy ? "Creating…" : "Create revision"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-body-sm text-on-surface-variant">
        {currentLabel} stays exactly as published. The revision starts as a copy of it, in draft, and
        goes through review and approval before it can replace it.
      </p>

      <Field label="Kind of change">
        <div className="space-y-xs">
          <label className="flex items-start gap-xs text-body-md text-on-surface">
            <input
              type="radio"
              className="mt-1"
              checked={bump === "minor"}
              onChange={() => setBump("minor")}
            />
            <span>
              Minor
              <span className="block text-caption text-on-surface-variant">
                Clarification, an SLA tweak, a new escalation row. The process itself is unchanged.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-xs text-body-md text-on-surface">
            <input
              type="radio"
              className="mt-1"
              checked={bump === "major"}
              onChange={() => setBump("major")}
            />
            <span>
              Major
              <span className="block text-caption text-on-surface-variant">
                The process has changed. Anyone trained on the old version needs to read this one.
              </span>
            </span>
          </label>
        </div>
      </Field>

      <Field label="Change summary" hint="Shown in the version history.">
        <textarea
          rows={3}
          className={taCls}
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          placeholder="e.g. Escalation matrix updated after the September audit"
        />
      </Field>
    </Modal>
  );
}

function ArchiveDialog({
  sopId,
  sopNumber,
  onClose,
  onDone,
}: {
  sopId: string;
  sopNumber: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacement, setReplacement] = useState<{ id: string; sopNumber: string; title: string } | null>(
    null,
  );
  const [matches, setMatches] = useState<{ id: string; sopNumber: string; title: string }[]>([]);
  const [archiveDate, setArchiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search the published register for a replacement, debounced.
  useEffect(() => {
    const q = replacementQuery.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await sopApi<{ rows: { id: string; sopNumber: string; title: string }[] }>(
        `/api/sop/sops?published=1&take=8&q=${encodeURIComponent(q)}`,
        "GET",
      );
      if (r.ok) setMatches(r.data.rows.filter((row) => row.id !== sopId));
    }, 300);
    return () => clearTimeout(t);
  }, [replacementQuery, sopId]);

  async function go() {
    if (!reason.trim()) {
      setError("Say why this SOP is being archived.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await sopApi(`/api/sop/sops/${sopId}/archive`, "POST", {
      reason: reason.trim(),
      replacementSopId: replacement?.id ?? null,
      archiveDate: archiveDate || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDone();
  }

  return (
    <Modal
      title={`Archive ${sopNumber}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={dangerBtn} onClick={go} disabled={busy}>
            {busy ? "Archiving…" : "Archive SOP"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-body-sm text-on-surface-variant">
        Archiving takes this SOP out of the library and out of everyone&rsquo;s My SOPs. It stays
        readable to SOP administrators, and can be restored.
      </p>

      <Field label="Archive reason" required>
        <textarea rows={3} className={taCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>

      <Field label="Replacement SOP" hint="Optional — the SOP that supersedes this one.">
        {replacement ? (
          <div className="flex items-center justify-between gap-md rounded-lg border border-outline-variant px-md h-10">
            <span className="text-body-md">
              <span className="font-mono text-label-sm text-on-surface-variant">{replacement.sopNumber}</span>{" "}
              {replacement.title}
            </span>
            <button type="button" aria-label="Clear replacement" onClick={() => setReplacement(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : (
          <>
            <input
              className={inputCls}
              value={replacementQuery}
              onChange={(e) => setReplacementQuery(e.target.value)}
              placeholder="Search published SOPs…"
            />
            {matches.length > 0 && (
              <ul className="mt-xs rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="w-full text-left px-md py-xs text-body-sm hover:bg-surface-container-low transition"
                      onClick={() => {
                        setReplacement(m);
                        setReplacementQuery("");
                        setMatches([]);
                      }}
                    >
                      <span className="font-mono text-label-sm text-on-surface-variant">{m.sopNumber}</span>{" "}
                      {m.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Field>

      <Field label="Archive date">
        <input
          type="date"
          className={inputCls}
          value={archiveDate}
          onChange={(e) => setArchiveDate(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
