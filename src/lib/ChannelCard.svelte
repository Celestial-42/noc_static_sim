<script>
  import { LANE_AXES, LANE_OPTIONS } from './model.js';
  import { loadColor } from './theme.js';

  let { channels, activeId, lanes, analysis, onSelect, onAdd, onRemove, onLanes } = $props();

  let laneFormula = $derived(
    lanes.count <= 1
      ? 'K = 1：整条链路共享一条 lane。'
      : lanes.axis === 'xid'
        ? 'lane = target.x & (K − 1)'
        : lanes.axis === 'yid'
          ? 'lane = target.y & (K − 1)'
          : 'lane = (tx ^ ty ^ sx ^ sy) & (K − 1)'
  );
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
          {#if ch.lanes?.count > 1}
            <span class="lane-chip mono">×{ch.lanes.count}</span>
          {/if}
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

  <div class="lane-block">
    <div class="lane-head">
      <span class="field-label">lane 配置</span>
      <span class="lane-scope mono">
        <span class="dot" style:background={channels.find((c) => c.id === activeId)?.color}></span>
        {activeId}
      </span>
    </div>
    <div class="lane-row">
      <span class="field-label">重复 lane</span>
      <div class="seg compact">
        {#each LANE_OPTIONS as k (k)}
          <button
            class:active={lanes.count === k}
            title={`该通道每条链路 ${k} 条并行 lane`}
            onclick={() => onLanes({ ...lanes, count: k })}
          >×{k}</button>
        {/each}
      </div>
    </div>
    <div class="lane-row">
      <span class="field-label">lane 选择</span>
      <div class="seg compact">
        {#each LANE_AXES as axis (axis.id)}
          <button
            class:active={lanes.count > 1 && lanes.axis === axis.id}
            disabled={lanes.count === 1}
            title={axis.name}
            onclick={() => onLanes({ ...lanes, axis: axis.id })}
          >{axis.label}</button>
        {/each}
      </div>
    </div>
    <p class="lane-formula mono">{laneFormula}</p>
  </div>

  <button class="add" onclick={onAdd}>＋ 新增通道</button>
  <p class="card-note">通道之间独立计算链路负载；细条为该通道最热 lane 的负载，K=1 时即链路负载。lane 数（×1/×2/×4）与选择方式按通道单独配置。</p>
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

  .lane-chip {
    flex: none;
    padding: 0 5px;
    font-size: 9.5px;
    line-height: 15px;
    color: var(--ink-3);
    background: #f1ece1;
    border-radius: 5px;
  }

  .ch-row.active .lane-chip {
    color: var(--accent);
    background: #e4eeea;
  }

  .lane-block {
    margin: 2px -6px 10px;
    padding: 10px 6px 0;
    border-top: 1px dashed var(--line-2);
  }

  .lane-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }

  .lane-scope {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    color: var(--ink-3);
    letter-spacing: 0.04em;
  }

  .lane-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .lane-row + .lane-row {
    margin-top: 8px;
  }

  .seg.compact button {
    padding: 4px 9px;
    font-size: 10.5px;
  }

  .seg.compact button:disabled {
    color: #c1b8a6;
  }

  .lane-formula {
    margin-top: 7px;
    font-size: 9.5px;
    color: var(--muted);
    letter-spacing: 0.01em;
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
