<script lang="ts">
  import Picker from "#lib/components/ui/Picker.svelte";
  import {
    audioTrackDetails,
    audioTrackName,
    type AudioTrack,
  } from "#lib/shared/audio-tracks.ts";

  let {
    tracks,
    value = $bindable(),
  }: {
    tracks: AudioTrack[];
    value: number;
  } = $props();
</script>

{#snippet trackLabel(track: AudioTrack)}
  {@const details = audioTrackDetails(track)}
  <span class="flex min-w-0 items-baseline gap-2.5">
    <span class="shrink-0 text-sm text-text">{audioTrackName(track)}</span>
    {#if details}
      <span class="min-w-0 truncate text-xs text-text-muted">{details}</span>
    {/if}
  </span>
{/snippet}

<Picker
  label="Audio track"
  name="audioTrack"
  options={tracks}
  key={(track) => String(track.index)}
  optionText={audioTrackName}
  bind:value={() => String(value), (key) => (value = Number(key))}
  title="Choose an audio track"
  subtitle="The transcript plays this track when you open it."
>
  {#snippet selection(track)}
    {#if track}{@render trackLabel(track)}{/if}
  {/snippet}
  {#snippet option(track)}
    {@render trackLabel(track)}
  {/snippet}
</Picker>
