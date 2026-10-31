import { describe, expect, it } from "vite-plus/test";

import { splitChunks, takeSpeakable, toSpeakable } from "./speakableText";

/** Feeds `text` in growing prefixes, the way a streaming message arrives, and collects chunks. */
function streamed(text: string, step: number): Array<string> {
  const chunks: Array<string> = [];
  let consumedTo = 0;
  for (let length = step; length < text.length + step; length += step) {
    const prefix = text.slice(0, Math.min(length, text.length));
    const progress = takeSpeakable(prefix, consumedTo, false);
    chunks.push(...progress.chunks);
    consumedTo = progress.consumedTo;
  }
  chunks.push(...takeSpeakable(text, consumedTo, true).chunks);
  return chunks;
}

describe("takeSpeakable", () => {
  it("waits for a sentence to finish before reading it", () => {
    expect(takeSpeakable("I checked the file and", 0, false)).toEqual({
      chunks: [],
      consumedTo: 0,
    });
    expect(takeSpeakable("I checked the file. It looks", 0, false)).toEqual({
      chunks: ["I checked the file."],
      consumedTo: 20,
    });
    expect(takeSpeakable("I checked the file. It looks", 20, true).chunks).toEqual(["It looks."]);
  });

  it("holds back an unclosed code fence until it closes", () => {
    const open = "Here is the fix:\n```ts\nconst a = 1;\n";
    const progress = takeSpeakable(open, 0, false);
    expect(progress.chunks).toEqual(["Here is the fix:"]);
    expect(progress.consumedTo).toBe("Here is the fix:\n".length);
    const closed = `${open}\`\`\`\nThat should do it. `;
    expect(takeSpeakable(closed, progress.consumedTo, false).chunks).toEqual([
      "That should do it.",
    ]);
  });

  it("reads the same chunks however the text is streamed", () => {
    const message = [
      "## Summary",
      "",
      "I updated `apps/web/src/readAloud/speakableText.ts:12` and the tests. It works.",
      "",
      "```ts",
      "export const answer = 42;",
      "```",
      "",
      "- First, see [the docs](https://example.com/docs).",
      "- **Then** run it",
      "",
      "| a | b |",
      "|---|---|",
      "Done!",
    ].join("\n");
    const expected = [
      "Summary.",
      "I updated speakableText.ts and the tests.",
      "It works.",
      "First, see the docs.",
      "Then run it.",
      "Done!",
    ];
    expect(streamed(message, 1)).toEqual(expected);
    expect(streamed(message, 7)).toEqual(expected);
    expect(streamed(message, message.length)).toEqual(expected);
  });
});

describe("toSpeakable", () => {
  it("drops urls, html, and emphasis markers", () => {
    expect(toSpeakable("See https://x.dev/a for *more* <b>info</b>")).toBe("See for more info.");
  });
});

describe("splitChunks", () => {
  it("keeps file names whole and splits long sentences at commas", () => {
    expect(splitChunks("Open index.ts now. Then stop.")).toEqual([
      "Open index.ts now.",
      "Then stop.",
    ]);
    const long = `${"word ".repeat(40)}, ${"more ".repeat(40)}.`;
    const chunks = splitChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 280)).toBe(true);
  });
});
