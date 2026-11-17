<script lang="ts">
  import { tick } from "svelte";
  import Button from "#lib/components/ui/Button.svelte";
  import IconButton from "#lib/components/ui/IconButton.svelte";
  import Input from "#lib/components/ui/Input.svelte";
  import { isApplePlatform } from "#lib/browser/platform.ts";
  import type { CueFinder } from "#lib/editor/finder.svelte.ts";
  import type { FindOptions } from "#lib/editor/find.ts";
  import { pluralize } from "#lib/shared/format.ts";

  let { finder }: { finder: CueFinder } = $props();

  let findInput = $state<HTMLInputElement>();
  let replaceInput = $state<HTMLInputElement>();
  let returnFocus: HTMLElement | null = null;
  let announcement = $state("");

  const apple = isApplePlatform();
  const REPLACE_ALL_KEYS = apple ? "Command+Option+Enter" : "Ctrl+Alt+Enter";

  let count = $derived(finder.matches.length);
  let position = $derived.by(() => {
    if (finder.result.error) return finder.result.error;
    if (!finder.query) return "";
    if (count === 0) return "No results";
    return `${finder.currentIndex + 1} of ${count}`;
  });

  // Opening again focuses the box and selects what is in it, as in a browser.
  // Closing returns focus to where it was before the bar opened.
  export async function focus(
    replace: boolean,
    returnTo: HTMLElement | null,
  ): Promise<void> {
    if (returnTo) returnFocus = returnTo;
    if (replace) finder.replacing = true;
    await tick();
    const target = replace ? replaceInput : findInput;
    target?.focus();
    target?.select();
  }

  // Without a remembered place, such as after a search link opened the bar,
  // focus goes to the selected cue's text.
  function close() {
    finder.close();
    const target = returnFocus?.isConnected
      ? returnFocus
      : document.querySelector<HTMLElement>("[data-selected-cue] textarea");
    returnFocus = null;
    target?.focus();
  }

  function search() {
    finder.startFromSelection();
    finder.selectCurrent();
  }

  function toggle(option: keyof FindOptions) {
    finder.options = { ...finder.options, [option]: !finder.options[option] };
    search();
  }

  const OPTION_KEYS: Record<string, keyof FindOptions> = {
    KeyC: "matchCase",
    KeyW: "wholeWord",
    KeyR: "regex",
  };

  // Alt with a letter types an accented character on a Mac, so the physical
  // key is read rather than the character.
  function handleBarKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const option = OPTION_KEYS[event.code];
    if (option && event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      toggle(option);
    }
  }

  function handleFindKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) finder.previous();
    else finder.next();
  }

  function replaceAll() {
    const replaced = finder.replaceAll();
    announcement = `Replaced ${pluralize(replaced, "match")}. ${apple ? "Command" : "Ctrl"}+Z undoes it.`;
  }

  function handleReplaceKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.altKey && (event.ctrlKey || event.metaKey)) replaceAll();
    else finder.replaceCurrent();
  }

  const OPTION_BUTTONS: {
    option: keyof FindOptions;
    label: string;
    text: string;
    key: string;
  }[] = [
    { option: "matchCase", label: "Match case", text: "Aa", key: "C" },
    { option: "wholeWord", label: "Whole word", text: "ab", key: "W" },
    { option: "regex", label: "Regular expression", text: ".*", key: "R" },
  ];
</script>

<!-- Escape and the option keys work from any control in the bar. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="search"
  aria-label="Find in transcript"
  class="grid gap-1.5 border-b border-border bg-surface px-2 py-2"
  onkeydown={handleBarKeydown}
>
  <div class="flex items-center gap-1">
    <IconButton
      size="sm"
      icon={finder.replacing ? "chevron-down" : "chevron-right"}
      label={finder.replacing ? "Hide replace" : "Show replace"}
      aria-expanded={finder.replacing}
      onclick={() => (finder.replacing = !finder.replacing)}
    />
    <div class="relative min-w-0 flex-1">
      <Input
        bind:ref={findInput}
        bind:value={finder.query}
        oninput={search}
        onkeydown={handleFindKeydown}
        aria-label="Find"
        aria-invalid={finder.result.error !== null}
        aria-describedby="find-position"
        placeholder="Find"
        spellcheck="false"
        autocomplete="off"
        class="h-8 pr-24 text-sm"
      />
      <span
        id="find-position"
        class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs whitespace-nowrap tabular-nums {finder
          .result.error
          ? 'text-danger'
          : 'text-text-muted'}"
        aria-live="polite"
      >
        {position}
      </span>
    </div>
    <div class="flex shrink-0 items-center" role="group" aria-label="Options">
      {#each OPTION_BUTTONS as button (button.option)}
        <button
          type="button"
          aria-pressed={finder.options[button.option]}
          aria-keyshortcuts="Alt+{button.key}"
          title="{button.label} ({apple ? 'Option' : 'Alt'}+{button.key})"
          onclick={() => toggle(button.option)}
          class="grid h-8 min-w-8 place-items-center rounded-sm px-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-focus {finder
            .options[button.option]
            ? 'bg-accent-soft text-accent'
            : 'text-text-muted hover:bg-surface-sunken hover:text-text'}"
        >
          <span aria-hidden="true">{button.text}</span>
          <span class="sr-only">{button.label}</span>
        </button>
      {/each}
    </div>
    <IconButton
      size="sm"
      icon="chevron-up"
      label="Previous match"
      shortcut="Shift+Enter"
      disabled={count === 0}
      onclick={() => finder.previous()}
    />
    <IconButton
      size="sm"
      icon="chevron-down"
      label="Next match"
      shortcut="Enter"
      disabled={count === 0}
      onclick={() => finder.next()}
    />
    <IconButton
      size="sm"
      icon="close"
      label="Close find"
      shortcut="Escape"
      onclick={close}
    />
  </div>
  {#if finder.replacing}
    <div class="flex flex-wrap items-center gap-1 pl-9">
      <Input
        bind:ref={replaceInput}
        bind:value={finder.replacement}
        onkeydown={handleReplaceKeydown}
        aria-label="Replace with"
        aria-keyshortcuts={REPLACE_ALL_KEYS.replaceAll("Command", "Meta")}
        placeholder="Replace with"
        spellcheck="false"
        autocomplete="off"
        class="h-8 min-w-0 flex-1 basis-40 text-sm"
      />
      <Button
        size="sm"
        disabled={!finder.current}
        onclick={() => finder.replaceCurrent()}
      >
        Replace
      </Button>
      <Button
        size="sm"
        disabled={count === 0}
        title="Replace all ({REPLACE_ALL_KEYS})"
        onclick={replaceAll}
      >
        Replace all{count > 0 ? ` ${count}` : ""}
      </Button>
    </div>
  {/if}
  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>
