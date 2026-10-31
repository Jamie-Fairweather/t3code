import { SquareIcon, Volume2Icon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { readReplyAloud, stopReadingAloud } from "./readAloudActions";
import { useIsReadingAloud } from "./readAloudEngine";
import { readAloudKey } from "./readProgress";

/** Reads one reply aloud from the top; a stop button while that reply is playing. */
export function ReadAloudReplyButton({
  threadKey,
  itemId,
  text,
}: {
  threadKey: string;
  itemId: string;
  text: string;
}) {
  const key = readAloudKey(threadKey, itemId);
  const playing = useIsReadingAloud(key);
  const label = playing ? "Stop reading aloud" : "Read aloud";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={label}
            onClick={() => (playing ? stopReadingAloud() : readReplyAloud(key, text))}
          />
        }
      >
        {playing ? <SquareIcon className="size-3" /> : <Volume2Icon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
