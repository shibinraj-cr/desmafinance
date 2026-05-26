/**
 * 12 OCEAN-derived behaviour archetypes. The scoring engine picks one
 * based on the normalized score profile and returns its `type` key —
 * the report UI then looks up label, narrative, strengths, challenges,
 * and team-role-fit here.
 *
 * Score thresholds use the conventional H/M/L cut at 60 / 40 on a 0–100
 * normalized scale (matches IPIP norm conventions closely enough for v1).
 */

export type ArchetypeKey =
  | "COLLABORATIVE_DEPENDABLE"
  | "ASSERTIVE_CHALLENGER"
  | "AT_RISK_BURNOUT"
  | "INNOVATIVE_DRIVER"
  | "STEADY_ANCHOR"
  | "EMPATHETIC_HARMONISER"
  | "INDEPENDENT_THINKER"
  | "RESILIENT_CONNECTOR"
  | "RESERVED_PRECISIONIST"
  | "ADAPTIVE_EXPLORER"
  | "DISCIPLINED_EXECUTOR"
  | "CAUTIOUS_OBSERVER";

export type Archetype = {
  key: ArchetypeKey;
  label: string;
  narrative: string;
  strengths: string[];
  challenges: string[];
  teamFit: string;
};

export const archetypes: Record<ArchetypeKey, Archetype> = {
  COLLABORATIVE_DEPENDABLE: {
    key: "COLLABORATIVE_DEPENDABLE",
    label: "Collaborative Dependable",
    narrative:
      "Naturally cooperative, dependable, and considerate of others. Builds trust through consistency and a willingness to support the team.",
    strengths: ["Reliable delivery on commitments", "Strong team chemistry", "Constructive in disagreement"],
    challenges: ["May avoid necessary conflict", "Can over-extend to please"],
    teamFit: "Glue role on cross-functional teams; trusted operations or service lead.",
  },
  ASSERTIVE_CHALLENGER: {
    key: "ASSERTIVE_CHALLENGER",
    label: "Assertive Challenger",
    narrative:
      "Direct, confident, and willing to push for outcomes. Comfortable taking unpopular positions when convinced of the right path.",
    strengths: ["Drives decisions in stalled debates", "High personal accountability", "Effective negotiator"],
    challenges: ["Can be perceived as blunt", "May discount soft signals"],
    teamFit: "Sales, growth, or turnaround leadership where momentum matters.",
  },
  AT_RISK_BURNOUT: {
    key: "AT_RISK_BURNOUT",
    label: "At-Risk for Burnout",
    narrative:
      "Carries higher-than-typical emotional load and may struggle with sustained discipline. Likely benefits from explicit structure and check-ins.",
    strengths: ["Sensitive to team morale signals", "Empathic to struggling peers"],
    challenges: ["Inconsistent output under stress", "Self-critical loop"],
    teamFit: "Best paired with a steady manager and clearly bounded scope; flag for HR support.",
  },
  INNOVATIVE_DRIVER: {
    key: "INNOVATIVE_DRIVER",
    label: "Innovative Driver",
    narrative:
      "Pairs an exploratory mind with the energy to make ideas real. Comfortable with ambiguity and quick context switches.",
    strengths: ["Spots new directions early", "Energizes others around ideas", "Comfortable with first drafts"],
    challenges: ["Can drop ideas before they're finished", "Impatient with administrative work"],
    teamFit: "Product, R&D, or 0-to-1 initiatives where novelty trumps polish.",
  },
  STEADY_ANCHOR: {
    key: "STEADY_ANCHOR",
    label: "Steady Anchor",
    narrative:
      "Low emotional reactivity combined with strong follow-through. The person others rely on when things wobble.",
    strengths: ["Composed under pressure", "Predictable quality", "Calms escalations"],
    challenges: ["May resist necessary change", "Less visible in good times"],
    teamFit: "Operations, compliance, customer escalation desk, or finance.",
  },
  EMPATHETIC_HARMONISER: {
    key: "EMPATHETIC_HARMONISER",
    label: "Empathetic Harmoniser",
    narrative:
      "Reads the room, mediates well, and prioritises group cohesion. Often the unofficial culture-keeper of the team.",
    strengths: ["Defuses interpersonal friction", "Strong listener", "Inclusive by default"],
    challenges: ["May dilute hard feedback", "Decision speed can suffer"],
    teamFit: "People manager, HR business partner, customer success.",
  },
  INDEPENDENT_THINKER: {
    key: "INDEPENDENT_THINKER",
    label: "Independent Thinker",
    narrative:
      "Prefers depth over breadth and autonomy over crowding. Brings sharp, considered analysis when given room to work.",
    strengths: ["Original problem framings", "High signal-to-noise output"],
    challenges: ["Can disengage from group rituals", "Communication needs translation"],
    teamFit: "Strategy, engineering, research, or analytical specialist roles.",
  },
  RESILIENT_CONNECTOR: {
    key: "RESILIENT_CONNECTOR",
    label: "Resilient Connector",
    narrative:
      "Outward-facing, optimistic, and quick to bounce back from setbacks. Builds wide informal networks effortlessly.",
    strengths: ["Resilient under rejection", "Wide internal/external network", "Energising in groups"],
    challenges: ["May skip detail work", "Over-commits"],
    teamFit: "Business development, partnerships, recruiting, account management.",
  },
  RESERVED_PRECISIONIST: {
    key: "RESERVED_PRECISIONIST",
    label: "Reserved Precisionist",
    narrative:
      "Quiet, exacting, and thorough. Cares deeply about getting it right, even if that means slower visible output.",
    strengths: ["Catches subtle errors", "Self-directed once oriented", "High craft standards"],
    challenges: ["Slow to delegate", "Hesitant to surface work in progress"],
    teamFit: "Quality assurance, technical writing, finance reconciliation, audit.",
  },
  ADAPTIVE_EXPLORER: {
    key: "ADAPTIVE_EXPLORER",
    label: "Adaptive Explorer",
    narrative:
      "Curious, flexible, and at ease with change. Picks up new domains quickly and likes to keep options open.",
    strengths: ["Fast onboarding", "Comfortable with reorgs and pivots", "Cross-functional fluency"],
    challenges: ["Commitment can feel light", "Routine work loses their attention"],
    teamFit: "New-market entry, internal consulting, generalist roles.",
  },
  DISCIPLINED_EXECUTOR: {
    key: "DISCIPLINED_EXECUTOR",
    label: "Disciplined Executor",
    narrative:
      "Structured, organised, and goal-driven. Turns plans into delivered outcomes with minimal supervision.",
    strengths: ["Consistent goal attainment", "Strong planning rigour", "Clean handoffs"],
    challenges: ["May resist scope changes mid-flight", "Process can edge over outcome"],
    teamFit: "Project management, delivery lead, finance ops, operations excellence.",
  },
  CAUTIOUS_OBSERVER: {
    key: "CAUTIOUS_OBSERVER",
    label: "Cautious Observer",
    narrative:
      "Reflective, measured, and reluctant to act before understanding. Strong at risk-sensing in unfamiliar territory.",
    strengths: ["Spots downside risks early", "Thoughtful written communication"],
    challenges: ["Can stall on big decisions", "Lower visibility in fast meetings"],
    teamFit: "Risk, compliance, internal audit, due diligence.",
  },
};
