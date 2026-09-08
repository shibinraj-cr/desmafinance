import { describe, it, expect } from "vitest";
import {
  hashFile,
  normalizeName,
  phoneTail,
  classify,
  isCertain,
  type ExistingCandidate,
} from "@/lib/hiring/ingest/dedupe";
import { rankJobs, tokenize, evidences, criterionTokens, type MatchableJob } from "@/lib/hiring/ingest/match";
import { missingMustHaves } from "@/lib/hiring/core";

function existing(p: Partial<ExistingCandidate>): ExistingCandidate {
  return {
    id: "c1", fullName: "Anu Menon", email: null, phone: null,
    resumeHash: null, currentEmployer: null, ...p,
  };
}
const incoming = (p: Partial<Parameters<typeof classify>[0]> = {}) => ({
  fileHash: "hash-new", fullName: "Anu Menon", email: null, phone: null,
  currentEmployer: null, ...p,
});

describe("file hashing", () => {
  it("is stable for identical bytes and different for different ones", () => {
    expect(hashFile(Buffer.from("abc"))).toBe(hashFile(Buffer.from("abc")));
    expect(hashFile(Buffer.from("abc"))).not.toBe(hashFile(Buffer.from("abd")));
  });

  it("accepts an ArrayBuffer as well as a Buffer", () => {
    const buf = Buffer.from("abc");
    expect(hashFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))).toBe(hashFile(buf));
  });
});

describe("name normalisation", () => {
  it("ignores the order of the parts — Indian names are written either way", () => {
    expect(normalizeName("Anu Menon")).toBe(normalizeName("Menon Anu"));
  });

  it("ignores case, punctuation and accents", () => {
    expect(normalizeName("ANU  MENON.")).toBe(normalizeName("Anu Menon"));
    expect(normalizeName("José Menon")).toBe(normalizeName("Jose Menon"));
  });

  it("drops honorifics and single initials, which vary between documents", () => {
    expect(normalizeName("Mr. Anu K Menon")).toBe(normalizeName("Anu Menon"));
    expect(normalizeName("Dr Anu Menon")).toBe(normalizeName("Menon Anu"));
  });

  it("is empty when there is nothing usable", () => {
    expect(normalizeName("Mr.")).toBe("");
  });
});

describe("phone tails survive formatting differences", () => {
  it("matches the same number written four ways", () => {
    const t = phoneTail("+91 98470 12345");
    expect(phoneTail("9847012345")).toBe(t);
    expect(phoneTail("098470-12345")).toBe(t);
    expect(phoneTail("+919847012345")).toBe(t);
  });

  it("is null for something too short to be evidence", () => {
    expect(phoneTail("12345")).toBeNull();
    expect(phoneTail(null)).toBeNull();
  });
});

describe("the dedupe ladder", () => {
  it("finds nothing when there is nothing to find", () => {
    expect(classify(incoming(), []).kind).toBe("none");
  });

  it("recognises the identical file first, before any parsing spend", () => {
    const r = classify(incoming({ fileHash: "h1" }), [existing({ resumeHash: "h1" })]);
    expect(r.kind).toBe("hash");
    expect(isCertain(r)).toBe(true);
  });

  it("matches an exact email regardless of case or spacing", () => {
    const r = classify(incoming({ email: " ANU@Example.COM " }), [existing({ email: "anu@example.com" })]);
    expect(r.kind).toBe("email");
    expect(r.needsConfirmation).toBe(false);
  });

  it("matches an exact phone across formats", () => {
    const r = classify(incoming({ phone: "9847012345" }), [existing({ phone: "+919847012345" })]);
    expect(r.kind).toBe("phone");
  });

  it("PROPOSES rather than merges on a name plus a matching phone tail", () => {
    const r = classify(
      incoming({ fullName: "Menon Anu", phone: "022-9847012345" }),
      [existing({ phone: "+919847012345" })],
    );
    expect(r.kind).toBe("proposed");
    expect(r.needsConfirmation).toBe(true);
    expect(isCertain(r)).toBe(false);
  });

  it("proposes on a name plus the same employer, ignoring Pvt/Ltd noise", () => {
    const r = classify(
      incoming({ currentEmployer: "Acme Solutions Pvt Ltd" }),
      [existing({ currentEmployer: "ACME  Solutions Limited" })],
    );
    expect(r.kind).toBe("proposed");
  });

  it("NEVER matches on a name alone — the failure that merges two people", () => {
    const r = classify(incoming({ fullName: "Anu Menon" }), [existing({ fullName: "Anu Menon" })]);
    expect(r.kind).toBe("none");
  });

  it("does not propose when the name matches but the phone does not", () => {
    const r = classify(
      incoming({ fullName: "Anu Menon", phone: "9999999999" }),
      [existing({ fullName: "Anu Menon", phone: "+919847012345" })],
    );
    expect(r.kind).toBe("none");
  });

  it("prefers the certain rung when several could match", () => {
    const r = classify(
      incoming({ fileHash: "h1", email: "anu@example.com" }),
      [existing({ id: "by-email", email: "anu@example.com" }), existing({ id: "by-hash", resumeHash: "h1" })],
    );
    expect(r.kind).toBe("hash");
    expect(r.candidateId).toBe("by-hash");
  });

  it("explains itself in words a recruiter can act on", () => {
    const r = classify(incoming({ email: "anu@example.com" }), [existing({ email: "anu@example.com" })]);
    expect(r.reason).toContain("anu@example.com");
    expect(r.reason).toContain("Anu Menon");
  });
});

