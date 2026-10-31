import type { ReadAloudWordColor, ReadAloudWordStyle } from "@t3tools/contracts";
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
import { Switch } from "~/components/ui/switch";
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

const WORD_STYLES: ReadonlyArray<{ readonly id: ReadAloudWordStyle; readonly label: string }> = [
  { id: "underline", label: "Underline" },
  { id: "highlight", label: "Highlight" },
  { id: "both", label: "Both" },
];

const WORD_COLORS: ReadonlyArray<{ readonly id: ReadAloudWordColor; readonly label: string }> = [
  { id: "accent", label: "Accent" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "pink", label: "Pink" },
];

export function ReadAloudWordSwitch() {
  const enabled = useClientSettings((settings) => settings.readAloudWordHighlight);
  return (
    <Switch
      checked={enabled}
      onCheckedChange={(checked) =>
        void updateClientSettings({ readAloudWordHighlight: Boolean(checked) })
      }
      aria-label="Show the current word"
    />
  );
}

export function ReadAloudWordStyleSelect({ className }: { className?: string }) {
  const style = useClientSettings((settings) => settings.readAloudWordStyle);
  const enabled = useClientSettings((settings) => settings.readAloudWordHighlight);
  return (
    <Select
      value={style}
      disabled={!enabled}
      onValueChange={(value) => {
        const next = WORD_STYLES.find((option) => option.id === value);
        if (next) void updateClientSettings({ readAloudWordStyle: next.id });
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label="Current word style">
        <SelectValue>{WORD_STYLES.find((option) => option.id === style)?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {WORD_STYLES.map((option) => (
          <SelectItem hideIndicator key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function ReadAloudWordColorSelect({ className }: { className?: string }) {
  const color = useClientSettings((settings) => settings.readAloudWordColor);
  const enabled = useClientSettings((settings) => settings.readAloudWordHighlight);
  return (
    <Select
      value={color}
      disabled={!enabled}
      onValueChange={(value) => {
        const next = WORD_COLORS.find((option) => option.id === value);
        if (next) void updateClientSettings({ readAloudWordColor: next.id });
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label="Current word colour">
        <SelectValue>{WORD_COLORS.find((option) => option.id === color)?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {WORD_COLORS.map((option) => (
          <SelectItem hideIndicator key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
