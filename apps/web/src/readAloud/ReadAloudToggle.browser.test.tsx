import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import type { PlannableItem } from "./readProgress";

const mocks = vi.hoisted(() => ({
  speak: vi.fn(),
  items: new Map<string, ReadonlyArray<PlannableItem>>(),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: <T,>(select: (settings: { readAloudEnabled: boolean }) => T) =>
    select({ readAloudEnabled: true }),
  getClientSettings: () => ({ readAloudVoice: "af_heart", readAloudSpeed: 1 }),
  updateClientSettings: vi.fn(),
}));
vi.mock("~/state/entities", () => ({
  useThreadVisibleTurnItems: (ref: ScopedThreadRef) => mocks.items.get(ref.threadId) ?? [],
}));
vi.mock(import("./readAloudEngine"), async (importOriginal) => ({
  ...(await importOriginal()),
  speak: mocks.speak,
}));

import { ReadAloudToggle } from "./ReadAloudToggle";

const environmentId = EnvironmentId.make("environment");
const replyThread = scopeThreadRef(environmentId, ThreadId.make("reply-thread"));
const otherThread = scopeThreadRef(environmentId, ThreadId.make("other-thread"));

function setup() {
  localStorage.clear();
  mocks.speak.mockReset();
  mocks.items.clear();
  mocks.items.set(replyThread.threadId, [
    { visibility: "local", item: { type: "user_message", id: "user" } },
    {
      visibility: "local",
      item: {
        type: "assistant_message",
        id: "reply",
        text: "First sentence. Second sentence.\n",
        streaming: true,
        completedAt: null,
      },
    },
  ]);
}

describe("ReadAloudToggle", () => {
  it("queues a reply once when switching back to its thread", async () => {
    setup();
    await using screen = await render(<ReadAloudToggle threadRef={otherThread} />);
    await screen.rerender(<ReadAloudToggle threadRef={replyThread} />);

    expect(mocks.speak.mock.calls.map(([text]) => text)).toEqual([
      "First sentence.",
      "Second sentence.",
    ]);
  });
});
