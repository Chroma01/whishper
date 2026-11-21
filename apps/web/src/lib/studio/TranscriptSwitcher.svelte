<script lang="ts">
  import Flag from "#lib/components/Flag.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import ConfirmDialog from "#lib/components/ui/ConfirmDialog.svelte";
  import Menu from "#lib/components/ui/Menu.svelte";
  import MenuItem from "#lib/components/ui/MenuItem.svelte";
  import { languageFlag, languageName } from "#lib/shared/languages.ts";
  import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";
  import TranscriptLabel from "./TranscriptLabel.svelte";

  type Props = {
    tracks: SubtitleTrackSummary[];
    openTrackId: string;
    showAudioTrack: boolean;
    // Transcripts and translations still being made, listed after the
    // finished ones.
    pending: { key: string; label: string; status: string }[];
    // Null while a new transcript cannot be started.
    oncreate: (() => void) | null;
    ontranslate: (() => void) | null;
    canDelete: boolean;
    onopen: (trackId: string) => void;
  };

  let {
    tracks,
    openTrackId,
    showAudioTrack,
    pending,
    oncreate,
    ontranslate,
    canDelete,
    onopen,
  }: Props = $props();

  let deleteOpen = $state(false);
  const openTrack = $derived(tracks.find((track) => track.id === openTrackId));
  const openName = $derived(
    openTrack ? languageName(openTrack.language) : "Transcript",
  );
</script>

<Menu label="Transcripts">
  {#snippet trigger(args)}
    <button
      type="button"
      {...args}
      class="-mx-1.5 flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-sm font-semibold text-text hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
    >
      {#if openTrack}
        <Flag
          flag={languageFlag(openTrack.language)}
          placeholder={openTrack.language}
        />
      {/if}
      <span class="flex min-w-0 items-center gap-1">
        <span class="truncate">{openName}</span>
        <span class="sr-only">transcript</span>
        {#if pending.length > 0}
          <span
            class="size-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden="true"
          ></span>
          <span class="sr-only">, a new one is being made</span>
        {/if}
        <span class="shrink-0 text-text-muted" aria-hidden="true">
          <Icon name="chevron-down" size={14} />
        </span>
      </span>
    </button>
  {/snippet}
  {#each tracks as track (track.id)}
    <MenuItem
      role="menuitemradio"
      checked={track.id === openTrackId}
      onselect={() => onopen(track.id)}
    >
      <span class="flex max-w-80 min-w-0 flex-1">
        <TranscriptLabel {track} {showAudioTrack} />
      </span>
    </MenuItem>
  {/each}
  {#each pending as item (item.key)}
    <div
      class="flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-muted"
      role="none"
    >
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span class="grid h-4.5 w-6 shrink-0 place-items-center">
        <span
          class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        ></span>
      </span>
      <span class="grid max-w-72 min-w-0 flex-1">
        <span class="truncate font-medium text-text">{item.label}</span>
        <span class="truncate text-xs">{item.status}</span>
      </span>
    </div>
  {/each}
  {#if oncreate || ontranslate || (canDelete && openTrack)}
    <div role="separator" class="-mx-1 my-1 border-t border-border"></div>
  {/if}
  {#if oncreate}
    <MenuItem onselect={oncreate}>
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span
        class="grid h-4.5 w-6 shrink-0 place-items-center text-text-muted"
        aria-hidden="true"
      >
        <Icon name="plus" size={16} />
      </span>
      New transcript…
    </MenuItem>
  {/if}
  {#if ontranslate}
    <MenuItem onselect={ontranslate}>
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span
        class="grid h-4.5 w-6 shrink-0 place-items-center text-text-muted"
        aria-hidden="true"
      >
        <Icon name="languages" size={16} />
      </span>
      Translate…
    </MenuItem>
  {/if}
  {#if canDelete && openTrack}
    <MenuItem tone="danger" onselect={() => (deleteOpen = true)}>
      <span class="size-4 shrink-0" aria-hidden="true"></span>
      <span
        class="grid h-4.5 w-6 shrink-0 place-items-center"
        aria-hidden="true"
      >
        <Icon name="trash" size={16} />
      </span>
      Delete {openName} transcript…
    </MenuItem>
  {/if}
</Menu>

{#if canDelete && openTrack}
  <ConfirmDialog
    bind:open={deleteOpen}
    title="Delete the {openName} transcript?"
    message="Its subtitles and your edits to them are deleted. The media and any other transcripts stay."
    confirmLabel="Delete transcript"
    action="?/deleteTranscript"
    fields={{ trackId: openTrack.id }}
  />
{/if}
