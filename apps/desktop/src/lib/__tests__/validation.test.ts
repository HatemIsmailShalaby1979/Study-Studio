import {
  validatePodcastChunk,
  validatePodcastTitle,
  validateLessonSectionBatch,
} from "@/lib/validation";

// Contract tests for the schema module.
//
// WHY THIS FILE EXISTS
//
// `validation.ts` had no suite of its own. Every schema in it was exercised
// only indirectly, through the generators that call it — which is how the
// `.min(2)` on `podcastChunkOutputSchema` became load-bearing and unasserted at
// the same time.
//
// That minimum is not a cosmetic rule. `generatePodcastChunked` in
// `generation/podcast.ts` runs `while (script.length < target)` with no
// iteration counter, deliberately: it relies on every accepted chunk carrying
// at least two lines, so each pass advances `script.length` by at least two and
// the loop reaches `target` on its own. Remove the minimum and a chunk of zero
// lines validates, `script.push(...[])` appends nothing, and the loop can never
// terminate. This assertion is therefore the loop's real bound, and it belongs
// to the schema's contract rather than to the generator's suite.
//
// It also has to be reachable ON ITS OWN. A focused run of the generator suite
// drives that loop before it reaches any boundary assertion, so a broken
// minimum shows up there as an exhausted heap rather than as a failed
// expectation. Asserting it here keeps the check a check.

type Speaker = "Host A" | "Host B";

/** A dialogue line that satisfies the 30-character minimum. */
function line(i: number) {
  return {
    speaker: (i % 2 === 0 ? "Host A" : "Host B") as Speaker,
    text: `Dialogue line number ${i}, comfortably longer than the thirty character minimum.`,
  };
}

function lines(n: number) {
  return Array.from({ length: n }, (_, i) => line(i));
}

describe("podcastChunkOutputSchema — the invariant that bounds the chunk loop", () => {
  it("rejects a chunk with no lines", () => {
    // The zero-line case is the one that hangs the loop: `script.push(...[])`
    // appends nothing, so `script.length` never reaches `target`.
    expect(() => validatePodcastChunk({ lines: [] })).toThrow(/at least 2/i);
  });

  it("rejects a chunk with one line", () => {
    expect(() => validatePodcastChunk({ lines: lines(1) })).toThrow(/at least 2/i);
  });

  it("accepts a chunk with exactly two lines — the smallest that advances the loop", () => {
    expect(validatePodcastChunk({ lines: lines(2) }).lines).toHaveLength(2);
  });

  it("rejects a line below the 30-character minimum", () => {
    expect(() =>
      validatePodcastChunk({ lines: [{ speaker: "Host A", text: "too short" }, line(1)] })
    ).toThrow(/at least 30/i);
  });

  it("rejects a speaker outside Host A / Host B", () => {
    expect(() =>
      validatePodcastChunk({ lines: [{ speaker: "Host C", text: line(0).text }, line(1)] })
    ).toThrow();
  });
});

describe("chunk-phase schemas — the other piecewise outputs", () => {
  it("requires a non-empty podcast title", () => {
    expect(validatePodcastTitle({ title: "Rain" }).title).toBe("Rain");
    expect(() => validatePodcastTitle({ title: "" })).toThrow();
  });

  it("requires at least one section per batch", () => {
    expect(() => validateLessonSectionBatch({ sections: [] })).toThrow();
  });

  it("rejects a section body below the 500-character minimum", () => {
    expect(() =>
      validateLessonSectionBatch({ sections: [{ heading: "H", content: "too short" }] })
    ).toThrow(/at least 500/i);
  });

  it("accepts a section that meets the 500-character minimum", () => {
    const content = "Detailed content. ".repeat(40); // 680 characters
    expect(validateLessonSectionBatch({ sections: [{ heading: "H", content }] }).sections).toHaveLength(1);
  });
});
