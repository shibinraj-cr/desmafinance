"use client";

import Link from "next/link";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarRadiusAxis,
} from "recharts";
import type { Archetype } from "@/lib/psych-archetypes";
import styles from "./psych-report.module.css";

type Employee = {
  id: string;
  name: string;
  empCode: string;
  designation: string | null;
  department: string | null;
};

type Report = {
  id: string;
  generatedAt: string;
  submittedAt: string;
  oceanRaw: Record<string, number>;
  oceanNormalized: Record<string, number>;
  oceanPercentile: Record<string, number>;
  attitudeIndex: number;
  attitudeClass: string;
  profileType: string;
  profileLabel: string;
  riskFlags: Array<{ code: string; label: string; severity: string; hrAction: string }>;
  recommendations: string[];
  validityPassed: boolean;
  validityNotes: string | null;
  durationSeconds: number | null;
  suspiciousFlags: string[];
};

const DIM_LABEL: Record<string, string> = {
  O: "Openness",
  C: "Conscientiousness",
  E: "Extraversion",
  A: "Agreeableness",
  N: "Neuroticism",
};

function band(v: number) {
  if (v >= 70) return "High";
  if (v >= 60) return "Above average";
  if (v >= 41) return "Average";
  if (v >= 31) return "Below average";
  return "Low";
}

function interpret(dim: string, normalized: number) {
  const b = band(normalized);
  const high: Record<string, string> = {
    O: "Curious, imaginative, drawn to new ideas and experiences.",
    C: "Disciplined, organised, and dependable in follow-through.",
    E: "Energised by social settings; outwardly expressive.",
    A: "Cooperative, considerate, and quick to lend support.",
    N: "Emotionally reactive; sensitive to setbacks and stress.",
  };
  const low: Record<string, string> = {
    O: "Practical, conventional, preferring familiar approaches.",
    C: "Flexible and spontaneous; less drawn to rigid structure.",
    E: "Reserved, reflective, comfortable working alone.",
    A: "Direct and assertive; willing to take an opposing view.",
    N: "Even-keeled and calm under pressure.",
  };
  if (normalized >= 60) return `${b}. ${high[dim] ?? ""}`;
  if (normalized <= 40) return `${b}. ${low[dim] ?? ""}`;
  return `${b}. Balanced across both ends of this dimension.`;
}

