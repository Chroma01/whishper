<script lang="ts">
  import { enhance } from "$app/forms";
  import Button from "#lib/components/ui/Button.svelte";
  import Dialog from "#lib/components/ui/Dialog.svelte";
  import {
    audioTrackDetails,
    audioTrackName,
  } from "#lib/shared/audio-tracks.ts";
  import { formatBytes, formatDuration } from "#lib/shared/format.ts";
  import type { StudioData } from "#lib/shared/studio-data.ts";
  import type { AudioTrackState } from "./project-view";

  type Props = {
    open?: boolean;
    project: StudioData["project"];
    derivatives: StudioData["derivatives"];
    // The open transcript's track, which plays and so cannot be removed.
    transcriptTrack: number | null;
    stateOf: (audioTrack: number) => AudioTrackState;
  };

  let {
    open = $bindable(false),
    project,
    derivatives,
    transcriptTrack,
    stateOf,
  }: Props = $props();

  type VideoStream = {
    type?: unknown;
    codec?: unknown;
    video?: { width?: unknown; height?: unknown; attachedPicture?: unknown };
  };

  let picture = $derived.by(() => {
    const streams = (project.mediaProbe?.streams ?? []) as VideoStream[];
    const video = streams.find(
      (stream) => stream.type === "video" && !stream.video?.attachedPicture,
    );
    if (!video?.video) return null;
    const fps =
      project.mediaFrameRateNum && project.mediaFrameRateDen
        ? `${Number((project.mediaFrameRateNum / project.mediaFrameRateDen).toFixed(3))} fps`
        : null;
    return [
      typeof video.codec === "string" ? video.codec.toUpperCase() : null,
      `${video.video.width}×${video.video.height}`,
      fps,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  let fileSummary = $derived(
    [
      project.mediaDurationUs ? formatDuration(project.mediaDurationUs) : null,
      project.sizeBytes ? formatBytes(project.sizeBytes) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  function copySize(audioTrack: number): number {
    return derivatives
      .filter(
        (derivative) =>
          derivative.kind !== "thumbnail" &&
          derivative.audioTrack === audioTrack,
      )
      .reduce((total, derivative) => total + derivative.sizeBytes, 0);
  }

  function stateText(state: AudioTrackState, audioTrack: number): string {
    switch (state.kind) {
      case "ready":
        return `Ready · ${formatBytes(copySize(audioTrack))}`;
      case "preparing":
        return state.progress === null
          ? "Preparing"
          : `Preparing · ${Math.round(state.progress * 100)}%`;
      case "failed":
        return state.message;
      case "missing":
        return "Not prepared";
    }
  }
</script>

<Dialog
  bind:open
  title={project.mediaFilename ?? "Media"}
  description={fileSummary || undefined}
>
  <div class="grid grid-cols-1 gap-5">
    {#if picture}
      <section class="grid gap-1">
        <h3 class="text-xs font-medium text-text-muted">Video</h3>
        <p class="text-sm text-text">{picture}</p>
      </section>
    {/if}
    {#if project.audioTracks.length > 0}
      <section class="grid grid-cols-1 gap-2">
        <div class="grid gap-0.5">
          <h3 class="text-xs font-medium text-text-muted">Audio tracks</h3>
          <p class="text-xs text-text-muted">
            A prepared track has a waveform and, when the browser needs one, a
            preview to play in the studio.
          </p>
        </div>
        <ul class="divide-y divide-border rounded-md border border-border">
          {#each project.audioTracks as track (track.index)}
            {@const state = stateOf(track.index)}
            <li class="flex items-center gap-3 px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-text">
                  {audioTrackName(track)}
                </p>
                <p class="truncate text-xs text-text-muted">
                  {audioTrackDetails(track)}
                </p>
                <p
                  class="text-xs {state.kind === 'failed'
                    ? 'text-danger'
                    : 'text-text-muted'}"
                >
                  {stateText(state, track.index)}
                </p>
              </div>
              {#if state.kind === "preparing"}
                {@render trackAction("?/cancelMedia", track.index, "Cancel")}
              {:else if state.kind === "ready"}
                {@render trackAction("?/prepareMedia", track.index, "Rebuild")}
                {#if project.canManage && track.index !== transcriptTrack}
                  {@render trackAction(
                    "?/removeAudioCopy",
                    track.index,
                    "Remove",
                  )}
                {/if}
              {:else}
                {@render trackAction(
                  "?/prepareMedia",
                  track.index,
                  state.kind === "failed" ? "Try again" : "Prepare",
                )}
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</Dialog>

{#snippet trackAction(action: string, audioTrack: number, label: string)}
  <form method="POST" {action} use:enhance class="shrink-0">
    <input type="hidden" name="audioTrack" value={audioTrack} />
    <Button type="submit" size="sm" variant="ghost">{label}</Button>
  </form>
{/snippet}
