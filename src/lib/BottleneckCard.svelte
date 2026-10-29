<script>
  import { loadColor } from './theme.js';

  let { items, hovered, onHover, onSelect } = $props();
</script>

<section class="card">
  <header class="card-head">
    <span class="num">04</span>
    <h2>瓶颈链路</h2>
    <span class="rule"></span>
  </header>

  <div class="list">
    {#each items as item, index (item.key)}
      <button
        class="row"
        class:hot={hovered.kind === 'link' && hovered.id === item.linkId}
        title={`单向合计 ${item.total.toFixed(2)}× · 峰值为 L${item.lane} 的 ${item.load.toFixed(2)}×`}
        onpointerenter={() => onHover('link', item.linkId)}
        onpointerleave={() => onHover(null, null)}
        onclick={() => onSelect('link', item.linkId)}
      >
        <span class="rank hand">{String(index + 1).padStart(2, '0')}</span>
        <span class="label mono">
          R{item.from.x},{item.from.y} → R{item.to.x},{item.to.y}{#if item.laneLoads.length > 1}<span class="lane-tag">L{item.lane}</span>{/if}
        </span>
        <span class="bar">
          <span style:width={`${Math.min(100, (item.load / 1.2) * 100)}%`} style:background={loadColor(item.load)}></span>
        </span>
        <span class="val mono" class:over={item.load > 1}>{item.load.toFixed(2)}×</span>
      </button>
    {:else}
      <p class="empty">当前通道还没有经过链路的流量。</p>
    {/each}
  </div>

  <p class="card-note">按单向 lane 负载排序；K=1 时即链路负载，超过 1.0× 代表已经超额订阅。</p>
</section>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0 -6px;
  }

  .row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 52px 42px;
    align-items: center;
    gap: 7px;
    padding: 5px 6px;
    border-radius: 7px;
    text-align: left;
    transition: background 0.16s var(--ease);
  }

  .row:hover,
  .row.hot {
    background: #faf5ea;
  }

  .rank {
    font-size: 11px;
    color: #c0a17e;
    text-align: center;
  }

  .label {
    font-size: 10px;
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lane-tag {
    margin-left: 4px;
    font-size: 8.5px;
    color: var(--accent);
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: #efe7d7;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s var(--ease), background 0.3s var(--ease);
  }

  .val {
    font-size: 10.5px;
    color: var(--ink-2);
    text-align: right;
  }

  .val.over {
    color: var(--ember);
    font-weight: 500;
  }

  .empty {
    padding: 6px;
    font-size: 11px;
    color: var(--muted);
  }
</style>
