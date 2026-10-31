import { PlayIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";

import {
  READ_ALOUD_PREVIEW_KEY,
  previewReadAloudVoice,
  stopReadingAloud,
} from "./readAloudActions";
import { useIsReadingAloud } from "./readAloudEngine";
import { READ_ALOUD_VOICES } from "./voices";

const MIN_SPEED = 0.5;
const MAX_SPEED = 2;

export function ReadAloudVoiceSelect({ className }: { className?: string }) {
  const voice = useClientSettings((settings) => settings.readAloudVoice);
  const selected = READ_ALOUD_VOICES.find((option) => option.id === voice);
  return (
    <Select
      value={voice}
      onValueChange={(value) => {
        if (typeof value === "string") void updateClientSettings({ readAloudVoice: value });
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label="Read aloud voice">
        <SelectValue>{selected?.label ?? voice}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {READ_ALOUD_VOICES.map((option) => (
          <SelectItem hideIndicator key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Saves once the drag ends, so dragging does not write settings on every step. */
export function ReadAloudSpeedSlider({ className }: { className?: string }) {
  const speed = useClientSettings((settings) => settings.readAloudSpeed);
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? speed;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Slider
        className="flex-1"
        aria-label="Read aloud speed"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={0.1}
        value={value}
        onValueChange={(next) => {
          if (typeof next === "number") setDragging(next);
        }}
        onValueCommitted={(next) => {
          setDragging(null);
          if (typeof next === "number") {
            void updateClientSettings({ readAloudSpeed: Math.round(next * 10) / 10 });
          }
        }}
      />
      <span className="w-9 text-right text-muted-foreground text-xs tabular-nums">
        {value.toFixed(1)}×
      </span>
    </div>
  );
}

export function ReadAloudPreviewButton() {
  const previewing = useIsReadingAloud(READ_ALOUD_PREVIEW_KEY);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => (previewing ? stopReadingAloud() : previewReadAloudVoice())}
    >
      {previewing ? <SquareIcon /> : <PlayIcon />}
      {previewing ? "Stop" : "Preview"}
    </Button>
  );
}
