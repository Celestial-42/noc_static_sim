<script>
  import { nodeShapePath } from './model.js';

  let { type = 'RNF', size = 14, color = 'currentColor', fill = 0.16 } = $props();

  let d = $derived(nodeShapePath(type, 6));
</script>

<svg class="glyph" width={size} height={size} viewBox="-8 -8 16 16" aria-hidden="true">
  <path {d} fill={color} fill-opacity={fill} stroke={color} stroke-width="1.15" stroke-linejoin="round" />
</svg>

<style>
  .glyph {
    display: block;
    flex: none;
    overflow: visible;
  }
</style>
