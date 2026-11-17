<script lang="ts">
  import { tick } from "svelte";
  import CreateProjectDialog from "#lib/library/CreateProjectDialog.svelte";
  import ProjectRow, {
    PROJECT_ROW_COLUMNS,
  } from "#lib/library/ProjectRow.svelte";
  import {
    carriesMediaFile,
    firstDroppedMediaFile,
  } from "#lib/library/drop-zone.ts";
  import Icon from "#lib/components/Icon.svelte";
  import Button from "#lib/components/ui/Button.svelte";
  import EmptyState from "#lib/components/ui/EmptyState.svelte";
  import LibrarySearchBar from "#lib/library/LibrarySearchBar.svelte";
  import { libraryUrl } from "#lib/library/search-url.ts";
  import { refreshAll } from "$app/navigation";
  import { pollWhileActive } from "#lib/browser/polling.svelte.ts";
  import type {
    LibraryProjectStatus,
    ProjectSummary,
  } from "#lib/shared/library-data.ts";
  import { libraryStatusUrl } from "#lib/shared/routes.ts";
  import { pluralize } from "#lib/shared/format.ts";
  import { isProjectActive } from "#lib/shared/project-status.ts";

  let { data, form } = $props();
  let createDialogOpen = $state(false);
  let droppedFile = $state<File | null>(null);
  let dragDepth = $state(0);
  let dragHasMedia = $state(true);
  let dropMessage = $state("");
  let now = $state(new Date());
  // Progress polled since the last load, so a search is not run again just
  // to move a progress bar.
  let polledStatuses = $state.raw<{
    loaded: ProjectSummary[];
    statuses: Map<string, LibraryProjectStatus>;
  } | null>(null);
  let projects = $derived.by(() => {
    if (polledStatuses?.loaded !== data.projects) return data.projects;
    const { statuses } = polledStatuses;
    return data.projects.map((project) => ({
      ...project,
      ...statuses.get(project.id),
    }));
  });
  let hasFilters = $derived(
    data.search.language !== null ||
      data.search.status !== null ||
      data.search.added !== null,
  );
  let hasActiveSearch = $derived(data.search.query.length > 0 || hasFilters);
  let lineCount = $derived(
    projects.reduce(
      (total, project) => total + (project.match?.hitCount ?? 0),
      0,
    ),
  );
  let resultSummary = $derived(
    [
      pluralize(projects.length, "project"),
      lineCount > 0 ? pluralize(lineCount, "matching line") : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  let firstThumbnailIndex = $derived(
    projects.findIndex((project) => project.hasThumbnail),
  );
  let hasActiveJob = $derived(projects.some(isProjectActive));
  let renameActionUrl = $derived.by(() => {
    const url = libraryUrl(data.search);
    return url === "/" ? "?/renameProject" : `${url}&/renameProject`;
  });
  let acceptsDrops = $derived(data.workspace !== null && !createDialogOpen);

  pollWhileActive(
    () => hasActiveJob,
    2_000,
    () => (data.search.query ? pollStatuses() : refreshAll()),
  );

  // A finished job can add transcript text, so the search runs again then.
  async function pollStatuses(): Promise<void> {
    const loaded = data.projects;
    const response = await fetch(libraryStatusUrl());
    if (!response.ok) return refreshAll();
    const list = (await response.json()) as LibraryProjectStatus[];
    const statuses = new Map(list.map((status) => [status.id, status]));
    const finished = projects.some((project) => {
      const next = statuses.get(project.id);
      return isProjectActive(project) && next && !isProjectActive(next);
    });
    if (finished) return refreshAll();
    polledStatuses = { loaded, statuses };
  }

  $effect(() => {
    const timer = window.setInterval(() => (now = new Date()), 60_000);
    return () => window.clearInterval(timer);
  });

  function openCreateDialog(file: File | null = null) {
    droppedFile = file;
    createDialogOpen = true;
  }

  function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  // The dialog's own file input takes drops natively.
  function targetsFileInput(event: DragEvent): boolean {
    return (
      event.target instanceof HTMLInputElement && event.target.type === "file"
    );
  }

  function handleDragEnter(event: DragEvent) {
    if (!acceptsDrops || !carriesFiles(event)) return;
    if (dragDepth === 0) {
      dragHasMedia = carriesMediaFile(event.dataTransfer);
      dropMessage = "";
    }
    dragDepth += 1;
  }

  function handleDragLeave() {
    if (dragDepth > 0) dragDepth -= 1;
  }

  // Cancelling dragover and drop also stops the browser from navigating to a file dropped outside the dialog's input.
  function handleDragOver(event: DragEvent) {
    if (carriesFiles(event) && !targetsFileInput(event)) event.preventDefault();
  }

  function handleDrop(event: DragEvent) {
    if (!carriesFiles(event) || targetsFileInput(event)) return;
    event.preventDefault();
    dragDepth = 0;
    if (!acceptsDrops) return;
    const file = firstDroppedMediaFile(event.dataTransfer);
    if (file) openCreateDialog(file);
    else void announceRejectedDrop();
  }

  // Cleared first so a repeated rejection is announced again.
  async function announceRejectedDrop() {
    dropMessage = "";
    await tick();
    dropMessage =
      "Not a media file. Drop an audio or video file to create a project.";
  }
</script>

<svelte:head>
  <title>Projects · Anysub</title>
</svelte:head>

<svelte:window
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
/>

{#snippet newProjectButton()}
  <Button variant="primary" onclick={() => openCreateDialog()}>
    <Icon name="plus" size={16} />
    New project
  </Button>
{/snippet}

<div class="py-6 sm:py-8">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight text-text">Projects</h1>
      <p class="mt-1 text-sm text-text-muted">
        {pluralize(data.workspace?.projectCount ?? 0, "project")} ·
        {pluralize(data.workspace?.readySourceCount ?? 0, "source")} ready
      </p>
    </div>
    {#if data.workspace}
      {@render newProjectButton()}
    {/if}
  </header>

  {#if data.workspace && (data.workspace.projectCount > 0 || hasActiveSearch)}
    <LibrarySearchBar search={data.search} languages={data.languages} />
  {/if}

  {#if data.workspace}
    <CreateProjectDialog
      bind:open={createDialogOpen}
      workspaceId={data.workspace.id}
      maxUploadBytes={data.maxUploadBytes}
      initialFile={droppedFile}
    />
  {/if}

  <section class="mt-6" aria-labelledby="project-list-title">
    <div
      class="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
    >
      <h2 id="project-list-title" class="text-sm font-medium text-text">
        {data.search.query ? "Results" : "All projects"}
      </h2>
      <p class="text-xs text-text-muted">{resultSummary}</p>
    </div>

    {#if data.needsTerm}
      <EmptyState icon="search" title="Add a word to look for" tone="accent">
        <p>
          Words with a minus are left out of the results. Add at least one word
          to search for.
        </p>
      </EmptyState>
    {:else if projects.length === 0 && hasActiveSearch}
      <EmptyState
        icon="search"
        title={data.search.query
          ? `No results for “${data.search.query}”`
          : "No projects match these filters"}
        tone="accent"
      >
        {#if hasFilters && data.unfilteredCount > 0}
          <p>
            Clearing the filters shows {pluralize(
              data.unfilteredCount,
              "project",
            )}.
          </p>
          <Button
            href={libraryUrl({
              ...data.search,
              language: null,
              status: null,
              added: null,
            })}
          >
            Clear filters
          </Button>
        {:else}
          <p>Nothing in project names or transcripts matches.</p>
          {#if data.search.query.includes('"')}
            <Button
              href={libraryUrl({
                ...data.search,
                query: data.search.query.replaceAll('"', ""),
              })}
            >
              Search without quotes
            </Button>
          {:else}
            <Button href="/">Clear search</Button>
          {/if}
        {/if}
      </EmptyState>
    {:else if projects.length === 0}
      <EmptyState icon="subtitles" title="No projects yet" tone="accent">
        {#if data.workspace}
          {@render newProjectButton()}
          <p>or drop a media file anywhere</p>
        {/if}
      </EmptyState>
    {:else}
      <div class="overflow-hidden rounded-lg border border-border bg-surface">
        <div
          class="hidden gap-x-4 border-b border-border px-4 py-2 text-xs font-medium text-text-muted sm:grid {PROJECT_ROW_COLUMNS}"
          aria-hidden="true"
        >
          <span class="col-span-2">Name</span>
          <span class="text-right">Duration</span>
          <span>Status</span>
          <span>Last edited</span>
        </div>
        <ul class="divide-y divide-border">
          {#each projects as project, index (project.id)}
            <ProjectRow
              {project}
              {form}
              {now}
              eagerThumbnail={index === firstThumbnailIndex}
              renameAction={renameActionUrl}
              query={data.search.query}
            />
          {/each}
        </ul>
      </div>
    {/if}
  </section>
</div>

<p class="sr-only" role="status">{dropMessage}</p>
<p class="sr-only" role="status">
  {data.search.query ? resultSummary : ""}
</p>

{#if dragDepth > 0}
  <div
    class="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-overlay p-6 transition-opacity duration-150 motion-reduce:transition-none starting:opacity-0"
    aria-hidden="true"
  >
    <div
      class={[
        "grid justify-items-center gap-3 rounded-xl border-2 border-dashed bg-surface-raised px-10 py-8 text-center shadow-xl",
        dragHasMedia ? "border-accent" : "border-danger",
      ]}
    >
      <span class={dragHasMedia ? "text-accent" : "text-danger"}>
        <Icon name="file" size={28} />
      </span>
      <p class="text-base font-semibold text-text">
        {dragHasMedia ? "Drop to create a project" : "Not a media file"}
      </p>
      <p class="text-sm text-text-muted">
        {dragHasMedia ? "Audio or video files" : "Drop an audio or video file"}
      </p>
    </div>
  </div>
{/if}
