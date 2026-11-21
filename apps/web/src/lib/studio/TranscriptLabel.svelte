<script lang="ts">
  import Flag from "#lib/components/Flag.svelte";
  import { languageFlag, languageName } from "#lib/shared/languages.ts";
  import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";
  import { transcriptDate } from "./transcripts.ts";

  type Props = {
    track: SubtitleTrackSummary;
    // Only a file with several audio tracks names the one each transcript used.
    showAudioTrack: boolean;
  };

  let { track, showAudioTrack }: Props = $props();

  const details = $derived(
    [
      showAudioTrack && track.audioTrack !== null
        ? `Track ${track.audioTrack + 1}`
        : null,
      track.name,
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<span class="flex min-w-0 flex-1 items-center gap-2">
  <Flag flag={languageFlag(track.language)} placeholder={track.language} />
  <span
    class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-sm text-text"
  >
    <span class="truncate font-medium">{languageName(track.language)}</span>
    <time
      class="text-xs text-text-muted"
      datetime={track.createdAt.toISOString()}
    >
      {transcriptDate.format(track.createdAt)}
    </time>
    <span class="col-span-2 truncate text-xs text-text-muted">{details}</span>
  </span>
</span>
