import { describe, expect, it } from "vite-plus/test";

import { locateWords } from "./wordLocate";

function words(text: string, spoken: string, from = 0) {
  const { spans, end } = locateWords(text, spoken.split(" "), from);
  return { found: spans.map((span) => (span === null ? null : text.slice(...span))), end };
}

describe("locateWords", () => {
  it("finds each word in order, without its punctuation", () => {
    expect(
      words("I've made the ticket, and GitHub.", "I've made the ticket, and GitHub.").found,
    ).toEqual(["I've", "made", "the", "ticket", "and", "GitHub"]);
  });

  it("underlines a whole file path for its spoken file name", () => {
    expect(
      words("I updated apps/web/src/text.ts:12 today.", "I updated text.ts today.").found,
    ).toEqual(["I", "updated", "apps/web/src/text.ts:12", "today"]);
  });

  it("does not match a word inside another word", () => {
    expect(words("Iterate on it.", "on it.").found).toEqual(["on", "it"]);
  });

  it("leaves words it cannot find nearby unmatched and keeps going", () => {
    expect(words("Summary first. Then more.", "Overview first.").found).toEqual([null, "first"]);
  });

  it("places a later sentence by its opening words, not the first common word", () => {
    const text = "The cat sat. The dog ran home.";
    expect(words(text, "The dog ran home.").found).toEqual(["The", "dog", "ran", "home"]);
  });

  it("reads on from the previous sentence, and starts over when the text is read again", () => {
    const text = "It works. It works.";
    const first = words(text, "It works.");
    expect(words(text, "It works.", first.end).end).toBe(text.length - 1);
    expect(words(text, "It works.", text.length).end).toBe(first.end);
  });
});
