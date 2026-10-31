import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { HEARD_ALL, type PlannableItem, planThreadReads } from "./readProgress";

const SINCE = 1_000;

function user(id: string): PlannableItem {
  return { visibility: "local", item: { type: "user_message", id } };
}

function reply(
  id: string,
  options: {
    completedAt?: number | null;
    streaming?: boolean;
    visibility?: "local" | "inherited";
  } = {},
): PlannableItem {
  const completedAt = options.completedAt === undefined ? SINCE + 1 : options.completedAt;
  return {
    visibility: options.visibility ?? "local",
    item: {
      type: "assistant_message",
      id,
      text: `Reply ${id}.`,
      streaming: options.streaming ?? false,
      completedAt: completedAt === null ? null : DateTime.makeUnsafe(completedAt),
    },
  };
}

function plannedIds(items: ReadonlyArray<PlannableItem>, heard: Record<string, number> = {}) {
  return planThreadReads(items, heard, SINCE).reads.map((read) => [read.itemId, read.heard]);
}

describe("planThreadReads", () => {
  it("reads only replies after the user's latest message", () => {
    expect(plannedIds([user("u1"), reply("a1"), user("u2"), reply("a2"), reply("a3")])).toEqual([
      ["a2", 0],
      ["a3", 0],
    ]);
  });

  it("skips replies heard in full and resumes partly heard ones", () => {
    expect(
      plannedIds([user("u1"), reply("a1"), reply("a2"), reply("a3")], { a1: HEARD_ALL, a2: 2 }),
    ).toEqual([
      ["a2", 2],
      ["a3", 0],
    ]);
  });

  it("treats replies finished before read aloud was turned on as read", () => {
    expect(
      plannedIds([
        user("u1"),
        reply("old", { completedAt: SINCE - 1 }),
        reply("new", { completedAt: SINCE + 1 }),
        reply("live", { completedAt: null, streaming: true }),
      ]),
    ).toEqual([
      ["new", 0],
      ["live", 0],
    ]);
  });

  it("ignores replies inherited from another thread", () => {
    expect(plannedIds([user("u1"), reply("forked", { visibility: "inherited" })])).toEqual([]);
  });

  it("lists every reply after the latest message as current, read or not", () => {
    const plan = planThreadReads(
      [reply("a0"), user("u1"), reply("a1"), reply("a2", { completedAt: SINCE - 1 })],
      { a0: 1, a1: HEARD_ALL },
      SINCE,
    );
    expect([...plan.current]).toEqual(["a1", "a2"]);
  });
});
