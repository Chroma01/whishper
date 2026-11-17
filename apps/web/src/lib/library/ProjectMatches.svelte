<script lang="ts">
  import HighlightedText from "#lib/components/ui/HighlightedText.svelte";
  import { formatClock, pluralize } from "#lib/shared/format.ts";
  import { languageFlag, languageName } from "#lib/shared/languages.ts";
  import type {
    ProjectMatch,
    TranscriptHit,
  } from "#lib/shared/library-data.ts";
  import { projectCueUrl } from "#lib/shared/routes.ts";

  type Props = {
    projectId: string;
    projectName: string;
    match: ProjectMatch;
    query: string;
    // Each line names its language only when the project has several.
    showLanguages: boolean;
  };

  let { projectId, projectName, match, query, showLanguages }: Props = $props();

  const PREVIEW_COUNT = 3;

  let expanded = $state(false);
  let shownHits = $derived(
    expanded ? match.hits : match.hits.slice(0, PREVIEW_COUNT),
  );
  let summary = $derived(
    [
      pluralize(match.hitCount, "matching line"),
      match.languages.length > 1
        ? match.languages
            .map(({ language, count }) => `${languageName(language)} ${count}`)
            .join(", ")
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  let firstHit = $derived(match.hits[0]);

  // The studio's find bar looks for the words that matched in this line.
  function findText(hit: TranscriptHit): string {
    return hit.segments.find((segment) => segment.match)?.text ?? query;
  }
</script>

<div class="relative z-10 grid min-w-0 gap-1">
  <p class="text-xs text-text-muted">{summary}</p>
  <ul class="grid min-w-0" aria-label="Matching lines in {projectName}">
    {#each shownHits as hit (hit.cueId)}
      <li class="min-w-0">
        <a
          href={projectCueUrl(projectId, hit.trackId, hit.cueId, findText(hit))}
          class="-mx-2 grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1 text-sm text-text transition-colors duration-150 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none"
        >
          <span class="font-mono text-xs text-text-muted tabular-nums">
            {formatClock(Math.floor(hit.startUs / 1_000_000))}
          </span>
          <span class="line-clamp-2 min-w-0" dir="auto">
            {#if showLanguages}
              <span aria-hidden="true">{languageFlag(hit.language) ?? ""}</span>
              <span class="sr-only">{languageName(hit.language)}:</span>
            {/if}
            <HighlightedText segments={hit.segments} />
          </span>
        </a>
      </li>
    {/each}
  </ul>
  {#if match.hits.length > PREVIEW_COUNT || (expanded && firstHit && match.hitCount > match.hits.length)}
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      {#if match.hits.length > PREVIEW_COUNT}
        <button
          type="button"
          aria-expanded={expanded}
          class="justify-self-start rounded-sm text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          onclick={() => (expanded = !expanded)}
        >
          {#if expanded}
            Show fewer
          {:else if match.hitCount > match.hits.length}
            Show {match.hits.length} of {match.hitCount}
          {:else}
            Show all {match.hitCount}
          {/if}
        </button>
      {/if}
      {#if expanded && firstHit && match.hitCount > match.hits.length}
        <a
          href={projectCueUrl(
            projectId,
            firstHit.trackId,
            firstHit.cueId,
            findText(firstHit),
          )}
          class="rounded-sm text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          See all {match.hitCount} in the studio
        </a>
      {/if}
    </div>
  {/if}
</div>
