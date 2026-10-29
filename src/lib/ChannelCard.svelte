<script>
  import { loadColor } from './theme.js';

  let { channels, activeId, analysis, onSelect, onAdd, onRemove } = $props();
</script>

<section class="card">
  <header class="card-head">
    <span class="num">02</span>
    <h2>通道</h2>
    <span class="rule"></span>
  </header>

  <ul class="channels">
    {#each channels as ch (ch.id)}
      {@const stat = analysis.channels[ch.id]}
      {@const peak = stat?.maxLoad ?? 0}
      <li class="ch-row" class:active={ch.id === activeId}>
        <button class="ch-select" onclick={() => onSelect(ch.id)}>
          <span class="dot" style:background={ch.color}></span>
          <span class="ch-id mono">{ch.id}</span>
        </button>
        <span class="ch-meter" title="峰值 lane 负载">
          <span
            style:width={`${Math.min(100, (peak / 1.2) * 100)}%`}
            style:background={loadColor(peak)}
          ></span>
        </span>
        <button
          class="ch-remove"
          onclick={() => onRemove(ch.id)}
          disabled={channels.length <= 1}
          aria-label={`删除通道 ${ch.id}`}
        >×</button>
      </li>
    {/each}
  </ul>

  <button class="add" onclick={onAdd}>＋ 新增通道</button>
  <p class="card-note">通道之间独立计算链路负载；细条为该通道最热 lane 的负载，K=1 时即链路负载。</p>
</section>

<style>
  .channels {
    list-style: none;
    margin: 0 -6px 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .ch-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 92px 18px;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 9px;
    border: 1px solid transparent;
    transition: background 0.16s var(--ease), border-color 0.16s var(--ease);
  }

  .ch-row:hover {
    background: #faf6ed;
  }

  .ch-row.active {
    background: var(--accent-2);
    border-color: #cadcd6;
  }

  .ch-select {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    text-align: left;
  }

  .ch-id {
    font-size: 11.5px;
    color: var(--ink-2);
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ch-row.active .ch-id {
    color: var(--accent);
    font-weight: 500;
  }

  .ch-meter {
    height: 4px;
    border-radius: 2px;
    background: #efe7d7;
    overflow: hidden;
  }

  .ch-meter span {
    display: block;
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s var(--ease), background 0.3s var(--ease);
  }

  .ch-remove {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    font-size: 13px;
    line-height: 1;
    color: #b3ab9a;
    border-radius: 5px;
    opacity: 0;
    transition: opacity 0.16s var(--ease), background 0.16s var(--ease), color 0.16s var(--ease);
  }

  .ch-row:hover .ch-remove {
    opacity: 1;
  }

  .ch-remove:hover:not(:disabled) {
    background: #f3e2d7;
    color: var(--ember);
  }

  .ch-remove:disabled {
    opacity: 0;
  }

  .add {
    width: 100%;
    padding: 7px;
    font-size: 11.5px;
    color: var(--ink-3);
    border: 1px dashed #ddd3c0;
    border-radius: 9px;
    transition: background 0.16s var(--ease), color 0.16s var(--ease), border-color 0.16s var(--ease);
  }

  .add:hover {
    color: var(--accent);
    border-color: #b9cdc7;
    background: #f4f8f5;
  }
</style>
