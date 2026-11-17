<script lang="ts" generics="T extends string">
  import Icon from "#lib/components/Icon.svelte";
  import Menu from "#lib/components/ui/Menu.svelte";
  import MenuItem from "#lib/components/ui/MenuItem.svelte";

  type Option = { value: T | null; label: string; flag?: string | null };
  type Props = {
    label: string;
    options: Option[];
    selected: T | null;
    onchoose: (value: T | null) => void;
    // A sort always has a value, so it reads "Sort: Name" and is never shown
    // as an active filter.
    isSort?: boolean;
    align?: "start" | "end";
  };

  let {
    label,
    options,
    selected,
    onchoose,
    isSort = false,
    align = "start",
  }: Props = $props();

  let current = $derived(options.find((option) => option.value === selected));
  let isActive = $derived(!isSort && selected !== null);
</script>

<Menu {label} {align}>
  {#snippet trigger(args)}
    <button
      type="button"
      {...args}
      class={[
        "inline-flex h-8 max-w-56 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none",
        isActive
          ? "border-accent bg-accent-soft text-text"
          : "border-border-strong bg-surface text-text-muted hover:bg-surface-sunken hover:text-text",
      ]}
    >
      {#if isSort}
        <span>{label}:</span>
        <span class="truncate text-text">{current?.label}</span>
      {:else if isActive && current}
        <span class="sr-only">{label}:</span>
        {#if current.flag}<span aria-hidden="true">{current.flag}</span>{/if}
        <span class="truncate">{current.label}</span>
      {:else}
        <span>{label}</span>
      {/if}
      <span class="shrink-0" aria-hidden="true">
        <Icon name="chevron-down" size={14} />
      </span>
    </button>
  {/snippet}
  {#each options as option (option.value)}
    <MenuItem
      role="menuitemradio"
      checked={option.value === selected}
      onselect={() => onchoose(option.value)}
    >
      {#if option.flag}<span aria-hidden="true">{option.flag}</span>{/if}
      {option.label}
    </MenuItem>
  {/each}
</Menu>
