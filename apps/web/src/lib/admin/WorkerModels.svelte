<script lang="ts">
  import ModelRow from "#lib/admin/ModelRow.svelte";
  import UsageMeter from "#lib/admin/UsageMeter.svelte";
  import { pollWhileActive } from "#lib/browser/polling.svelte.ts";
  import Icon from "#lib/components/Icon.svelte";
  import type {
    InventoryModel,
    WorkerModelInventory,
  } from "#lib/shared/model-inventory.ts";

  type Props = {
    // At least one worker, each with only the models this list is about.
    workers: WorkerModelInventory[];
    label: string;
    defaultKey?: string | null;
    // The model to point out on each worker, if any.
    suggest?: (models: InventoryModel[]) => string | null;
  };

  let {
    workers,
    label,
    defaultKey = null,
    suggest = () => null,
  }: Props = $props();

  const TASK_POLL_MS = 1_500;

  let pickedWorkerId = $state<string>();
  const worker = $derived(
    workers.find((candidate) => candidate.workerId === pickedWorkerId) ??
      workers[0],
  );
  const suggestedKey = $derived(worker ? suggest(worker.models) : null);

  pollWhileActive(
    () =>
      workers.some((candidate) => candidate.models.some((model) => model.task)),
    TASK_POLL_MS,
  );
</script>

{#if worker}
  <div class="grid gap-3">
    {#if workers.length > 1}
      <div
        class="flex flex-wrap gap-1 justify-self-start rounded-lg bg-surface-sunken p-1"
        role="group"
        aria-label="Worker"
      >
        {#each workers as candidate (candidate.workerId)}
          {@const selected = candidate.workerId === worker.workerId}
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none {selected
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text'}"
            aria-pressed={selected}
            onclick={() => (pickedWorkerId = candidate.workerId)}
          >
            <Icon name="server" size={16} />
            {candidate.name}
          </button>
        {/each}
      </div>
    {/if}

    <div
      class="grid gap-3 rounded-md bg-surface-sunken px-3 py-2.5 sm:grid-cols-2 sm:gap-6"
    >
      <div class="grid min-w-0 content-start gap-0.5">
        <span class="text-xs text-text-muted">{worker.name}</span>
        <strong class="text-sm font-medium break-words text-text">
          {worker.hardware?.name ?? "Hardware details unavailable"}
        </strong>
        {#if worker.hardware}
          <span class="text-xs break-words text-text-muted">
            {worker.hardware.details.join(" · ")}
          </span>
        {/if}
      </div>
      {#if worker.storage}
        <UsageMeter
          label="Model disk"
          usedBytes={worker.storage.totalBytes - worker.storage.availableBytes}
          totalBytes={worker.storage.totalBytes}
        />
      {/if}
    </div>

    {#if !worker.manageable}
      <p
        class="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
      >
        <span class="mt-0.5 shrink-0"><Icon name="alert" size={16} /></span>
        {worker.name} runs an older version that cannot download or remove models.
        Update the worker image to manage models here.
      </p>
    {/if}

    <ul
      class="divide-y divide-border rounded-lg border border-border"
      aria-label="{label} on {worker.name}"
    >
      {#each worker.models as model (model.key)}
        <ModelRow
          {model}
          workerId={worker.workerId}
          workerName={worker.name}
          manageable={worker.manageable}
          availableBytes={worker.storage?.availableBytes ?? null}
          isDefault={model.key === defaultKey}
          suggested={model.key === suggestedKey}
        />
      {/each}
    </ul>
  </div>
{/if}
