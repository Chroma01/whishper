<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { CONTROL_CLASSES } from "./variants";

  type Props = HTMLInputAttributes & { ref?: HTMLInputElement };

  let {
    value = $bindable(),
    ref = $bindable(),
    class: extra = "",
    ...rest
  }: Props = $props();
</script>

<input
  bind:this={ref}
  bind:value
  {...rest}
  class="{CONTROL_CLASSES} h-9 {extra}"
/>
