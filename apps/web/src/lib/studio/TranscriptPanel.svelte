<script lang="ts">
  import Icon from "#lib/components/Icon.svelte";
  import type { CueEditor } from "#lib/editor/editor.svelte.ts";
  import {
    audioTrackName,
    transcriptAudioTrack,
  } from "#lib/shared/audio-tracks.ts";
  import { pluralize } from "#lib/shared/format.ts";
  import { languageName } from "#lib/shared/languages.ts";
  import { isRunActive } from "#lib/shared/project-status.ts";
  import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";
  import CueList from "./CueList.svelte";
  import EditorToolbar from "./EditorToolbar.svelte";
  import JournalNotice from "./JournalNotice.svelte";
  import ProcessingStatus from "./ProcessingStatus.svelte";
  import TranscribePanel, { processingNote } from "./TranscribePanel.svelte";
  import TranscriptNotices from "./TranscriptNotices.svelte";
  import TranscriptSwitcher from "./TranscriptSwitcher.svelte";
  import type { StudioData } from "#lib/shared/studio-data.ts";

  type Props = {
    editor: CueEditor;
    track: StudioData["track"];
    tracks: StudioData["tracks"];
    readyTrack: SubtitleTrackSummary | null;
    run: StudioData["run"];
    preparations: StudioData["preparations"];
    mediaPreparationStatus: StudioData["project"]["mediaPreparationStatus"];
    hasSourceMedia: boolean;
    mediaDurationUs: number | null;
    transcriptionModels: StudioData["transcriptionModels"];
    detectedHardware: StudioData["detectedHardware"];
    transcriptionDefaults: StudioData["transcriptionDefaults"];
    audioTracks: StudioData["project"]["audioTracks"];
    // The track a new transcript starts on: the one playing.
    audioTrack: number;
    oncreate: (() => void) | null;
    canDelete: boolean;
    onopentrack: (trackId: string) => void;
    ondismissready: () => void;
  };

  let {
    editor,
    track,
    tracks,
    readyTrack,
    run,
    preparations,
    mediaPreparationStatus,
    hasSourceMedia,
    mediaDurationUs,
    transcriptionModels,
    detectedHardware,
    transcriptionDefaults,
    audioTracks,
    audioTrack,
    oncreate,
    canDelete,
    onopentrack,
    ondismissready,
  }: Props = $props();

  // Named only when the file has a choice. Older transcripts do not record it.
  const sourceTrack = $derived.by(() => {
    const index = track && transcriptAudioTrack(track.metadata);
    if (audioTracks.length < 2 || index === null) return null;
    return audioTracks.find((candidate) => candidate.index === index) ?? null;
  });
  // The language is known up front only when it was chosen.
  const runLabel = $derived(
    run?.language
      ? `New ${languageName(run.language)} transcript`
      : "New transcript",
  );
  const pending = $derived(
    run && isRunActive(run)
      ? {
          label: runLabel,
          status: [
            audioTracks.length > 1 ? `Track ${run.audioTrack + 1}` : null,
            run.progressMessage ?? "Waiting for a worker",
            run.progress === null ? null : `${Math.round(run.progress * 100)}%`,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : null,
  );
  const firstPreparation = $derived(
    mediaPreparationStatus === "completed" ? null : (preparations[0] ?? null),
  );
</script>

<section
  class="flex h-[42rem] max-h-[85dvh] min-w-0 flex-col border-t border-border bg-surface lg:h-auto lg:max-h-none lg:min-h-0 lg:border-t-0 lg:border-l"
  aria-label="Subtitle cues"
>
  <header
    class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4"
  >
    {#if track}
      <!-- The switcher holds a dialog, which a heading cannot contain. -->
      <h2 class="sr-only">Transcript</h2>
      <div class="flex min-w-0">
        <TranscriptSwitcher
          {tracks}
          openTrackId={track.id}
          showAudioTrack={audioTracks.length > 1}
          {pending}
          {oncreate}
          {canDelete}
          onopen={onopentrack}
        />
      </div>
    {:else}
      <h2 class="text-sm font-semibold text-text">Transcript</h2>
    {/if}
    {#if track}
      <span
        class="shrink-0 text-xs text-text-muted"
        title={sourceTrack ? audioTrackName(sourceTrack) : undefined}
      >
        {#if sourceTrack}Track {sourceTrack.index + 1} ·{/if}
        {pluralize(editor.cues.length, "cue")}
      </span>
    {/if}
  </header>
  <!-- Announces the transcript a switch opened. -->
  <p class="sr-only" role="status">
    {track ? `${languageName(track.language)} transcript` : ""}
  </p>

  <JournalNotice autosave={editor.autosave} />
  <ProcessingStatus
    {run}
    {runLabel}
    preparation={firstPreparation}
    {mediaPreparationStatus}
  />
  <TranscriptNotices {readyTrack} onopenready={onopentrack} {ondismissready} />

  {#if track}
    <EditorToolbar {editor} />
    <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
      <CueList {editor} />
    </div>
  {:else if !isRunActive(run) && hasSourceMedia}
    <TranscribePanel
      models={transcriptionModels}
      hardware={detectedHardware}
      defaults={transcriptionDefaults}
      {mediaDurationUs}
      {audioTracks}
      {audioTrack}
    >
      {#snippet intro()}
        {@render status()}
      {/snippet}
    </TranscribePanel>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
      <div class="mx-auto grid max-w-md gap-4">
        {@render status()}
      </div>
    </div>
  {/if}
</section>

{#snippet status()}
  <div class="grid gap-1">
    <h3 class="flex items-center gap-2 text-sm font-semibold text-text">
      <span class="text-accent" aria-hidden="true">
        <Icon name="subtitles" size={16} />
      </span>
      {#if isRunActive(run)}
        Making the first transcript
      {:else if hasSourceMedia}
        Ready to transcribe
      {:else}
        No subtitle track
      {/if}
    </h3>
    {#if isRunActive(run)}
      <p class="text-sm text-text-muted">
        Its subtitles appear here when it finishes.
      </p>
    {:else if hasSourceMedia}
      <p class="text-xs text-text-muted">
        {processingNote(transcriptionModels)}
      </p>
    {:else}
      <p class="text-sm text-text-muted">
        This project does not have source media or a transcription run.
      </p>
    {/if}
  </div>
{/snippet}
