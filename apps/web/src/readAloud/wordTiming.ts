/**
 * Word timings for one spoken clip. The timestamped Kokoro model reports a duration per phoneme
 * token; tokens group into spoken words, which are then matched to the words of the clip's text.
 * The model may say one written word as several ("GitHub" is "git hub", "1.48" is four words),
 * so the match lines them up by length rather than one to one.
 */

/** Kokoro's duration output counts frames of 600 samples at 24 kHz. */
const FRAMES_PER_SECOND = 40;
/** Start and end padding token, and the characters that separate spoken words. */
const PAD = "$";
const WORD_BREAK = /[\s;:,.!?¡¿—…"«»“”(){}[\]]/;
const STRESS = /[ˈˌ]/g;
/** One written word rarely becomes more spoken words than this. */
const MAX_SPOKEN_PER_WORD = 6;

/** The words of a clip's text; word timings and on-screen matches both index into this. */
export function splitWords(text: string): Array<string> {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

export interface WordTime {
  /** Seconds from the start of the clip. */
  readonly start: number;
  readonly end: number;
}

interface SpokenWord extends WordTime {
  /** Phoneme count, used to match spoken words to written ones. */
  readonly length: number;
}

/** Groups per-token frame durations into spoken words, scaled to the clip's real length. */
export function spokenWords(
  tokens: ReadonlyArray<string>,
  frames: ReadonlyArray<number>,
  audioSeconds: number,
): Array<SpokenWord> {
  const totalFrames = frames.reduce((sum, frame) => sum + frame, 0);
  const secondsPerFrame = totalFrames > 0 ? audioSeconds / totalFrames : 1 / FRAMES_PER_SECOND;
  const words: Array<SpokenWord> = [];
  let current: { length: number; start: number; end: number } | null = null;
  let time = 0;
  tokens.forEach((token, index) => {
    const seconds = (frames[index] ?? 0) * secondsPerFrame;
    if (token === PAD || token.length === 0 || WORD_BREAK.test(token)) {
      if (current !== null) words.push(current);
      current = null;
    } else if (current === null) {
      current = { length: token.replace(STRESS, "").length, start: time, end: time + seconds };
    } else {
      current.length += token.replace(STRESS, "").length;
      current.end = time + seconds;
    }
    time += seconds;
  });
  if (current !== null) words.push(current);
  return words;
}

/** Rough spoken length in letters. Digits are read as words ("4" is "four", "." is "point"). */
function letterCount(word: string): number {
  const letters = word.replace(/[^\p{L}]/gu, "").length;
  const digits = word.replace(/[^\p{N}]/gu, "").length;
  const points = word.match(/\p{N}\.\p{N}/gu)?.length ?? 0;
  return Math.max(1, letters + digits * 4 + points * 5);
}

/** Even-paced guess, weighted by word length, for when the model gave nothing usable. */
export function estimateWordTimes(
  textWords: ReadonlyArray<string>,
  audioSeconds: number,
): Array<WordTime> {
  const weights = textWords.map((word) => letterCount(word) + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let time = 0;
  return weights.map((weight) => {
    const start = time;
    time += (weight / total) * audioSeconds;
    return { start, end: time };
  });
}

/**
 * Gives each written word the span of the spoken words it became. Lines the two lists up so
 * that each written word's length best matches the phonemes it takes, preferring one to one.
 */
export function alignWordTimes(
  textWords: ReadonlyArray<string>,
  spoken: ReadonlyArray<SpokenWord>,
  audioSeconds: number,
): Array<WordTime> {
  const written = textWords.length;
  const said = spoken.length;
  if (written === 0) return [];
  if (said === 0 || said > written * MAX_SPOKEN_PER_WORD) {
    return estimateWordTimes(textWords, audioSeconds);
  }
  const lengths = textWords.map(letterCount);
  const phonemesPerLetter =
    spoken.reduce((sum, word) => sum + word.length, 0) / lengths.reduce((sum, n) => sum + n, 0);
  const skipCost = 2 * phonemesPerLetter * (lengths.reduce((sum, n) => sum + n, 0) / written);

  // cost[i][j]: best cost for the first i written words taking the first j spoken words.
  const cost = Array.from({ length: written + 1 }, () =>
    new Array<number>(said + 1).fill(Infinity),
  );
  const took = Array.from({ length: written + 1 }, () => new Array<number>(said + 1).fill(0));
  cost[0]![0] = 0;
  for (let i = 1; i <= written; i += 1) {
    const expected = lengths[i - 1]! * phonemesPerLetter;
    for (let j = 0; j <= said; j += 1) {
      let phonemes = 0;
      for (let take = 0; take <= Math.min(MAX_SPOKEN_PER_WORD, j); take += 1) {
        if (take > 0) phonemes += spoken[j - take]!.length;
        const before = cost[i - 1]![j - take]!;
        if (before === Infinity) continue;
        const step =
          take === 0 ? skipCost : Math.abs(expected - phonemes) + (take - 1) * phonemesPerLetter;
        if (before + step < cost[i]![j]!) {
          cost[i]![j] = before + step;
          took[i]![j] = take;
        }
      }
    }
  }
  if (cost[written]![said] === Infinity) return estimateWordTimes(textWords, audioSeconds);

  const times = new Array<WordTime>(written);
  let j = said;
  for (let i = written; i >= 1; i -= 1) {
    const take = took[i]![j]!;
    if (take === 0) {
      const at = j > 0 ? spoken[j - 1]!.end : 0;
      times[i - 1] = { start: at, end: at };
    } else {
      times[i - 1] = { start: spoken[j - take]!.start, end: spoken[j - 1]!.end };
    }
    j -= take;
  }
  return times;
}
