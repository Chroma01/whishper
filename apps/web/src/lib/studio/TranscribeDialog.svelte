<script lang="ts">
  import Dialog from "#lib/components/ui/Dialog.svelte";
  import type { AudioTrack } from "#lib/shared/audio-tracks.ts";
  import type { TranscriptionDefaults } from "#lib/shared/instance-settings.ts";
  import type {
    AvailableTranscriptionModel,
    DetectedWorkerHardware,
  } from "#lib/shared/transcription-models.ts";
  import TranscribePanel, { processingNote } from "./TranscribePanel.svelte";

  type Props = {
    open?: boolean;
    models: AvailableTranscriptionModel[];
    hardware: DetectedWorkerHardware[];
    defaults: TranscriptionDefaults;
    mediaDurationUs: number | null;
    audioTracks: AudioTrack[];
    audioTrack: number;
    onbeforesubmit: () => Promise<string | null>;
  };

  let {
    open = $bindable(false),
    models,
    hardware,
    defaults,
    mediaDurationUs,
    audioTracks,
    audioTrack,
    onbeforesubmit,
  }: Props = $props();
</script>

<Dialog bind:open title="New transcript" description={processingNote(models)}>
  <TranscribePanel
    {models}
    {hardware}
    {defaults}
    {mediaDurationUs}
    {audioTracks}
    {audioTrack}
    {onbeforesubmit}
  />
</Dialog>
