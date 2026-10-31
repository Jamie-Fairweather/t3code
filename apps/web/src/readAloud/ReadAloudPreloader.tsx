import { useEffect } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";

import { setKeepLoaded } from "./readAloudEngine";
import { readAloudSince } from "./readProgress";
import { startWordHighlighting } from "./wordHighlight";

/**
 * Loads the voice when the app opens with read aloud on, and releases it when turned off.
 * Also marks the word being read, for automatic reading and a reply's read button alike.
 */
export function ReadAloudPreloader() {
  const hydrated = useClientSettingsHydrated();
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const keepLoaded = hydrated && enabled;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads or releases the voice model in its worker
  useEffect(() => {
    if (keepLoaded) readAloudSince();
    setKeepLoaded(keepLoaded);
  }, [keepLoaded]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the audio engine's spoken words for the app's lifetime
  useEffect(() => startWordHighlighting(), []);

  return null;
}
