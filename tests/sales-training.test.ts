import { describe, expect, it } from "vitest";
import {
  gradeAttempt,
  mergeRanges,
  parseBulkQuestions,
  parseYouTubeId,
  watchedPct,
  type TrainingQuestion,
} from "@/lib/sales-training";

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("%s", (input, id) => expect(parseYouTubeId(input)).toBe(id));

  it("rejects non-YouTube links", () => {
    expect(parseYouTubeId("https://vimeo.com/123")).toBeNull();
    expect(parseYouTubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
  });
});

describe("gradeAttempt", () => {
  const qs: TrainingQuestion[] = [
    { id: "a", kind: "single", prompt: "?", options: ["x", "y"], correct: [1], points: 1, explanation: null },
    { id: "b", kind: "multi", prompt: "?", options: ["x", "y", "z"], correct: [0, 2], points: 2, explanation: null },
  ];

  it("awards full marks only for an exact match", () => {
    const r = gradeAttempt(qs, { a: [1], b: [2, 0] }, 70);
    expect(r).toMatchObject({ score: 3, maxScore: 3, percent: 100, passed: true });
  });

  it("gives no partial credit on multi-select", () => {
    const r = gradeAttempt(qs, { a: [1], b: [0, 1, 2] }, 70);
    expect(r).toMatchObject({ score: 1, percent: 33, passed: false });
    expect(r.graded[1].isCorrect).toBe(false);
  });

  it("treats unanswered and out-of-range picks as wrong", () => {
    const r = gradeAttempt(qs, { a: [9] }, 0);
    expect(r.score).toBe(0);
    expect(r.graded[0].chosen).toEqual([]);
    expect(r.passed).toBe(true); // 0% ≥ 0% pass mark
  });

  it("never passes an empty quiz", () => {
    expect(gradeAttempt([], {}, 0).passed).toBe(false);
  });
});

describe("watch ranges", () => {
  it("merges overlapping and touching spans", () => {
    expect(mergeRanges([[10, 20], [0, 5], [5, 8], [19, 30], [40, 41]])).toEqual([[0, 8], [10, 30], [40, 41]]);
  });

  it("measures real coverage, so skipping ahead does not count", () => {
    expect(watchedPct([[0, 10], [90, 100]], 100)).toBe(20);
    expect(watchedPct([[0, 95]], 100)).toBe(95);
    expect(watchedPct([[0, 500]], 100)).toBe(100);
    expect(watchedPct([[0, 10]], 0)).toBe(0);
  });
});

describe("parseBulkQuestions", () => {
  it("parses single and multi questions with extras", () => {
    const { questions, errors } = parseBulkQuestions(`1. What do you ask first?
A) Budget
*B) Their goal
C) Nothing
Explanation: Goal first.

Q2: Pick the documents needed
*A) Passport
B) Ration card
*C) Degree certificate
Points: 3`);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ kind: "single", prompt: "What do you ask first?", correct: [1], explanation: "Goal first." });
    expect(questions[1]).toMatchObject({ kind: "multi", prompt: "Pick the documents needed", correct: [0, 2], points: 3 });
  });

  it("reports blocks with no right answer", () => {
    const { questions, errors } = parseBulkQuestions("Q?\nA) one\nB) two");
    expect(questions).toHaveLength(0);
    expect(errors[0]).toMatch(/mark the right option/);
  });
});
