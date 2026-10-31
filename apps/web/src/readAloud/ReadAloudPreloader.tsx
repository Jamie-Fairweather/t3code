import { useEffect } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";

import { setKeepLoaded } from "./readAloudEngine";
import { readAloudSince } from "./readProgress";

/** Loads the voice when the app opens with read aloud on, and releases it when turned off. */
export function ReadAloudPreloader() {
  const hydrated = useClientSettingsHydrated();
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const keepLoaded = hydrated && enabled;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads or releases the voice model in its worker
  useEffect(() => {
    if (keepLoaded) readAloudSince();
    setKeepLoaded(keepLoaded);
  }, [keepLoaded]);

  return null;
}
