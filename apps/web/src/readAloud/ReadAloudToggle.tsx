import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { LoaderIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useThreadVisibleTurnItems } from "~/state/entities";

import { shutdownReadAloud, speak, stopSpeaking, useReadAloudState } from "./readAloudEngine";
import { takeSpeakable } from "./speakableText";

/** Header button that turns read aloud on and off, and reads the open thread while on. */
export const ReadAloudToggle = memo(function ReadAloudToggle({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const { status, speaking, error } = useReadAloudState();
  const label = !enabled
    ? "Read replies aloud"
    : status === "error"
      ? `Read aloud failed: ${error ?? "unknown error"}`
      : status === "loading"
        ? "Loading voice…"
        : speaking
          ? "Stop reading aloud"
          : "Reading replies aloud. Click to turn off.";
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant={enabled ? "ghost" : "ghost-muted"}
              aria-label={label}
              aria-pressed={enabled}
              onClick={() => {
                if (enabled && speaking) {
                  stopSpeaking();
                  return;
                }
                if (enabled) shutdownReadAloud();
                void updateClientSettings({ readAloudEnabled: !enabled });
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
      {enabled ? <ReadAloudThread key={scopedThreadKey(threadRef)} threadRef={threadRef} /> : null}
    </>
  );
});

/** Reads assistant messages that arrive while mounted. Messages already finished are skipped. */
function ReadAloudThread({ threadRef }: { threadRef: ScopedThreadRef }) {
  const items = useThreadVisibleTurnItems(threadRef);
  const voice = useClientSettings((settings) => settings.readAloudVoice);
  // Raw-text offset already read, per assistant item. `null` means finished.
  const progress = useRef<Map<string, number | null> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- silences the audio engine when this thread closes
  useEffect(() => () => stopSpeaking(), []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds newly streamed sentences to the audio engine
  useEffect(() => {
    const seen = progress.current;
    if (seen === null) {
      const initial = new Map<string, number | null>();
      for (const { item } of items) {
        if (item.type === "assistant_message" && !item.streaming) initial.set(item.id, null);
      }
      progress.current = initial;
    }
    const read = progress.current!;
    // New messages land at the end, so walk back until reaching one already finished.
    const pendingItems = [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const visible = items[index]!;
      const { item } = visible;
      if (item.type !== "assistant_message" || visible.visibility !== "local") continue;
      if (read.get(item.id) === null) break;
      pendingItems.push(item);
    }
    for (const item of pendingItems.reverse()) {
      const { chunks, consumedTo } = takeSpeakable(
        item.text,
        read.get(item.id) ?? 0,
        !item.streaming,
      );
      for (const chunk of chunks) speak(chunk, voice);
      read.set(item.id, item.streaming ? consumedTo : null);
    }
  }, [items, voice]);

  return null;
}
