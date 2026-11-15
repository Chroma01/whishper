<script module lang="ts">
  import type { IconName } from "#lib/components/icon-names.ts";
  import type { Autosave } from "#lib/editor/autosave.svelte.ts";
  import type { TrackExportFormat } from "#lib/shared/routes.ts";

  const EXPORTS: {
    format: TrackExportFormat;
    name: string;
    description: string;
  }[] = [
    { format: "srt", name: "SRT", description: "Universal subtitle file" },
    { format: "vtt", name: "WebVTT", description: "Web video captions" },
    {
      format: "lrc",
      name: "LRC",
      description: "Synced lyrics for music players",
    },
    {
      format: "txt",
      name: "Plain text",
      description: "Transcript without timecodes",
    },
    {
      format: "json",
      name: "Anysub JSON",
      description: "Cues, words, and metadata",
    },
  ];

  const SAVE_ICONS: Record<Exclude<Autosave["state"], "saving">, IconName> = {
    saved: "check",
    unsaved: "edit",
    error: "alert",
    conflict: "alert",
  };
</script>

<script lang="ts">
  import Icon from "#lib/components/Icon.svelte";
  import Button from "#lib/components/ui/Button.svelte";
  import ConfirmDialog from "#lib/components/ui/ConfirmDialog.svelte";
  import IconButton from "#lib/components/ui/IconButton.svelte";
  import Menu from "#lib/components/ui/Menu.svelte";
  import MenuItem from "#lib/components/ui/MenuItem.svelte";
  import { buttonClasses } from "#lib/components/ui/variants.ts";
  import { formatBytes } from "#lib/shared/format.ts";
  import { languageName } from "#lib/shared/languages.ts";
  import { trackExportUrl } from "#lib/shared/routes.ts";
  import type { StudioData } from "#lib/shared/studio-data.ts";

  type Props = {
    project: StudioData["project"];
    track: StudioData["track"];
    autosave: Autosave;
    canCreateTranscript: boolean;
    oncreatetranscript: () => void;
    onopenshortcuts: () => void;
    onopenmedia: () => void;
  };

  let {
    project,
    track,
    autosave,
    canCreateTranscript,
    oncreatetranscript,
    onopenshortcuts,
    onopenmedia,
  }: Props = $props();

  let deleteProjectOpen = $state(false);

  const mediaDetails = $derived(
    [
      project.mediaFilename ?? "Worker diagnostic",
      project.sizeBytes ? formatBytes(project.sizeBytes) : null,
      project.mediaFrameRateNum && project.mediaFrameRateDen
        ? `${(project.mediaFrameRateNum / project.mediaFrameRateDen).toFixed(3)} fps`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const saveProblem = $derived(
    autosave.state === "error" || autosave.state === "conflict",
  );
</script>

<header
  class="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border bg-surface px-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3"
>
  <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
    <a
      href="/"
      class="{buttonClasses('ghost', 'md', true)} shrink-0"
      aria-label="Back to projects"
      title="Back to projects"
    >
      <Icon name="arrow-left" size={18} />
    </a>
    <div class="min-w-0 leading-tight">
      <h1 class="truncate text-sm font-semibold text-text" title={project.name}>
        {project.name}
      </h1>
      <button
        type="button"
        class="block max-w-full truncate rounded-xs text-left text-xs text-text-muted hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-focus max-sm:hidden"
        title="Media details"
        onclick={onopenmedia}
      >
        {mediaDetails}
      </button>
    </div>
  </div>

  <div class="flex justify-center">
    {#if track}
      <span
        class="inline-flex items-center gap-1.5 text-xs {saveProblem
          ? 'text-danger'
          : 'text-text-muted'}"
      >
        {#if autosave.state === "saving"}
          <span
            class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
        {:else}
          <Icon name={SAVE_ICONS[autosave.state]} size={14} />
        {/if}
        <span class="max-sm:sr-only">{autosave.label}</span>
      </span>
    {/if}
  </div>

  <div class="flex items-center justify-end gap-1">
    {#if canCreateTranscript}
      <Button size="sm" class="max-sm:px-2" onclick={oncreatetranscript}>
        <Icon name="plus" size={16} />
        <span class="max-sm:sr-only">New transcript</span>
      </Button>
    {/if}
    {#if track}
      <Menu label="Export" align="end">
        {#snippet trigger(args)}
          <button
            type="button"
            {...args}
            class={buttonClasses("ghost", "sm")}
            aria-label="Export"
          >
            <Icon name="download" size={16} />
            <span class="max-sm:hidden">Export</span>
          </button>
        {/snippet}
        <p class="px-2.5 pt-1 pb-1.5 text-xs text-text-muted">
          The {languageName(track.language)} transcript as
        </p>
        {#each EXPORTS as { format, name, description } (format)}
          <MenuItem
            href={trackExportUrl(project.id, track.id, format)}
            download
          >
            <span class="grid">
              <span class="font-medium">{name}</span>
              <span class="text-xs text-text-muted">{description}</span>
            </span>
          </MenuItem>
        {/each}
      </Menu>
    {/if}
    <IconButton
      label="Keyboard shortcuts"
      icon="keyboard"
      onclick={onopenshortcuts}
    />
    <Menu label="Project actions" align="end">
      {#snippet trigger(args)}
        <IconButton label="Project actions" icon="more" {...args} />
      {/snippet}
      <MenuItem onselect={onopenmedia}>Media details…</MenuItem>
      {#if project.canManage}
        <div role="separator" class="-mx-1 my-1 border-t border-border"></div>
        <MenuItem tone="danger" onselect={() => (deleteProjectOpen = true)}>
          Delete project…
        </MenuItem>
      {/if}
    </Menu>
  </div>
</header>

{#if project.canManage}
  <ConfirmDialog
    bind:open={deleteProjectOpen}
    title="Delete {project.name}?"
    message="The project, its media and every transcript are deleted. This cannot be undone."
    confirmLabel="Delete project"
    action="?/deleteProject"
  />
{/if}