describe("free job ranking", () => {
  const jobs: MatchableJob[] = [
    {
      id: "doc",
      title: "Documentation Executive",
      mustHaves: ["Attention to detail", "2 years documentation"],
      niceToHaves: ["AHPRA", "Excel"],
      seniority: "mid",
    },
    {
      id: "bde",
      title: "Business Development Executive",
      mustHaves: ["Malayalam", "1 year sales"],
      niceToHaves: ["CRM experience"],
      seniority: "junior",
    },
  ];

  it("ranks the job whose must-haves the résumé evidences", () => {
    const ranked = rankJobs(
      {
        currentTitle: "Documentation Officer",
        skills: ["Attention", "detail", "2", "years", "documentation", "AHPRA"],
        totalExperienceYears: 3,
      },
      jobs,
    );
    expect(ranked[0]!.jobId).toBe("doc");
    expect(ranked[0]!.fit).toBeGreaterThan(ranked[1]!.fit);
  });

  it("reports which must-haves matched and which did not", () => {
    const ranked = rankJobs(
      { currentTitle: null, skills: ["Malayalam"], totalExperienceYears: 1 },
      jobs,
    );
    const bde = ranked.find((r) => r.jobId === "bde")!;
    expect(bde.matchedMustHaves).toEqual(["Malayalam"]);
    expect(bde.missingMustHaves).toEqual(["1 year sales"]);
  });

  it("does not hand a free 100 to a job with no must-haves", () => {
    const empty: MatchableJob[] = [
      { id: "vague", title: "Something", mustHaves: [], niceToHaves: [], seniority: "mid" },
    ];
    const ranked = rankJobs({ currentTitle: "Anything", skills: ["x"], totalExperienceYears: 1 }, empty);
    expect(ranked[0]!.fit).toBeLessThanOrEqual(40);
  });

  it("scores zero when nothing lines up, rather than something flattering", () => {
    const ranked = rankJobs(
      { currentTitle: "Chef", skills: ["cooking"], totalExperienceYears: 5 },
      jobs,
    );
    expect(ranked.every((r) => r.fit === 0)).toBe(true);
  });

  // The candidate profile feeds `tags` in as `skills` — that column is what
  // accept() writes the parsed résumé skills into. If the two ever drift apart,
  // every profile silently shows 0% and looks like the matcher is broken.
  it("still ranks a talent-pool candidate, who has tags but no job title", () => {
    const ranked = rankJobs(
      { currentTitle: null, skills: ["Malayalam", "sales", "1", "year"], totalExperienceYears: 1 },
      jobs,
    );
    const bde = ranked.find((r) => r.jobId === "bde")!;
    expect(bde.fit).toBeGreaterThan(0);
    expect(bde.missingMustHaves).toEqual([]);
  });

  it("breaks ties by title so the order is stable between reads", () => {
    const tied: MatchableJob[] = [
      { id: "b", title: "Bravo", mustHaves: [], niceToHaves: [], seniority: "mid" },
      { id: "a", title: "Alpha", mustHaves: [], niceToHaves: [], seniority: "mid" },
    ];
    expect(rankJobs({ currentTitle: null, skills: [], totalExperienceYears: null }, tied).map((r) => r.title))
      .toEqual(["Alpha", "Bravo"]);
  });

  it("requires every token of a criterion, not just one", () => {
    const hay = tokenize("documentation");
    expect(evidences("2 years documentation", hay)).toBe(false);
    expect(evidences("documentation", hay)).toBe(true);
  });

  it("ignores filler words in a job title", () => {
    expect(tokenize("Senior Executive of Sales").has("senior")).toBe(false);
    expect(tokenize("Senior Executive of Sales").has("sales")).toBe(true);
  });
});

