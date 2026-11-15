<script lang="ts">
  import Icon from "#lib/components/Icon.svelte";
  import Button from "#lib/components/ui/Button.svelte";
  import IconButton from "#lib/components/ui/IconButton.svelte";
  import { languageName } from "#lib/shared/languages.ts";
  import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";

  type Props = {
    // A transcript that finished while another one was open.
    readyTrack: SubtitleTrackSummary | null;
    onopenready: (trackId: string) => void;
    ondismissready: () => void;
  };

  let { readyTrack, onopenready, ondismissready }: Props = $props();
</script>

<!-- The live region stays mounted so screen readers announce a finished transcript. -->
<div role="status" class="shrink-0">
  {#if readyTrack}
    <div
      class="flex items-center gap-2 border-b border-border py-1.5 pr-2 pl-4 text-sm text-text"
    >
      <span class="shrink-0 text-success" aria-hidden="true">
        <Icon name="check-circle" size={16} />
      </span>
      <p class="min-w-0 flex-1">
        The {languageName(readyTrack.language)} transcript is ready.
      </p>
      <Button size="sm" onclick={() => onopenready(readyTrack.id)}>Open</Button>
      <IconButton
        label="Dismiss"
        icon="close"
        size="sm"
        onclick={ondismissready}
      />
    </div>
  {/if}
</div>
