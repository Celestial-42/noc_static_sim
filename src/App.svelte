<script>
  import {
    DEFAULT_CHANNELS,
    DEFAULT_LANES,
    DEFAULT_NODE_TYPE,
    LANE_AXES,
    NODE_TYPES,
    bottlenecksOf,
    clamp,
    dirKey,
    analyze,
    makeMesh,
    normalizeNodeType,
    normalizeLanes,
    parseRouterKey
  } from './lib/model.js';
  import { CHANNEL_COLORS } from './lib/theme.js';
  import { demoEndpoints } from './lib/demo.js';
  import MeshStage from './lib/MeshStage.svelte';
  import TopologyCard from './lib/TopologyCard.svelte';
  import ChannelCard from './lib/ChannelCard.svelte';
  import Inspector from './lib/Inspector.svelte';
  import BottleneckCard from './lib/BottleneckCard.svelte';
  import NodeGlyph from './lib/NodeGlyph.svelte';
  import NumberTween from './lib/NumberTween.svelte';

  const MAX_DIM = 12;
  const fmt = (v, d = 2) => (v ?? 0).toFixed(d);

  let cols = $state(4);
  let rows = $state(4);
  let routing = $state('xy');
  let channels = $state(DEFAULT_CHANNELS.map((c) => ({ ...c, lanes: { ...c.lanes } })));
  let endpoints = $state(demoEndpoints(4, 4, DEFAULT_CHANNELS));
  let activeChannel = $state('REQ');
  let selected = $state({ kind: null, id: null });
  let hovered = $state({ kind: null, id: null });
  let toast = $state('');
  let fileInput;
  let toastTimer;

  let mesh = $derived(makeMesh(cols, rows));
  let analysis = $derived(analyze({ routing, channels, endpoints }));
  let active = $derived(analysis.channels[activeChannel] ?? null);
  let activeCh = $derived(channels.find((c) => c.id === activeChannel) ?? channels[0]);
  let activeColor = $derived(activeCh?.color ?? '#3C6E8F');
  let activeLanes = $derived(normalizeLanes(activeCh?.lanes));
  let laneAxisLabel = $derived(LANE_AXES.find((a) => a.id === activeLanes.axis)?.label ?? 'X');

  let linkViews = $derived(
    mesh.links.map((link) => {
      const abKey = dirKey(link.a, link.b);
      const baKey = dirKey(link.b, link.a);
      const ab = active?.dirPeak.get(abKey);
      const ba = active?.dirPeak.get(baKey);
      return {
        ...link,
        ab: ab?.load ?? 0,
        ba: ba?.load ?? 0,
        abLane: ab?.lane ?? 0,
        baLane: ba?.lane ?? 0,
        abLanes: active?.dirLaneLoad.get(abKey) ?? [],
        baLanes: active?.dirLaneLoad.get(baKey) ?? [],
        abTotal: active?.dirLoad.get(abKey) ?? 0,
        baTotal: active?.dirLoad.get(baKey) ?? 0
      };
    })
  );

  let bottlenecks = $derived(bottlenecksOf(active, 6));

  let insight = $derived.by(() => {
    if (!endpoints.length) return '在任一 Router 上点击，挂载端点后开始注入流量。';
    if (!active || active.totalRate <= 0) {
      if (active && active.endpointRate.size > 0) {
        return '当前注入没有可路由的目标 —— 在端点面板里为每个通道选一个不同的目标。';
      }
      return `${activeChannel} 通道暂无注入 —— 选中端点后拖动滑杆。`;
    }
    const peak = active.peakFrom
      ? `R(${active.peakFrom.x},${active.peakFrom.y}) → R(${active.peakTo.x},${active.peakTo.y})`
      : '—';
    const laneTag = activeLanes.count > 1 ? ` L${active.maxLane}` : '';
    const laneNote = activeLanes.count > 1 ? `${activeLanes.count} lane · ${laneAxisLabel} 选择` : '单 lane';
    const unit = activeLanes.count > 1 ? '条 lane' : '条链路';
    if (active.overCount === 0) {
      return `${activeChannel} 通道（${laneNote}）无超额，峰值 ${peak}${laneTag} 为 ${fmt(active.maxLoad)}×。`;
    }
    return `${activeChannel} 通道（${laneNote}）有 ${active.overCount} ${unit} 超过带宽，最热 ${peak}${laneTag} 已达 ${fmt(active.maxLoad)}×。`;
  });

  function handleSelect(kind, id) {
    if (kind === 'add') {
      const { x, y } = parseRouterKey(id);
      addEndpoint(x, y);
      return;
    }
    selected = { kind: kind ?? null, id: id ?? null };
  }

  function handleHover(kind, id) {
    hovered = { kind: kind ?? null, id: id ?? null };
  }

  function repairTargets(list, chs = channels) {
    const ids = new Set(list.map((e) => e.id));
    for (const ep of list) {
      ep.flows ??= {};
      for (const ch of chs) {
        if (!Array.isArray(ep.flows[ch.id])) ep.flows[ch.id] = [];
        const flows = ep.flows[ch.id];
        for (const flow of flows) {
          if (flow.target === -1) continue;
          if (flow.target !== ep.id && ids.has(flow.target)) continue;
          const taken = new Set(flows.filter((f) => f !== flow).map((f) => f.target));
          const candidates = list.filter((t) => t.id !== ep.id);
          const other = candidates.find((t) => !taken.has(t.id)) ?? candidates[0];
          flow.target = other ? other.id : -1;
        }
      }
    }
  }

  function setDims(nextCols, nextRows) {
    const c = clamp(nextCols, 1, MAX_DIM);
    const r = clamp(nextRows, 1, MAX_DIM);
    if (c === cols && r === rows) return;
    cols = c;
    rows = r;
    const next = endpoints.filter((e) => e.x < c && e.y < r);
    repairTargets(next);
    endpoints = next;
    hovered = { kind: null, id: null };
    if (selected.kind === 'endpoint' && !endpoints.some((e) => e.id === selected.id)) {
      selected = { kind: null, id: null };
    }
    if (selected.kind === 'router') {
      const { x, y } = parseRouterKey(selected.id);
      if (x >= c || y >= r) selected = { kind: null, id: null };
    }
    if (selected.kind === 'link') {
      const [axis, coords] = selected.id.split(':');
      const [x, y] = coords.split(',').map(Number);
      const valid = axis === 'h' ? x < c - 1 && y < r : x < c && y < r - 1;
      if (!valid) selected = { kind: null, id: null };
    }
  }

  function setRouting(next) {
    routing = next;
  }

  function setLanes(id, next) {
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    ch.lanes = normalizeLanes(next);
  }

  function setChannel(id) {
    activeChannel = id;
  }

  function addChannel() {
    let n = channels.length + 1;
    let id = `CH${n}`;
    while (channels.some((c) => c.id === id)) {
      n += 1;
      id = `CH${n}`;
    }
    const color = CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length];
    channels = [...channels, { id, color, lanes: { ...DEFAULT_LANES } }];
    for (const ep of endpoints) {
      ep.flows ??= {};
      ep.flows[id] = [{ target: endpoints.find((t) => t.id !== ep.id)?.id ?? -1, rate: 0 }];
    }
    activeChannel = id;
  }

  function removeChannel(id) {
    if (channels.length <= 1) return;
    channels = channels.filter((c) => c.id !== id);
    for (const ep of endpoints) delete ep.flows?.[id];
    if (activeChannel === id) activeChannel = channels[0].id;
  }

  function addEndpoint(x, y) {
    const used = new Set(endpoints.filter((e) => e.x === x && e.y === y).map((e) => e.slot ?? 0));
    let slot = 0;
    while (used.has(slot) && slot < 4) slot += 1;
    if (slot >= 4) {
      showToast('该 Router 的 4 个槽位已满');
      return;
    }
    const id = endpoints.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    const partner = endpoints.find((e) => !(e.x === x && e.y === y)) ?? endpoints[0];
    const flows = {};
    for (const ch of channels) {
      flows[ch.id] = [{ target: partner?.id ?? -1, rate: ch.id === activeChannel && partner ? 0.1 : 0 }];
    }
    endpoints.push({ id, x, y, slot, type: DEFAULT_NODE_TYPE, flows });
    selected = { kind: 'endpoint', id };
  }

  function removeEndpoint(id) {
    endpoints = endpoints.filter((e) => e.id !== id);
    repairTargets(endpoints);
    if (selected.kind === 'endpoint' && selected.id === id) selected = { kind: null, id: null };
  }

  function loadDemo() {
    endpoints = demoEndpoints(cols, rows, channels);
    selected = { kind: null, id: null };
    hovered = { kind: null, id: null };
    showToast('已重新生成示例流量');
  }

  function showToast(message) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2600);
  }

  function exportJSON() {
    const payload = {
      version: 5,
      cols,
      rows,
      routing,
      channels: $state.snapshot(channels),
      endpoints: $state.snapshot(endpoints)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `noc-atlas-${cols}x${rows}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('配置已导出');
  }

  async function handleFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.channels) || !data.channels.length || !Array.isArray(data.endpoints)) {
        throw new Error('缺少 channels 或 endpoints');
      }
      const c = clamp(Number(data.cols) || 4, 1, MAX_DIM);
      const r = clamp(Number(data.rows) || 4, 1, MAX_DIM);
      // v5 keeps lanes on each channel; older files carried one global setting
      const globalLanes = data.lanes;
      const nextChannels = data.channels.map((ch) => ({
        id: String(ch.id ?? 'CH'),
        color: ch.color || CHANNEL_COLORS[0],
        lanes: normalizeLanes(ch.lanes ?? globalLanes)
      }));
      const nextEndpoints = data.endpoints.map((ep, index) => {
        const flows = {};
        for (const ch of nextChannels) {
          const raw = ep.flows?.[ch.id];
          if (Array.isArray(raw)) {
            flows[ch.id] = raw.slice(0, 8).map((flow) => ({
              target: Number.isFinite(Number(flow.target)) ? Number(flow.target) : -1,
              rate: clamp(Number(flow.rate) || 0, 0, 1)
            }));
          } else {
            // v1 files carried a single target/rate pair per channel
            const target = Number(ep.target?.[ch.id]);
            flows[ch.id] = [
              {
                target: Number.isFinite(target) ? target : -1,
                rate: clamp(Number(ep.inject?.[ch.id]) || 0, 0, 1)
              }
            ];
          }
        }
        return {
          id: Number(ep.id) || index + 1,
          x: clamp(Number(ep.x) || 0, 0, c - 1),
          y: clamp(Number(ep.y) || 0, 0, r - 1),
          slot: Number(ep.slot) || 0,
          type: normalizeNodeType(ep.type),
          flows
        };
      });
      repairTargets(nextEndpoints, nextChannels);
      cols = c;
      rows = r;
      routing = data.routing === 'yx' ? 'yx' : 'xy';
      channels = nextChannels;
      endpoints = nextEndpoints;
      activeChannel = nextChannels[0]?.id ?? 'REQ';
      selected = { kind: null, id: null };
      hovered = { kind: null, id: null };
      showToast('配置已载入');
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      input.value = '';
    }
  }

  function handleKey(event) {
    if (event.key === 'Escape') {
      selected = { kind: null, id: null };
      hovered = { kind: null, id: null };
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="app">
  <header class="topbar">
    <div class="brand">
      <svg class="mark" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="9" height="9" rx="2.6" stroke="currentColor" stroke-width="1.2" opacity=".8" />
        <rect x="17.5" y="3.5" width="9" height="9" rx="2.6" stroke="currentColor" stroke-width="1.2" opacity=".8" />
        <rect x="3.5" y="17.5" width="9" height="9" rx="2.6" stroke="currentColor" stroke-width="1.2" opacity=".8" />
        <rect x="17.5" y="17.5" width="9" height="9" rx="2.6" stroke="currentColor" stroke-width="1.2" opacity=".8" />
        <path d="M12.5 8h5M8 12.5v5M22 12.5v5M12.5 22h5" stroke="currentColor" stroke-width="1.1" opacity=".35" />
        <circle cx="8" cy="8" r="1.7" fill="#E3A45F" />
        <circle cx="22" cy="22" r="1.7" fill="#E3A45F" />
      </svg>
      <div class="brand-text">
        <h1 class="display">NoC Traffic Atlas</h1>
        <p class="hand">静态通量分析 · static flow atlas</p>
      </div>
    </div>

    <div class="topbar-right">
      <div class="chips mono">
        <span class="chip">{cols} × {rows} mesh</span>
        <span class="chip">{routing === 'xy' ? 'X-Y' : 'Y-X'} route</span>
        <span class="chip">{activeLanes.count > 1 ? `${activeChannel} ${activeLanes.count}× lane · ${laneAxisLabel}` : `${activeChannel} single lane`}</span>
        <span class="chip">{endpoints.length} endpoints</span>
      </div>
      <div class="actions">
        <button class="tb-btn" onclick={loadDemo}>示例</button>
        <button class="tb-btn" onclick={() => fileInput.click()}>导入</button>
        <button class="tb-btn" onclick={exportJSON}>导出</button>
      </div>
    </div>
  </header>

  <main class="workspace">
    <section class="stage-wrap">
      <div class="stage-top">
        <div class="stage-channel">
          <span class="dot" style:background={activeColor}></span>
          <span class="stage-channel-name">{activeChannel}</span>
          {#if activeLanes.count > 1}
            <span class="lane-badge mono">×{activeLanes.count}</span>
          {/if}
        </div>

        <div class="stage-kpis">
          <div class="kpi" title={activeLanes.count > 1 ? '最热 lane 的负载（每链路并列 K 条 lane）' : '单向链路负载的最大值'}>
            <span class="k">峰值</span>
            <span class="v display"><NumberTween value={active?.maxLoad ?? 0} /><span class="u">×</span></span>
          </div>
          <div
            class="kpi"
            class:over={(active?.overCount ?? 0) > 0}
            title={activeLanes.count > 1 ? '负载超过 1.0× 的单条 lane 数量' : '负载超过 1.0× 的链路数量'}
          >
            <span class="k">超额</span>
            <span class="v display"><NumberTween value={active?.overCount ?? 0} digits={0} /><span class="u">条</span></span>
          </div>
          <div class="kpi kpi-optional" title="按注入率加权的平均跳数">
            <span class="k">跳数</span>
            <span class="v display"><NumberTween value={active?.avgHops ?? 0} digits={1} /><span class="u">hop</span></span>
          </div>
          <div class="kpi kpi-optional" title="每跳 2 周期，并叠加 M/M/1 排队项">
            <span class="k">延迟</span>
            <span class="v display"><NumberTween value={active?.avgLatency ?? 0} digits={1} /><span class="u">cyc</span></span>
          </div>
        </div>
      </div>

      <div class="stage-canvas">
        <MeshStage
          {cols}
          {rows}
          links={linkViews}
          {endpoints}
          {channels}
          {activeChannel}
          {activeColor}
          {active}
          {selected}
          {hovered}
          onSelect={handleSelect}
          onHover={handleHover}
        />
      </div>

      <div class="stage-bottom">
        <div class="legend">
          <div class="legend-head">
            <span class="legend-title">{activeLanes.count > 1 ? 'lane 负载' : '链路负载'}</span>
            <span class="legend-unit mono">× 带宽</span>
          </div>
          <div class="legend-track"></div>
          <div class="legend-ticks mono">
            <span class="t0">0</span>
            <span class="t50">0.5</span>
            <span class="t100">1.0</span>
          </div>
        </div>

        <footer class="stage-caption">
          <p class="hand">{insight}</p>
          <p class="meta mono">
            {cols} × {rows} MESH · {routing === 'xy' ? 'X-Y' : 'Y-X'} ROUTE ·
            {activeLanes.count > 1 ? `${activeChannel} ${activeLanes.count} LANE ${laneAxisLabel}` : `${activeChannel} SINGLE LANE`} · {endpoints.length} ENDPOINTS ·
            {channels.length} CHANNELS
          </p>
        </footer>
        <div class="node-legend">
          <div class="node-legend-head">
            <span class="legend-title">节点类型</span>
            <span class="legend-unit mono">形状 · 线型</span>
          </div>
          {#each NODE_TYPES as t (t.id)}
            <div class="node-row" title={`${t.id} · ${t.name}`}>
              <NodeGlyph type={t.id} size={13} color="#6a6459" />
              <svg class="dash-line" width="16" height="4" viewBox="0 0 16 4" aria-hidden="true">
                <line
                  x1="1"
                  y1="2"
                  x2="15"
                  y2="2"
                  stroke="#8b8474"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-dasharray={t.dash}
                />
              </svg>
              <span class="mono node-id">{t.id}</span>
              <span class="node-role">{t.role}</span>
            </div>
          {/each}
        </div>
      </div>

      {#if toast}
        <div class="toast mono">{toast}</div>
      {/if}
    </section>

    <aside class="panel">
      <TopologyCard {cols} {rows} {routing} max={MAX_DIM} onDims={setDims} onRouting={setRouting} />
      <ChannelCard
        {channels}
        activeId={activeChannel}
        lanes={activeLanes}
        {analysis}
        onSelect={setChannel}
        onAdd={addChannel}
        onRemove={removeChannel}
        onLanes={(next) => setLanes(activeChannel, next)}
      />
      <Inspector
        selection={selected}
        {endpoints}
        {channels}
        {active}
        {activeChannel}
        onSelect={handleSelect}
        onAddEndpoint={addEndpoint}
        onRemoveEndpoint={removeEndpoint}
      />
      <BottleneckCard items={bottlenecks} {hovered} onHover={handleHover} onSelect={handleSelect} />
      <p class="panel-foot">点击 Router 添加端点 · 滚轮缩放 · 拖动平移 · 双击复位 · Esc 取消选择</p>
    </aside>
  </main>
</div>

<input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={handleFile} />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    min-height: 0;
    background: var(--paper);
  }

  /* ---------- top bar ---------- */
  .topbar {
    position: relative;
    z-index: 20;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    height: 62px;
    padding: 0 20px;
    color: #f3eee3;
    background: #17181a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }

  .topbar::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(110% 200% at 12% -60%, rgba(227, 164, 95, 0.2), transparent 58%),
      radial-gradient(80% 160% at 88% 160%, rgba(80, 122, 118, 0.22), transparent 62%);
  }

  .brand,
  .topbar-right {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
  }

  .brand {
    gap: 11px;
    min-width: 0;
  }

  .mark {
    color: #efe8d9;
    flex: none;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .brand-text h1 {
    font-size: 18px;
    font-weight: 500;
    letter-spacing: 0.012em;
    line-height: 1.2;
    white-space: nowrap;
  }

  .brand-text p {
    font-size: 12px;
    line-height: 1;
    color: rgba(243, 238, 227, 0.52);
  }

  .topbar-right {
    gap: 14px;
  }

  .chips {
    display: flex;
    gap: 6px;
  }

  .chip {
    padding: 4px 9px;
    font-size: 10px;
    letter-spacing: 0.03em;
    color: rgba(243, 238, 227, 0.66);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 999px;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .tb-btn {
    padding: 6px 11px;
    font-size: 11.5px;
    color: rgba(243, 238, 227, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    transition: background 0.16s var(--ease), border-color 0.16s var(--ease);
  }

  .tb-btn:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.26);
  }

  /* ---------- workspace ---------- */
  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(360px, 28vw, 416px);
  }

  .stage-wrap {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: #f7f3ea;
    background-image:
      radial-gradient(circle at 50% 46%, rgba(255, 253, 247, 0.95) 0%, rgba(255, 253, 247, 0) 62%),
      radial-gradient(rgba(158, 145, 121, 0.2) 0.7px, transparent 0.7px);
    background-size: 100% 100%, 18px 18px;
    box-shadow: inset 0 0 140px rgba(176, 159, 124, 0.1);
  }

  .stage-top {
    position: relative;
    z-index: 12;
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 15px 18px 6px;
    pointer-events: none;
  }

  .stage-top > * {
    pointer-events: auto;
  }

  .stage-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .stage-bottom {
    position: relative;
    z-index: 12;
    flex: none;
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr) 168px;
    align-items: end;
    gap: 16px;
    padding: 8px 18px 15px;
    pointer-events: none;
  }

  .stage-bottom > * {
    pointer-events: auto;
  }

  .stage-channel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(255, 253, 248, 0.86);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    border-radius: 999px;
    box-shadow: var(--shadow-sm);
  }

  .stage-channel-name {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: var(--ink-2);
  }

  .lane-badge {
    padding: 1px 5px;
    font-size: 9px;
    color: var(--accent);
    background: var(--accent-2);
    border-radius: 4px;
  }

  .stage-kpis {
    display: flex;
    align-items: stretch;
    padding: 8px 4px 9px;
    background: rgba(255, 253, 248, 0.86);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 12px;
    border-left: 1px solid var(--line-2);
  }

  .kpi:first-child {
    border-left: 0;
  }

  .kpi .k {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .kpi .v {
    font-size: 19px;
    line-height: 1.1;
    color: var(--ink);
    white-space: nowrap;
  }

  .kpi .u {
    margin-left: 1px;
    font-size: 9.5px;
    color: var(--muted);
  }

  .kpi.over .v {
    color: var(--ember);
  }

  .legend {
    width: 168px;
    padding: 9px 11px 8px;
    background: rgba(255, 253, 248, 0.86);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
  }

  .node-legend {
    width: 168px;
    padding: 9px 11px 8px;
    background: rgba(255, 253, 248, 0.86);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-sm);
  }

  .node-legend-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 5px;
  }

  .node-row {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 15px;
  }

  .dash-line {
    flex: none;
    color: #8b8474;
  }

  .node-id {
    font-size: 8.5px;
    letter-spacing: 0.02em;
    color: var(--ink-3);
  }

  .node-role {
    margin-left: auto;
    font-size: 8px;
    color: #a9a190;
    white-space: nowrap;
  }

  .legend-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 6px;
  }

  .legend-title {
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .legend-unit {
    font-size: 9px;
    color: #aaa290;
  }

  .legend-track {
    position: relative;
    height: 7px;
    border-radius: 4px;
    background: linear-gradient(90deg, #d8d2c5, #dcc08c 18%, #e2a25f 42%, #ce7645 62%, #ae4f34 82%, #75302c);
  }

  .legend-track::after {
    content: '';
    position: absolute;
    top: -3px;
    bottom: -3px;
    left: 83.3%;
    width: 1px;
    background: rgba(27, 28, 30, 0.4);
  }

  .legend-ticks {
    position: relative;
    height: 11px;
    margin-top: 3px;
    font-size: 8.5px;
    color: #a9a190;
  }

  .legend-ticks span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
  }

  .legend-ticks .t0 {
    left: 0;
    transform: none;
  }

  .legend-ticks .t50 {
    left: 41.7%;
  }

  .legend-ticks .t100 {
    left: 83.3%;
  }

  .stage-caption {
    max-width: 560px;
    margin: 0 auto;
    text-align: center;
    pointer-events: none;
    padding-bottom: 2px;
  }

  .stage-caption .hand {
    font-size: 14.5px;
    line-height: 1.55;
    color: #6a6459;
    text-shadow: 0 1px 0 rgba(255, 253, 247, 0.85);
  }

  .stage-caption .meta {
    margin-top: 5px;
    font-size: 9px;
    letter-spacing: 0.09em;
    color: #a49c8b;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 92px;
    transform: translateX(-50%);
    padding: 7px 14px;
    font-size: 11px;
    color: #f3eee3;
    background: rgba(23, 24, 26, 0.9);
    border-radius: 999px;
    box-shadow: 0 8px 20px -12px rgba(0, 0, 0, 0.6);
    animation: toast-in 0.22s var(--ease) backwards;
    pointer-events: none;
  }

  /* ---------- panel ---------- */
  .panel {
    min-height: 0;
    overflow-y: auto;
    padding: 14px 0 22px;
    background: linear-gradient(180deg, #f4eee2, #f7f3ea 46%);
    border-left: 1px solid var(--line);
    scrollbar-width: thin;
    scrollbar-color: #d8cfbe transparent;
  }

  .panel::-webkit-scrollbar {
    width: 8px;
  }

  .panel::-webkit-scrollbar-thumb {
    background: #ded5c4;
    border: 2px solid transparent;
    border-radius: 8px;
    background-clip: content-box;
  }

  .panel-foot {
    margin: 6px 20px 0;
    font-size: 10.5px;
    line-height: 1.7;
    color: #a8a091;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }

  @media (max-width: 1320px) {
    .kpi-optional {
      display: none;
    }
  }

  @media (max-width: 1180px) {
    .chips {
      display: none;
    }
  }

  @media (max-width: 920px) {
    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(360px, 62vh) auto;
      overflow-y: auto;
    }

    .panel {
      border-left: 0;
      border-top: 1px solid var(--line);
      overflow: visible;
    }

    .stage-top {
      padding: 12px 16px 4px;
    }

    .stage-bottom {
      grid-template-columns: minmax(0, 1fr);
      padding: 6px 16px 12px;
    }

    .stage-caption .hand {
      font-size: 13.5px;
    }

    .legend {
      display: none;
    }

    .node-legend {
      display: none;
    }
  }
</style>
