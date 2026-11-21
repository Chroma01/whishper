<script lang="ts">
  import { page } from "$app/state";
  import { ADMIN_SECTION_GROUPS } from "#lib/admin/sections.ts";
  import Icon from "#lib/components/Icon.svelte";

  let { data, children } = $props();
</script>

<div class="py-8 sm:py-10">
  <header class="mb-6 flex items-center gap-3 sm:mb-8">
    <span
      class="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
      aria-hidden="true"
    >
      <Icon name="shield" size={20} />
    </span>
    <div class="min-w-0">
      <h1 class="text-xl font-semibold tracking-tight text-text">
        Administration
      </h1>
      <p class="text-sm text-text-muted">
        How Anysub runs on this server, for everyone who uses it.
      </p>
    </div>
    <p
      class="ml-auto shrink-0 self-start text-xs text-text-subtle tabular-nums"
    >
      Anysub {data.version}
    </p>
  </header>

  <div class="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
    <nav aria-label="Administration" class="min-w-0">
      <!-- A scrolling row on narrow screens, a sidebar with group labels on wide ones. -->
      <div
        class="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:gap-6 md:overflow-visible md:px-0 md:pb-0"
      >
        {#each ADMIN_SECTION_GROUPS as group (group.label)}
          {@const labelId = `admin-group-${group.label.toLowerCase()}`}
          <div class="flex shrink-0 gap-1 md:grid md:gap-1.5">
            <p
              id={labelId}
              class="hidden px-3 text-xs font-medium text-text-subtle md:block"
            >
              {group.label}
            </p>
            <ul class="flex gap-1 md:grid" aria-labelledby={labelId}>
              {#each group.sections as section (section.href)}
                {@const current = page.url.pathname.startsWith(section.href)}
                <li class="shrink-0">
                  <a
                    href={section.href}
                    aria-current={current ? "page" : undefined}
                    class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none {current
                      ? 'bg-surface text-text shadow-sm ring-1 ring-border'
                      : 'text-text-muted hover:bg-surface-sunken hover:text-text'}"
                  >
                    <span class={current ? "text-accent" : ""}>
                      <Icon name={section.icon} size={18} />
                    </span>
                    {section.label}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </nav>

    <div class="min-w-0">
      {@render children()}
    </div>
  </div>
</div>
