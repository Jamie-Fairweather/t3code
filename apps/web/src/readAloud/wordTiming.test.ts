import { describe, expect, it } from "vite-plus/test";

import { alignWordTimes, spokenWords } from "./wordTiming";

/** Tokens for phoneme words, one token per character, ten frames each, padded like Kokoro. */
function clip(phonemes: string) {
  const tokens = ["$", ...phonemes, "$"];
  return spokenWords(
    tokens,
    tokens.map(() => 10),
    tokens.length / 4,
  );
}

function rounded(times: ReadonlyArray<{ start: number; end: number }>) {
  return times.map(({ start, end }) => [Number(start.toFixed(2)), Number(end.toFixed(2))]);
}

describe("spokenWords", () => {
  it("groups tokens into words, skipping padding and punctuation, and ignores stress marks", () => {
    expect(clip("ðˈə kˈæt, sˈæt.")).toEqual([
      { length: 2, start: 0.25, end: 1 },
      { length: 3, start: 1.25, end: 2.25 },
      { length: 3, start: 2.75, end: 3.75 },
    ]);
  });

  it("scales frames to the clip's real length", () => {
    expect(spokenWords(["$", "a", "b", "$"], [10, 20, 20, 10], 3)).toEqual([
      { length: 2, start: 0.5, end: 2.5 },
    ]);
  });
});

describe("alignWordTimes", () => {
  it("matches words one to one when the counts agree", () => {
    const spoken = clip("aɪv mˌeɪd ðə tˈɪkɪt");
    expect(rounded(alignWordTimes(["I've", "made", "the", "ticket"], spoken, 5))).toEqual(
      rounded(spoken),
    );
  });

  it("gives a word every spoken word it became", () => {
    const spoken = clip("ˌɔn ɡˈɪt hˈʌb nˈaʊ");
    const [on, gitHub, now] = alignWordTimes(["on", "GitHub", "now"], spoken, 5);
    expect([on, gitHub, now]).toEqual([
      { start: spoken[0]!.start, end: spoken[0]!.end },
      { start: spoken[1]!.start, end: spoken[2]!.end },
      { start: spoken[3]!.start, end: spoken[3]!.end },
    ]);
  });

  it("handles numbers read as several words", () => {
    const spoken = clip("ˈɪts wˈʌn pˈɔɪnt fˈɔːɹ ˈeɪt nˈaʊ");
    const times = alignWordTimes(["it's", "1.48", "now"], spoken, 5);
    expect(times[1]).toEqual({ start: spoken[1]!.start, end: spoken[4]!.end });
    expect(times[2]).toEqual({ start: spoken[5]!.start, end: spoken[5]!.end });
  });

  it("falls back to an even guess when the model said nothing usable", () => {
    expect(rounded(alignWordTimes(["one", "two"], [], 2))).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});
