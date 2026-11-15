<script lang="ts">
  import Button from "./Button.svelte";
  import Dialog from "./Dialog.svelte";

  type Props = {
    open?: boolean;
    title: string;
    message: string;
    // Names the action, such as "Delete transcript", rather than "OK".
    confirmLabel: string;
    // The form action that runs on confirm.
    action: string;
    fields?: Record<string, string>;
  };

  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel,
    action,
    fields = {},
  }: Props = $props();
</script>

<Dialog bind:open {title}>
  <p class="text-sm text-text-muted">{message}</p>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <form method="POST" {action}>
      {#each Object.entries(fields) as [name, value] (name)}
        <input type="hidden" {name} {value} />
      {/each}
      <Button type="submit" variant="danger">{confirmLabel}</Button>
    </form>
  {/snippet}
</Dialog>
