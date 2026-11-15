<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { applyAction, deserialize } from "$app/forms";
  import {
    beforeNavigate,
    goto,
    invalidateAll,
    refreshAll,
  } from "$app/navigation";
  import { pollWhileActive } from "#lib/browser/polling.svelte.ts";
  import { discardDeletedTrackJournals } from "#lib/editor/autosave.svelte.ts";
  import { CueEditor } from "#lib/editor/editor.svelte.ts";
  import { PaneWidth } from "#lib/editor/pane-width.svelte.ts";
  import {
    handleStudioKeydown,
    type StudioCommands,
  } from "#lib/editor/shortcuts.ts";
  import { frameDurationUs } from "#lib/editor/transport.svelte.ts";
  import { transcriptAudioTrack } from "#lib/shared/audio-tracks.ts";
  import { DEFAULT_MAX_LINE_LENGTH } from "#lib/shared/limits.ts";
  import { isRunActive, isStudioActive } from "#lib/shared/project-status.ts";
  import { projectPageUrl, projectStatusUrl } from "#lib/shared/routes.ts";
  import { maxCueEndUs } from "#lib/shared/source-duration.ts";
  import type { StudioData, StudioStatus } from "#lib/shared/studio-data.ts";
  import AudioTrackMenu from "#lib/studio/AudioTrackMenu.svelte";
  import MediaDialog from "#lib/studio/MediaDialog.svelte";
  import MediaMonitor from "#lib/studio/MediaMonitor.svelte";
  import {
    audioTrackState,
    derivativeUrl,
    editorCues,
    finishedRun,
    playableAudioTrack,
    preparedAudioTracks,
    processingStateChanged,
    unopenedTranscript,
  } from "#lib/studio/project-view.ts";
  import ShortcutGuide from "#lib/studio/ShortcutGuide.svelte";
  import StudioTitlebar from "#lib/studio/StudioTitlebar.svelte";
  import TranscribeDialog from "#lib/studio/TranscribeDialog.svelte";
  import TranscriptPanel from "#lib/studio/TranscriptPanel.svelte";
  import Timeline from "#lib/timeline/Timeline.svelte";

  let { data, form } = $props();

  // A poll applies only to the page data it was taken against, so a full
  // reload replaces it.
  let polled = $state.raw<{ loaded: StudioData; status: StudioStatus }>();
  let status: StudioStatus = $derived(
    polled?.loaded === data
      ? polled.status
      : { run: data.run, preparations: data.preparations },
  );

  // A transcript plays the audio it came from, unless the player picks
  // another track while it is open.
  let openTrackId = $derived(data.track?.id ?? null);
  let transcriptTrack = $derived(
    data.track ? (transcriptAudioTrack(data.track.metadata) ?? 0) : null,
  );
  let chosenAudio = $state<{
    projectId: string;
    trackId: string | null;
    audioTrack: number;
  }>();
  let wantedAudioTrack = $derived(
    chosenAudio?.projectId === data.project.id &&
      chosenAudio.trackId === openTrackId
      ? chosenAudio.audioTrack
      : (transcriptTrack ?? 0),
  );
  let preparedTracks = $derived(preparedAudioTracks(data.derivatives));
  let heard = { projectId: "", audioTrack: 0 };
  let playingAudioTrack = $derived.by(() => {
    const current = heard.projectId === data.project.id ? heard.audioTrack : 0;
    const audioTrack = playableAudioTrack(
      wantedAudioTrack,
      current,
      preparedTracks,
    );
    heard = { projectId: data.project.id, audioTrack };
    return audioTrack;
  });

  function audioStateOf(audioTrack: number) {
    return audioTrackState(audioTrack, preparedTracks, status.preparations);
  }

  async function prepareAudioTrack(audioTrack: number): Promise<void> {
    const body = new FormData();
    body.set("audioTrack", String(audioTrack));
    const response = await fetch("?/prepareMedia", {
      method: "POST",
      body,
      headers: { "x-sveltekit-action": "true" },
    });
    const result = deserialize(await response.text());
    // Refreshing in place keeps focus and scroll, where following the
    // action's redirect would navigate.
    if (result.type === "redirect" || result.type === "success") {
      await invalidateAll();
    } else {
      await applyAction(result);
    }
  }

  function chooseAudioTrack(audioTrack: number): void {
    chosenAudio = {
      projectId: data.project.id,
      trackId: openTrackId,
      audioTrack,
    };
    const { kind } = audioStateOf(audioTrack);
    if (kind === "missing" || kind === "failed") {
      void prepareAudioTrack(audioTrack);
    }
  }

  // An open transcript whose track has no waveform yet, such as one made
  // before each track kept its own, gets it prepared once per visit. A failed
  // preparation waits for the player's menu.
  const requestedTracks = new Set<string>();
  $effect(() => {
    if (
      transcriptTrack === null ||
      data.project.mediaPreparationStatus !== "completed" ||
      transcriptTrack >= data.project.audioTracks.length ||
      audioStateOf(transcriptTrack).kind !== "missing"
    ) {
      return;
    }
    const key = `${data.project.id}:${transcriptTrack}`;
    if (requestedTracks.has(key)) return;
    requestedTracks.add(key);
    void prepareAudioTrack(transcriptTrack);
  });

  // A run that finished while this page was open, so its transcript can be
  // offered without taking over the one being edited.
  let readyRunId = $state<string | null>(null);
  let readyTrack = $derived(
    unopenedTranscript(data.tracks, data.track?.id, readyRunId),
  );

  pollWhileActive(() => isStudioActive(status), 1_500, refreshStatus);

  async function refreshStatus(): Promise<void> {
    const loaded = data;
    let response: Response;
    try {
      response = await fetch(projectStatusUrl(loaded.project.id), {
        cache: "no-store",
      });
    } catch {
      return; // Offline for now: the next poll tries again.
    }
    if (!response.ok) return refreshAll();
    const next: StudioStatus = await response.json();
    if (data !== loaded) return;
    if (processingStateChanged(status, next)) {
      readyRunId = finishedRun(status, next) ?? readyRunId;
      return refreshAll();
    }
    polled = { loaded, status: next };
  }

  let shortcutGuideOpen = $state(false);
  let transcribeDialogOpen = $state(false);
  let mediaDialogOpen = $state(false);
  let hasTrackAndMedia = $derived(
    data.track !== null && data.project.hasSourceMedia,
  );
  let canCreateTranscript = $derived(
    hasTrackAndMedia && !isRunActive(status.run),
  );
  let maxLineLength = $derived(
    Number(data.track?.metadata?.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH),
  );

  const paneWidth = new PaneWidth();
  const editor = new CueEditor({
    cues: untrack(() => editorCues(data.cues)),
    maxLineLength: () => maxLineLength,
    transport: {
      frameDurationUs: () =>
        frameDurationUs(
          data.project.mediaFrameRateNum,
          data.project.mediaFrameRateDen,
        ),
      maxCueEndUs: () =>
        maxCueEndUs(
          data.project.mediaDurationUs,
          data.track?.metadata?.durationUs,
        ),
    },
  });
  const commands: StudioCommands = {
    transport: editor.transport,
    isDialogOpen: () =>
      shortcutGuideOpen || transcribeDialogOpen || mediaDialogOpen,
    openGuide: () => (shortcutGuideOpen = true),
    canSave: () => data.track !== null,
    save: () => void editor.autosave.flush(),
    canUndo: () => editor.canUndo,
    undo: () => editor.undo(),
    canRedo: () => editor.canRedo,
    redo: () => editor.redo(),
    hasSelection: () => editor.hasSelection,
    splitSelected: () => editor.splitSelected(),
    deleteSelected: () => editor.deleteSelected(),
    setSelectedTimeToPlayhead: (field) =>
      editor.setTimeToPlayhead(editor.selectedCueIndex, field),
  };

  async function saveBeforeTranscribing(): Promise<string | null> {
    await editor.autosave.flush();
    return editor.autosave.hasUnsavedChanges
      ? "Your latest edits could not be saved, so the transcription did not start. Try again once they are saved."
      : null;
  }

  // Both saves settle first, so neither transcript loads a copy that a save
  // still on its way is about to replace.
  async function openTrack(trackId: string): Promise<void> {
    readyRunId = null;
    if (trackId === data.track?.id) return;
    await editor.autosave.flush();
    await editor.leftSave(trackId);
    await goto(projectPageUrl(data.project.id, trackId), { reset: false });
  }

  function onStudioKeydown(event: KeyboardEvent): void {
    handleStudioKeydown(event, commands);
  }

  // SvelteKit reuses this component across projects, so a changed or
  // missing track must replace the editor state rather than be skipped.
  $effect(() => {
    const track = data.track;
    const trackRef = track
      ? { projectId: data.project.id, trackId: track.id }
      : null;
    untrack(() =>
      editor.loadTrack(
        trackRef,
        editorCues(data.cues),
        Number(track?.revision ?? 0),
      ),
    );
  });

  $effect(() => {
    discardDeletedTrackJournals(
      data.project.id,
      data.tracks.map((track) => track.id),
    );
  });

  // The dialog unmounts without closing when its track or media goes away.
  $effect(() => {
    if (!hasTrackAndMedia) transcribeDialogOpen = false;
  });

  beforeNavigate((navigation) => {
    if (navigation.shallow && navigation.type === "goto") return;

    const canSave = editor.autosave.leave();
    if (navigation.willUnload) {
      if (editor.autosave.hasUnsavedChanges) navigation.cancel();
      return;
    }
    if (
      !canSave &&
      !window.confirm(
        "Your latest edits could not be saved. They stay in this browser until you return. Leave anyway?",
      )
    ) {
      navigation.cancel();
    }
  });

  onMount(() => {
    paneWidth.restore();
    return () => {
      editor.autosave.dispose();
      paneWidth.dispose();
      editor.transport.resetShuttleRate();
    };
  });
