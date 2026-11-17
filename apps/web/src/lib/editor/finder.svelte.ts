import type { CueEditor } from "./editor.svelte";
import {
  findMatches,
  replaceInText,
  type FindMatch,
  type FindOptions,
  type FindResult,
} from "./find";

export class CueFinder {
  readonly #editor: CueEditor;
  open = $state(false);
  replacing = $state(false);
  query = $state("");
  replacement = $state("");
  options = $state<FindOptions>({
    matchCase: false,
    wholeWord: false,
    regex: false,
  });
  #currentIndex = $state(0);

  result: FindResult;
  matches: FindMatch[];
  currentIndex: number;
  current: FindMatch | null;

  constructor(editor: CueEditor) {
    this.#editor = editor;
    this.result = $derived(
      this.open
        ? findMatches(this.#editor.cues, this.query, this.options)
        : { matches: [], error: null },
    );
    this.matches = $derived(this.result.matches);
    this.currentIndex = $derived(
      this.matches.length === 0
        ? -1
        : Math.min(this.#currentIndex, this.matches.length - 1),
    );
    this.current = $derived(this.matches[this.currentIndex] ?? null);
  }

  show(query?: string): void {
    if (query !== undefined) this.query = query;
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.replacing = false;
  }

  // A new query starts from the selected cue rather than the top.
  startFromSelection(): void {
    this.#startAfter(this.#editor.selectedCueIndex, 0);
  }

  // Moves to the first match at or after this place, or the first of all.
  #startAfter(cueIndex: number, offset: number): void {
    const order = new Map(
      this.#editor.cues.map((cue, index) => [cue.id, index]),
    );
    const index = this.matches.findIndex((match) => {
      const matchCue = order.get(match.cueId) ?? 0;
      return (
        matchCue > cueIndex || (matchCue === cueIndex && match.start >= offset)
      );
    });
    this.#currentIndex = Math.max(0, index);
  }

  startAtCue(cueId: string): void {
    const index = this.matches.findIndex((match) => match.cueId === cueId);
    this.#currentIndex = Math.max(0, index);
  }

  next(): void {
    this.#move(1);
  }

  previous(): void {
    this.#move(-1);
  }

  #move(step: 1 | -1): void {
    const count = this.matches.length;
    if (count === 0) return;
    this.#currentIndex = (this.currentIndex + step + count) % count;
    this.reveal();
  }

  // Selects the match's cue, which scrolls it into view, as the query is
  // typed. Moving the playhead waits for reveal().
  selectCurrent(): void {
    const match = this.current;
    if (match) this.#editor.select(match.cueId);
  }

  // Selects the match's cue and moves the playhead there, without starting
  // or stopping playback.
  reveal(): void {
    const match = this.current;
    if (!match) return;
    const cue = this.#editor.cues.find(
      (candidate) => candidate.id === match.cueId,
    );
    if (!cue) return;
    this.#editor.select(cue.id);
    this.#editor.transport.seekTo(cue.start_us);
  }

  replaceCurrent(): void {
    const match = this.current;
    if (!match) return;
    const cueIndex = this.#editor.cues.findIndex(
      (candidate) => candidate.id === match.cueId,
    );
    const cue = this.#editor.cues[cueIndex];
    if (!cue) return;
    const text = replaceInText(
      cue.text,
      [match],
      this.query,
      this.replacement,
      this.options,
    );
    this.#editor.replaceTexts(new Map([[cue.id, text]]));
    // Continues after the new text, which may itself contain the query.
    const replacedLength =
      match.end - match.start + text.length - cue.text.length;
    this.#startAfter(cueIndex, match.start + replacedLength);
    this.reveal();
  }

  replaceAll(): number {
    const byCue = new Map<string, FindMatch[]>();
    for (const match of this.matches) {
      byCue.set(match.cueId, [...(byCue.get(match.cueId) ?? []), match]);
    }
    const texts = new Map<string, string>();
    for (const cue of this.#editor.cues) {
      const matches = byCue.get(cue.id);
      if (!matches) continue;
      texts.set(
        cue.id,
        replaceInText(
          cue.text,
          matches,
          this.query,
          this.replacement,
          this.options,
        ),
      );
    }
    const count = this.matches.length;
    this.#editor.replaceTexts(texts);
    return count;
  }
}
