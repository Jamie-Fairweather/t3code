import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { FileSurfaceAction } from "~/components/files/fileSurfaceChrome";

import { READ_ALOUD_FILE_THREAD, readReplyAloud, stopReadingAloud } from "./readAloudActions";
import { useIsReadingAloud } from "./readAloudEngine";
import { readAloudKey } from "./readProgress";

/** Highlighting finds the rendered file by this item id, via `data-read-aloud-item`. */
export function readAloudFileItemId(environmentId: string, cwd: string, relativePath: string) {
  return JSON.stringify([environmentId, cwd, relativePath]);
}

/** Reads a markdown file aloud from the top; a stop button while it plays. */
export function ReadAloudFileButton({ itemId, text }: { itemId: string; text: string }) {
  const key = readAloudKey(READ_ALOUD_FILE_THREAD, itemId);
  const playing = useIsReadingAloud(key);
  return (
    <FileSurfaceAction
      label={playing ? "Stop reading aloud" : "Read file aloud"}
      onPress={() =>
        playing ? stopReadingAloud() : readReplyAloud(key, maskMarkdownFrontmatter(text))
      }
    >
      {playing ? <SquareIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
    </FileSurfaceAction>
  );
}
