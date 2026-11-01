import { getClientSettings, updateClientSettings } from "~/hooks/useSettings";

import { speak, stopSpeaking } from "./readAloudEngine";
import { HEARD_ALL, parseReadAloudKey, recordHeard, restartReadAloudSince } from "./readProgress";
import { takeSpeakable } from "./speakableText";
import { startWordsAt } from "./wordHighlight";

export const READ_ALOUD_PREVIEW_KEY = "read-aloud-preview";
const PREVIEW_TEXT = "Hi! This is how replies will sound.";

export function setReadAloudEnabled(enabled: boolean): void {
  if (enabled) restartReadAloudSince();
  void updateClientSettings({ readAloudEnabled: enabled });
}

/** The user's stop: silences speech and counts every reply it cut off as read. */
export function stopReadingAloud(): void {
  for (const key of stopSpeaking()) {
    const reply = parseReadAloudKey(key);
    if (reply !== null) recordHeard(reply.threadKey, reply.itemId, HEARD_ALL);
  }
}

/** Reads one reply from the top, replacing whatever is playing. */
export function readReplyAloud(key: string, text: string): void {
  stopSpeaking();
  for (const chunk of takeSpeakable(text, 0, true).chunks) speakWithSettings(chunk, key);
}

/** Reads just the text the user selected in a reply, replacing whatever is playing. */
export function readSelectionAloud(key: string, text: string, range: Range): void {
  stopSpeaking();
  startWordsAt(key, range);
  for (const chunk of takeSpeakable(text, 0, true).chunks) speakWithSettings(chunk, key);
}

export function previewReadAloudVoice(): void {
  stopSpeaking();
  speakWithSettings(PREVIEW_TEXT, READ_ALOUD_PREVIEW_KEY);
}

export function speakWithSettings(text: string, key: string, onHeard?: () => void): void {
  const { readAloudVoice, readAloudSpeed } = getClientSettings();
  speak(text, {
    voice: readAloudVoice,
    speed: readAloudSpeed,
    key,
    ...(onHeard ? { onHeard } : {}),
  });
}
