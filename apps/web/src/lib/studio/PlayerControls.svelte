<script lang="ts">
  import type { Snippet } from "svelte";
  import IconButton from "#lib/components/ui/IconButton.svelte";
  import Menu from "#lib/components/ui/Menu.svelte";
  import MenuItem from "#lib/components/ui/MenuItem.svelte";
  import type { Transport } from "#lib/editor/transport.svelte.ts";
  import { formatEditorTime } from "#lib/shared/subtitles.ts";

  type Props = {
    transport: Transport;
    volume: number;
    muted: boolean;
    // Null for audio, which has no picture to fill the screen with.
    fullscreen: { active: boolean; toggle: () => void } | null;
    audioMenu?: Snippet;
  };

  let {
    transport,
    volume = $bindable(),
    muted = $bindable(),
    fullscreen,
    audioMenu,
  }: Props = $props();

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  let noMedia = $derived(!transport.mediaElement);
  let silent = $derived(muted || volume === 0);

  function speedLabel(speed: number): string {
    return `${speed}×`;
  }
</script>

<!-- Sized by its own width, which a resized pane changes as much as the window does. -->
<div
  class="@container flex h-12 shrink-0 items-center gap-2 border-t border-border px-3"
>
  <span
    class="min-w-0 flex-1 truncate font-mono text-sm text-text tabular-nums"
  >
    <span class="sr-only">Playback time</span>
    {formatEditorTime(transport.playbackUs)}
    <span class="text-text-muted @max-2xl:hidden">
      / {formatEditorTime(transport.sourceDurationUs)}
    </span>
  </span>
  <div
    class="flex shrink-0 items-center gap-0.5"
    role="group"
    aria-label="Transport"
  >
    <IconButton
      label="Previous cue"
      icon="skip-back"
      size="sm"
      disabled={noMedia}
      onclick={() => transport.jumpToCueStart(-1)}
    />
    <IconButton
      label="Back one frame"
      icon="chevron-left"
      size="sm"
      disabled={noMedia}
      onclick={() => transport.stepFrames(-1, 1)}
    />
    <IconButton
      label={transport.playing ? "Pause" : "Play"}
      icon={transport.playing ? "pause" : "play"}
      variant="secondary"
      disabled={noMedia}
      onclick={() => transport.togglePlayback()}
    />
    <IconButton
      label="Forward one frame"
      icon="chevron-right"
      size="sm"
      disabled={noMedia}
      onclick={() => transport.stepFrames(1, 1)}
    />
    <IconButton
      label="Next cue"
      icon="skip-forward"
      size="sm"
      disabled={noMedia}
      onclick={() => transport.jumpToCueStart(1)}
    />
  </div>
  <div class="flex min-w-0 flex-1 items-center justify-end gap-0.5">
    {@render audioMenu?.()}
    <Menu label="Playback speed" align="end">
      {#snippet trigger(args)}
        <button
          type="button"
          {...args}
          aria-label="Playback speed, {speedLabel(transport.playbackSpeed)}"
          title="Playback speed"
          disabled={noMedia}
          class="rounded-sm px-2 py-1.5 font-mono text-xs text-text tabular-nums hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 @max-md:hidden"
        >
          {speedLabel(transport.playbackSpeed)}
        </button>
      {/snippet}
      {#each SPEEDS as speed (speed)}
        <MenuItem
          role="menuitemradio"
          checked={speed === transport.playbackSpeed}
          onselect={() => transport.setPlaybackSpeed(speed)}
        >
          {speedLabel(speed)}
        </MenuItem>
      {/each}
    </Menu>
    <IconButton
      label={silent ? "Unmute" : "Mute"}
      icon={silent ? "mute" : "audio"}
      size="sm"
      class="shrink-0 @max-md:hidden"
      disabled={noMedia}
      onclick={() => {
        if (silent && volume === 0) volume = 1;
        muted = !silent;
      }}
    />
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      aria-label="Volume"
      disabled={noMedia}
      value={muted ? 0 : volume}
      oninput={(event) => {
        volume = Number(event.currentTarget.value);
        muted = volume === 0;
      }}
      class="w-20 shrink-0 accent-accent @max-2xl:hidden"
    />
    {#if fullscreen}
      <IconButton
        label={fullscreen.active ? "Exit full screen" : "Full screen"}
        icon={fullscreen.active ? "compress" : "expand"}
        size="sm"
        class="shrink-0"
        disabled={noMedia}
        onclick={fullscreen.toggle}
      />
    {/if}
  </div>
</div>
