import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, LoaderIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadVisibleTurnItems } from "~/state/entities";

import {
  ReadAloudPreviewButton,
  ReadAloudSpeedSlider,
  ReadAloudVoiceSelect,
} from "./ReadAloudControls";
import { setReadAloudEnabled, speakWithSettings, stopReadingAloud } from "./readAloudActions";
import { stopSpeaking, useReadAloudEpoch, useReadAloudState } from "./readAloudEngine";
import {
  HEARD_ALL,
  keepHeard,
  planThreadReads,
  readAloudKey,
  readAloudSince,
  recordHeard,
  useThreadHeard,
} from "./readProgress";
import { takeSpeakable } from "./speakableText";

/** Header controls: the speaker turns read aloud on and off, the arrow opens voice settings. */
export const ReadAloudToggle = memo(function ReadAloudToggle({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const { status, activeKey, error } = useReadAloudState();
  const speaking = activeKey !== null;
  const label = !enabled
    ? "Read replies aloud"
    : status === "error"
      ? `Read aloud failed: ${error ?? "unknown error"}`
      : speaking
        ? "Stop reading aloud"
        : status === "loading"
          ? "Loading voice…"
          : "Reading replies aloud. Click to turn off.";
  return (
    <>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant={enabled ? "ghost" : "ghost-muted"}
                aria-label={label}
                aria-pressed={enabled}
                onClick={() => {
                  if (speaking) {
                    stopReadingAloud();
                    return;
                  }
                  setReadAloudEnabled(!enabled);
                }}
              />
            }
          >
            {enabled && status === "loading" ? (
              <LoaderIcon className="animate-spin" />
            ) : enabled ? (
              <Volume2Icon className={status === "error" ? "text-destructive" : undefined} />
            ) : (
              <VolumeXIcon />
            )}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{label}</TooltipPopup>
        </Tooltip>
        <Popover>
          <PopoverTrigger
            render={
              <Button size="icon-xs" variant="ghost-muted" aria-label="Read aloud settings" />
            }
          >
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="end" width="md">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-muted-foreground text-xs">Voice</span>
                <div className="flex items-center gap-2">
                  <ReadAloudVoiceSelect className="min-w-0 flex-1" />
                  <ReadAloudPreviewButton />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-muted-foreground text-xs">Speed</span>
                <ReadAloudSpeedSlider />
              </div>
            </div>
          </PopoverPopup>
        </Popover>
      </div>
      {enabled ? <ReadAloudThread key={scopedThreadKey(threadRef)} threadRef={threadRef} /> : null}
    </>
  );
});

/** Reads the open thread's new replies; see readProgress for what counts as new. */
function ReadAloudThread({ threadRef }: { threadRef: ScopedThreadRef }) {
  const threadKey = scopedThreadKey(threadRef);
  const items = useThreadVisibleTurnItems(threadRef);
  const heard = useThreadHeard(threadKey);
  const epoch = useReadAloudEpoch();
  // Chunks handed to the engine per reply, valid until the engine's next stop.
  const queued = useRef({ epoch, counts: new Map<string, number>() });
  // Undefined until the thread's items have loaded.
  const lastUserMessageId = useRef<string | null | undefined>(undefined);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- silences the audio engine when this thread closes
  useEffect(() => () => void stopSpeaking(), []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds unheard sentences to the audio engine
  useEffect(() => {
    if (items.length === 0) return;
    const userMessageId = items.findLast(({ item }) => item.type === "user_message")?.item.id;
    const previousUserMessageId = lastUserMessageId.current;
    lastUserMessageId.current = userMessageId ?? null;
    // A new message from the user means everything above it is done with.
    if (
      previousUserMessageId !== undefined &&
      previousUserMessageId !== lastUserMessageId.current
    ) {
      stopSpeaking();
      return;
    }

    const plan = planThreadReads(items, heard, readAloudSince());
    keepHeard(threadKey, plan.current);
    if (queued.current.epoch !== epoch) queued.current = { epoch, counts: new Map() };
    const counts = queued.current.counts;
    for (const read of plan.reads) {
      const { chunks } = takeSpeakable(read.text, 0, read.final);
      const key = readAloudKey(threadKey, read.itemId);
      const doneAt = (count: number) => (read.final && count >= chunks.length ? HEARD_ALL : count);
      if (read.final && read.heard >= chunks.length) {
        recordHeard(threadKey, read.itemId, HEARD_ALL);
        continue;
      }
      for (
        let index = Math.max(read.heard, counts.get(read.itemId) ?? 0);
        index < chunks.length;
        index += 1
      ) {
        speakWithSettings(chunks[index]!, key, () =>
          recordHeard(threadKey, read.itemId, doneAt(index + 1)),
        );
      }
      counts.set(read.itemId, chunks.length);
    }
  }, [items, heard, epoch, threadKey]);

  return null;
}
