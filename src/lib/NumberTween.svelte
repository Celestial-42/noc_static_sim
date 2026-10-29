<script>
  import { Tween } from 'svelte/motion';

  let { value = 0, digits = 2, prefix = '', suffix = '' } = $props();

  const tween = new Tween(0, { duration: 420 });

  $effect(() => {
    tween.set(value);
  });
</script>

<span class="tween">{prefix}{tween.current.toFixed(digits)}{suffix}</span>

<style>
  .tween {
    font-variant-numeric: tabular-nums;
  }
</style>