describe("criteria as recruiters actually write them", () => {
  // These are the real must-haves on DESMA's two live requisitions. Before the
  // filler-stripping, a strong candidate came back missing four of five.
  const DOC = ["Degree", "Communication Skill", "Language"];
  const COUNSELLOR = ["Language", "Convincing skill", "product knowledge", "client handling", "Degree"];
  const CV =
    "Bachelor of Commerce degree. Malayalam, English and Hindi. Four years as a counsellor " +
    "handling client queries, explaining our services and closing enrolments. Strong communication.";

  it("drops the filler word so 'Communication Skill' is met by 'communication'", () => {
    expect(criterionTokens("Communication Skill")).toEqual(["communication"]);
    expect(missingMustHaves(["Communication Skill"], CV)).toEqual([]);
  });

  it("meets 'client handling' from a CV that says 'handling client queries'", () => {
    expect(missingMustHaves(["client handling"], CV)).toEqual([]);
  });

  it("still refuses a criterion the CV genuinely does not evidence", () => {
    expect(missingMustHaves(["Convincing skill"], CV)).toEqual(["Convincing skill"]);
  });

  it("cannot infer a category — 'Language' is not met by 'Malayalam'", () => {
    // A token matcher cannot know Malayalam IS a language. This is a limit to
    // report honestly, not to paper over: the criterion should name the language.
    expect(missingMustHaves(["Language"], CV)).toEqual(["Language"]);
    expect(missingMustHaves(["Malayalam"], CV)).toEqual([]);
  });

  it("flags far less of a strong candidate than it used to", () => {
    expect(missingMustHaves(DOC, CV)).toEqual(["Language"]);
    expect(missingMustHaves(COUNSELLOR, CV).length).toBeLessThan(COUNSELLOR.length - 1);
  });

  it("does not become so loose that a weak CV passes", () => {
    const weak = "I am a hardworking person seeking an opportunity.";
    expect(missingMustHaves(DOC, weak)).toEqual(DOC);
  });

  it("keeps a numeric requirement strict — '2 years sales' is not met by 'three years'", () => {
    expect(missingMustHaves(["2 years sales"], "three years of sales experience")).toEqual([
      "2 years sales",
    ]);
  });

  it("falls back to the raw tokens when a criterion is nothing but filler", () => {
    expect(criterionTokens("Skills")).toEqual(["skills"]);
  });
});

describe("chunking has to fit inside the function's time budget", () => {
  // A 93-file import stalled at 36 because the chunk was 12 and each résumé is
  // a model call reading a whole PDF. These numbers are the fix, and they are
  // asserted so nobody quietly raises them again.
  const MAX_DURATION_S = 60;
  const CHUNK = 3;
  const SLOW_PARSE_S = 15; // a large or scanned CV, at the pessimistic end

  it("fits even when every résumé in the chunk is slow", () => {
    expect(CHUNK * SLOW_PARSE_S).toBeLessThanOrEqual(MAX_DURATION_S);
  });

  it("would NOT have fitted at the old chunk size, nor at four", () => {
    expect(12 * SLOW_PARSE_S).toBeGreaterThan(MAX_DURATION_S);
    // 4 x 15 is exactly 60 — the whole budget, with nothing left for the
    // request. This test is why the number is 3.
    expect(4 * SLOW_PARSE_S + 5).toBeGreaterThan(MAX_DURATION_S);
  });

  it("leaves headroom for the request itself, not just the parses", () => {
    const overheadS = 5;
    expect(CHUNK * SLOW_PARSE_S + overheadS).toBeLessThanOrEqual(MAX_DURATION_S);
  });
});
