<script>
  import { LANE_AXES, LANE_OPTIONS } from './model.js';

  let { cols, rows, routing, lanes, max = 12, onDims, onRouting, onLanes } = $props();

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
    <span class="num">01</span>
    <h2>拓扑与路由</h2>
    <span class="rule"></span>
  </header>

  <div class="dims">
    <div class="dim">
      <span class="field-label">列 · x</span>
      <div class="stepper">
        <button onclick={() => onDims(cols - 1, rows)} disabled={cols <= 1} aria-label="减少列">−</button>
        <span class="mono value">{cols}</span>
        <button onclick={() => onDims(cols + 1, rows)} disabled={cols >= max} aria-label="增加列">+</button>
      </div>
    </div>
    <div class="dim">
      <span class="field-label">行 · y</span>
      <div class="stepper">
        <button onclick={() => onDims(cols, rows - 1)} disabled={rows <= 1} aria-label="减少行">−</button>
        <span class="mono value">{rows}</span>
        <button onclick={() => onDims(cols, rows + 1)} disabled={rows >= max} aria-label="增加行">+</button>
      </div>
    </div>
  </div>

  <div class="routing-row">
    <span class="field-label">维序路由</span>
    <div class="seg">
      <button class:active={routing === 'xy'} onclick={() => onRouting('xy')}>
        <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
          <path d="M2 12 H15 V3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M12.4 4.4 L15.2 1.8 L17.6 4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="2" cy="12" r="1.7" fill="currentColor" />
        </svg>
        X-Y
      </button>
      <button class:active={routing === 'yx'} onclick={() => onRouting('yx')}>
        <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
          <path d="M2 12 V2 H15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M13.6 0.4 L16.2 2.2 L13.6 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="2" cy="12" r="1.7" fill="currentColor" />
        </svg>
        Y-X
      </button>
    </div>
  </div>

  <div class="lane-block">
    <div class="lane-row">
      <span class="field-label">重复 lane</span>
      <div class="seg compact">
        {#each LANE_OPTIONS as k (k)}
          <button
            class:active={lanes.count === k}
            title={`每条链路 ${k} 条并行 lane`}
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

  <p class="card-note">
    先沿 {routing === 'xy' ? 'X' : 'Y'} 方向走到目标列/行，再转向另一维。每个跳段单独统计正反两个方向的负载。
  </p>
</section>

<style>
  .dims {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }

  .dim {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px 7px 11px;
    background: #fbf7ef;
    border: 1px solid var(--line-2);
    border-radius: 11px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .stepper button {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    font-size: 14px;
    line-height: 1;
    color: var(--ink-3);
    border-radius: 7px;
    transition: background 0.16s var(--ease), color 0.16s var(--ease);
  }

  .stepper button:hover:not(:disabled) {
    background: #efe7d7;
    color: var(--ink);
  }

  .stepper button:disabled {
    opacity: 0.3;
  }

  .value {
    min-width: 20px;
    text-align: center;
    font-size: 13px;
    color: var(--ink);
  }

  .routing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .lane-block {
    margin-top: 12px;
    padding-top: 11px;
    border-top: 1px dashed var(--line-2);
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
</style>