export function ReportClient({
  employee,
  report,
  archetype,
}: {
  employee: Employee;
  report: Report;
  archetype: Archetype | null;
}) {
  const dims = ["O", "C", "E", "A", "N"] as const;
  const radarData = dims.map((d) => ({
    dim: DIM_LABEL[d],
    score: report.oceanNormalized[d] ?? 0,
  }));
  const gaugeData = [
    {
      name: "Attitude",
      value: report.attitudeIndex,
      fill:
        report.attitudeIndex >= 71
          ? "#16a34a"
          : report.attitudeIndex >= 41
            ? "#ca8a04"
            : "#dc2626",
    },
  ];

  return (
    <>
      <div className={styles.watermark} aria-hidden>
        <span>CONFIDENTIAL — HR USE ONLY</span>
      </div>

      <div className={"p-margin space-y-lg " + styles.reportRoot}>
        {/* On-screen header — hidden on print */}
        <div className={"flex items-center justify-between " + styles.noPrint}>
          <Link href="/hr/psych/assignments" className="text-label-sm underline">
            ← Assignments
          </Link>
          <button
            onClick={() => window.print()}
            className="px-md py-sm rounded bg-primary text-on-primary font-bold"
          >
            Print / Save as PDF
          </button>
        </div>

        {/* COVER */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <div className="text-caption text-on-surface-variant uppercase tracking-wider">
            Psychometric Assessment Report
          </div>
          <h1 className="text-h1 mt-xs">{employee.name}</h1>
          <div className="text-on-surface-variant text-body-md mt-xs">
            {employee.empCode}
            {employee.designation && <> · {employee.designation}</>}
            {employee.department && <> · {employee.department}</>}
          </div>
          <div className="mt-md grid grid-cols-2 gap-sm text-label-sm text-on-surface-variant">
            <div>
              Test date:{" "}
              <span className="text-on-surface font-bold">
                {new Date(report.submittedAt).toLocaleDateString()}
              </span>
            </div>
            <div>
              Report ID:{" "}
              <span className="text-on-surface font-mono">{report.id.slice(0, 12)}</span>
            </div>
          </div>
        </section>

        {/* EXECUTIVE SUMMARY */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">Executive summary</h2>
          <p className="leading-relaxed">
            {employee.name} presents as a <strong>{report.profileLabel}</strong>.{" "}
            {archetype?.narrative ?? ""}
          </p>
          <p className="leading-relaxed mt-sm">
            Overall attitude classification:{" "}
            <strong>{report.attitudeClass}</strong> (index {report.attitudeIndex}/100). This
            composite reflects a blend of agreeableness, conscientiousness, and emotional
            stability, and gives HR a quick read on workplace disposition. The detailed dimension
            scores below give the nuance behind that headline.
          </p>
        </section>

        {/* OCEAN dimensions */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">OCEAN dimension scores</h2>
          <div className="grid md:grid-cols-2 gap-md">
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <RadarChart data={radarData} outerRadius="80%">
                  <PolarGrid stroke="#cbd5e1" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: "#1f2937", fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar
                    name="score"
                    dataKey="score"
                    stroke="#1d4ed8"
                    fill="#3b82f6"
                    fillOpacity={0.35}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-xs pr-md">Dimension</th>
                  <th className="py-xs pr-md text-right">Score</th>
                  <th className="py-xs pr-md text-right">Pctl</th>
                  <th className="py-xs">Band</th>
                </tr>
              </thead>
              <tbody>
                {dims.map((d) => {
                  const norm = report.oceanNormalized[d] ?? 0;
                  return (
                    <tr key={d} className="border-b border-outline-variant last:border-0">
                      <td className="py-xs pr-md font-semibold">{DIM_LABEL[d]}</td>
                      <td className="py-xs pr-md text-right">{norm}</td>
                      <td className="py-xs pr-md text-right">
                        {report.oceanPercentile[d] ?? "—"}
                      </td>
                      <td className="py-xs">{band(norm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-md grid md:grid-cols-2 gap-sm">
            {dims.map((d) => (
              <div key={d} className="rounded border border-outline-variant p-sm">
                <div className="text-label-sm font-bold mb-xs">{DIM_LABEL[d]}</div>
                <div className="text-caption text-on-surface-variant">
                  {interpret(d, report.oceanNormalized[d] ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BEHAVIOUR PROFILE */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">Behaviour profile</h2>
          <div className="rounded-lg border-2 border-blue-700 bg-blue-50 p-md">
            <div className="text-h3 text-blue-900">{report.profileLabel}</div>
            {archetype && (
              <p className="text-blue-900 mt-xs leading-relaxed">{archetype.narrative}</p>
            )}
          </div>
          {archetype && (
            <div className="mt-md grid md:grid-cols-3 gap-sm">
              <div>
                <div className="text-label-sm font-bold mb-xs">Strengths</div>
                <ul className="list-disc pl-md text-label-sm text-on-surface-variant space-y-xs">
                  {archetype.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-label-sm font-bold mb-xs">Potential challenges</div>
                <ul className="list-disc pl-md text-label-sm text-on-surface-variant space-y-xs">
                  {archetype.challenges.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-label-sm font-bold mb-xs">Team role fit</div>
                <p className="text-label-sm text-on-surface-variant">{archetype.teamFit}</p>
              </div>
            </div>
          )}
        </section>

        {/* ATTITUDE INDEX */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">Attitude index</h2>
          <div className="grid md:grid-cols-2 gap-md items-center">
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <RadialBarChart
                  innerRadius="60%"
                  outerRadius="100%"
                  data={gaugeData}
                  startAngle={210}
                  endAngle={-30}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="value" background cornerRadius={10} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="text-h1">{report.attitudeIndex}/100</div>
              <div className="text-h3 text-on-surface-variant">{report.attitudeClass}</div>
              <p className="mt-sm text-on-surface-variant leading-relaxed text-label-sm">
                Composite of Agreeableness + Conscientiousness + inverted Neuroticism. Higher is
                better. Thresholds: 0–40 Needs Attention · 41–70 Moderate · 71–100 Positive.
              </p>
            </div>
          </div>
        </section>

        {/* RISK FLAGS */}
        {report.riskFlags.length > 0 && (
          <section className="rounded-xl border-2 border-red-300 bg-red-50 p-lg">
            <h2 className="text-h3 mb-sm text-red-900">Risk flags</h2>
            <ul className="space-y-sm">
              {report.riskFlags.map((f, i) => (
                <li key={i}>
                  <div className="font-bold text-red-900">{f.label}</div>
                  <div className="text-label-sm text-red-900/80">
                    Recommended HR action: {f.hrAction}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* RECOMMENDATIONS */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">Development recommendations</h2>
          <ul className="list-disc pl-md space-y-xs">
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>

        {/* VALIDITY */}
        <section className="rounded-xl border border-outline-variant bg-surface p-lg">
          <h2 className="text-h3 mb-sm">Validity note</h2>
          <div className="flex items-center gap-sm mb-xs">
            <span
              className={
                "px-sm py-xs rounded-full font-bold text-label-sm " +
                (report.validityPassed
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800")
              }
            >
              {report.validityPassed ? "Passed" : "Failed"}
            </span>
            <span className="text-on-surface-variant text-label-sm">
              {report.validityNotes ?? "No paired validity items configured."}
            </span>
          </div>
          {report.suspiciousFlags.length > 0 && (
            <p className="text-label-sm text-amber-800">
              Other concerns: {report.suspiciousFlags.join(", ")}
            </p>
          )}
          {report.durationSeconds != null && (
            <p className="text-caption text-on-surface-variant mt-xs">
              Completion time: {Math.round(report.durationSeconds / 60)} minutes.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