</script>

<svelte:head><title>{data.project.name} · Anysub</title></svelte:head>
<svelte:window onkeydown={onStudioKeydown} />

<div
  class="flex min-h-dvh flex-col bg-bg text-text lg:h-dvh lg:overflow-hidden"
>
  <StudioTitlebar
    project={data.project}
    track={data.track}
    autosave={editor.autosave}
    {canCreateTranscript}
    oncreatetranscript={() => (transcribeDialogOpen = true)}
    onopenshortcuts={() => (shortcutGuideOpen = true)}
    onopenmedia={() => (mediaDialogOpen = true)}
  />

  {#if form?.message}
    <div
      class="shrink-0 border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger"
      role="alert"
    >
      {form.message}
    </div>
  {/if}

  <div
    class="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(24rem,1fr)_auto_minmax(0,var(--transcript-pane-width))]"
    style:--transcript-pane-width={`${paneWidth.value}px`}
  >
    <MediaMonitor
      project={data.project}
      derivatives={data.derivatives}
      audioTrack={playingAudioTrack}
      {editor}
    >
      {#snippet audioMenu()}
        {#if data.project.audioTracks.length > 1}
          <AudioTrackMenu
            audioTracks={data.project.audioTracks}
            wanted={wantedAudioTrack}
            {transcriptTrack}
            stateOf={audioStateOf}
            onchoose={chooseAudioTrack}
          />
        {/if}
      {/snippet}
    </MediaMonitor>

    <!-- A focusable separator is the ARIA window splitter widget, which Svelte's role table treats as static. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="group relative z-10 -mx-2 hidden w-4 cursor-col-resize touch-none focus-visible:outline-none lg:block"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize transcript pane"
      aria-valuenow={paneWidth.value}
      aria-valuemin={paneWidth.min}
      aria-valuemax={paneWidth.max}
      onpointerdown={paneWidth.beginResize}
      onkeydown={paneWidth.resizeWithKeyboard}
    >
      <span
        class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-accent group-focus-visible:bg-focus motion-reduce:transition-none"
      ></span>
    </div>

    <TranscriptPanel
      {editor}
      track={data.track}
      tracks={data.tracks}
      {readyTrack}
      run={status.run}
      preparations={status.preparations}
      mediaPreparationStatus={data.project.mediaPreparationStatus}
      hasSourceMedia={data.project.hasSourceMedia}
      mediaDurationUs={data.project.mediaDurationUs}
      transcriptionModels={data.transcriptionModels}
      detectedHardware={data.detectedHardware}
      transcriptionDefaults={data.transcriptionDefaults}
      audioTracks={data.project.audioTracks}
      audioTrack={playingAudioTrack}
      canDelete={data.project.canManage}
      oncreate={canCreateTranscript
        ? () => (transcribeDialogOpen = true)
        : null}
      onopentrack={openTrack}
      ondismissready={() => (readyRunId = null)}
    />
  </div>

  <div class="shrink-0">
    <Timeline
      durationUs={editor.transport.sourceDurationUs}
      probeState={data.project.mediaPreparationStatus}
      waveformUrl={derivativeUrl(
        data.derivatives,
        "waveform",
        playingAudioTrack,
      )}
      cues={editor.cues}
      selectedCueId={editor.selectedCueId}
      playbackUs={editor.transport.playbackUs}
      playing={editor.transport.playing}
      seekRevision={editor.transport.seekRevision}
      onseek={editor.transport.seekTo}
      onselect={(cueId) => editor.select(cueId)}
      oncommittiming={(timing, gesture) => editor.retime(timing, gesture)}
    />
  </div>
  <ShortcutGuide bind:open={shortcutGuideOpen} />
  {#if hasTrackAndMedia}
    <TranscribeDialog
      bind:open={transcribeDialogOpen}
      models={data.transcriptionModels}
      hardware={data.detectedHardware}
      defaults={data.transcriptionDefaults}
      mediaDurationUs={data.project.mediaDurationUs}
      audioTracks={data.project.audioTracks}
      audioTrack={playingAudioTrack}
      onbeforesubmit={saveBeforeTranscribing}
    />
  {/if}
  <MediaDialog
    bind:open={mediaDialogOpen}
    project={data.project}
    derivatives={data.derivatives}
    {transcriptTrack}
    stateOf={audioStateOf}
  />
</div>
