<script lang="ts">
  import Flag from "#lib/components/Flag.svelte";
  import IconButton from "#lib/components/ui/IconButton.svelte";
  import Picker from "#lib/components/ui/Picker.svelte";
  import {
    LANGUAGES,
    languageFlag,
    languageName,
    matchesLanguage,
    type Language,
  } from "#lib/shared/languages.ts";

  type Props = {
    // The languages chosen so far, in the order they were added.
    value: string[];
    // Languages that cannot be chosen, such as the transcript's own.
    excluded: string[];
    // Languages the transcript already has an up-to-date translation in.
    translated: string[];
    max: number;
  };

  let { value = $bindable(), excluded, translated, max }: Props = $props();

  let adding = $state("");
  const options = $derived(
    LANGUAGES.filter(
      (language) =>
        !excluded.includes(language.code) && !value.includes(language.code),
    ),
  );
  const translatedAgain = $derived(
    new Intl.ListFormat("en-GB").format(
      value.filter((code) => translated.includes(code)).map(languageName),
    ),
  );

  function add(code: string): void {
    if (!value.includes(code) && value.length < max) value = [...value, code];
    adding = "";
  }

  function remove(code: string): void {
    value = value.filter((chosen) => chosen !== code);
  }

  function groupOf(language: Language): string {
    return language.common ? "Common" : "Other languages";
  }
</script>

{#snippet languageLabel(language: Language)}
  <span class="flex min-w-0 flex-1 items-center gap-2.5">
    <Flag flag={language.flag} placeholder={language.code} />
    <span class="min-w-0 truncate text-sm text-text">{language.name}</span>
    {#if language.nativeName && language.nativeName !== language.name}
      <span class="min-w-0 truncate text-xs text-text-muted" dir="auto">
        {language.nativeName}
      </span>
    {/if}
    {#if translated.includes(language.code)}
      <span class="ml-auto shrink-0 text-xs text-text-muted">
        Already translated
      </span>
    {/if}
  </span>
{/snippet}

{#snippet chosen()}
  {#if value.length > 0}
    <ul class="mt-1 flex flex-wrap gap-1.5" aria-label="Chosen languages">
      {#each value as code (code)}
        <li
          class="flex items-center gap-1.5 rounded-md border border-border bg-surface-sunken py-0.5 pr-0.5 pl-2 text-sm text-text"
        >
          <Flag flag={languageFlag(code)} placeholder={code} />
          {languageName(code)}
          <input type="hidden" name="targetLanguage" value={code} />
          <IconButton
            label="Remove {languageName(code)}"
            icon="close"
            size="sm"
            onclick={() => remove(code)}
          />
        </li>
      {/each}
    </ul>
  {/if}
  {#if translatedAgain}
    <p class="text-xs text-text-muted">
      Already translated into {translatedAgain}. Translating again makes another
      copy.
    </p>
  {/if}
{/snippet}

{#if value.length < max}
  <Picker
    label="Translate into"
    name=""
    {options}
    key={(language) => language.code}
    bind:value={adding}
    onpick={add}
    title="Choose a language"
    subtitle="Up to {max} at a time."
    searchLabel="Search languages"
    matches={matchesLanguage}
    group={groupOf}
  >
    {#snippet selection()}
      <span class="text-sm text-text-muted">
        {value.length ? "Add another language" : "Choose a language"}
      </span>
    {/snippet}
    {#snippet option(language)}
      {@render languageLabel(language)}
    {/snippet}
    {@render chosen()}
  </Picker>
{:else}
  <div class="grid gap-1.5">
    <span class="text-sm font-medium text-text">Translate into</span>
    {@render chosen()}
    <p class="text-xs text-text-muted">{max} languages is the most at once.</p>
  </div>
{/if}
