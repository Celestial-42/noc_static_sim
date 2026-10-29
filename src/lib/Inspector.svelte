<script>
  import { channelFlows, channelRate, dirKey, endpointLabel, laneIdFor, parseRouterKey, routerKey } from './model.js';

  let {
    selection,
    endpoints,
    channels,
    active,
    activeChannel,
    onSelect,
    onAddEndpoint,
    onRemoveEndpoint
  } = $props();

  const SLOT_NAMES = ['左上', '右上', '右下', '左下'];

  let endpoint = $derived.by(() =>
    selection.kind === 'endpoint' ? endpoints.find((e) => e.id === selection.id) ?? null : null
  );

  let router = $derived.by(() => (selection.kind === 'router' ? parseRouterKey(selection.id) : null));

  let linkInfo = $derived.by(() => {
    if (selection.kind !== 'link') return null;
    const [axis, coords] = selection.id.split(':');
    const [x, y] = coords.split(',').map(Number);
    const a = { x, y };
    const b = axis === 'h' ? { x: x + 1, y } : { x, y: y + 1 };
    const dir = (from, to) => {
      const key = dirKey(from, to);
      const peak = active?.dirPeak.get(key);
      return {
        load: peak?.load ?? 0,
        lane: peak?.lane ?? 0,
        lanes: active?.dirLaneLoad.get(key) ?? [],
        total: active?.dirLoad.get(key) ?? 0,
        flows: active?.dirFlows.get(key) ?? []
      };
    };
    return {
      a,
      b,
      lanes: active?.laneCount ?? 1,
      ab: dir(a, b),
      ba: dir(b, a)
    };
  });

  let endpointStats = $derived.by(() => {
    if (!endpoint || !active) return null;
    const routed = (active.flowsByEndpoint.get(endpoint.id) ?? []).filter((flow) => !flow.local);
    const weight = routed.reduce((sum, flow) => sum + flow.rate, 0);
    const avg = (pick) => (weight > 0 ? routed.reduce((sum, flow) => sum + flow.rate * pick(flow), 0) / weight : 0);
    return {
      rate: active.endpointRate.get(endpoint.id) ?? 0,
      flows: routed.length,
      hops: avg((flow) => flow.hops.length),
      latency: avg((flow) => flow.latency)
    };
  });

  function addFlow(chId) {
    if (!endpoint) return;
    endpoint.flows ??= {};
    const list = (endpoint.flows[chId] ??= []);
    const used = new Set(list.map((flow) => flow.target));
    const pick =
      endpoints.find((t) => t.id !== endpoint.id && !used.has(t.id)) ??
      endpoints.find((t) => t.id !== endpoint.id);
    list.push({ target: pick?.id ?? -1, rate: 0.1 });
  }

  function removeFlow(chId, index) {
    endpoint?.flows?.[chId]?.splice(index, 1);
  }

  function targetOptions(index, chId) {
    if (!endpoint) return [];
    const list = channelFlows(endpoint, chId);
    const taken = new Set(list.filter((_, i) => i !== index).map((flow) => flow.target));
    const own = list[index]?.target;
    return endpoints.filter((t) => t.id !== endpoint.id && (t.id === own || !taken.has(t.id)));
  }

  function laneOf(flow) {
    if (!endpoint || !active || active.laneCount <= 1 || flow.target === -1) return null;
    const target = endpoints.find((e) => e.id === flow.target);
    return target ? laneIdFor(active.laneAxis, active.laneCount, endpoint, target) : null;
  }

  let routerSlots = $derived.by(() => {
    if (!router) return [];
    return [0, 1, 2, 3].map((slot) => ({
      slot,
      endpoint: endpoints.find((e) => e.x === router.x && e.y === router.y && e.slot === slot) ?? null
    }));
  });

  let routerOut = $derived(router && active ? active.routerOut.get(routerKey(router.x, router.y)) ?? 0 : 0);

  let topEndpoints = $derived.by(() => {
    if (!active) return [];
    return [...active.endpointRate.entries()]
      .map(([id, rate]) => ({ id, rate, ep: endpoints.find((e) => e.id === id) }))
      .filter((d) => d.ep)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  });

  const title = $derived(endpoint ? '端点' : router ? '路由器' : linkInfo ? '链路' : '选择');
</script>

<section class="card">
  <header class="card-head">
    <span class="num">03</span>
    <h2>{title}</h2>
    <span class="rule"></span>
    {#if endpoint || router || linkInfo}
      <button class="clear" onclick={() => onSelect(null, null)}>取消</button>
    {/if}
  </header>

  {#if endpoint}
    <div class="subject">
      <span class="badge mono">{endpointLabel(endpoint.id)}</span>
      <span class="subject-meta">Router ({endpoint.x},{endpoint.y}) · {SLOT_NAMES[(endpoint.slot ?? 0) % 4]}</span>
    </div>

    {#if endpointStats}
      <div class="sub-stats">
        <div><span class="k">出向</span><span class="v mono">{endpointStats.rate.toFixed(2)}×</span></div>
        <div><span class="k">流数</span><span class="v mono">{endpointStats.flows}</span></div>
        <div><span class="k">跳数</span><span class="v mono">{endpointStats.hops.toFixed(1)}<span class="u">hop</span></span></div>
        <div><span class="k">估算</span><span class="v mono">{endpointStats.latency.toFixed(1)}<span class="u">cyc</span></span></div>
      </div>
    {/if}

    <div class="ch-editors">
      {#each channels as ch (ch.id)}
        {@const list = endpoint.flows?.[ch.id] ?? []}
        {@const sum = channelRate(endpoint, ch.id)}
        <div class="ch-editor">
          <div class="ch-editor-head">
            <span class="dot" style:background={ch.color}></span>
            <span class="ch-name mono">{ch.id}</span>
            <span class="ch-count mono">{list.length} 流</span>
            <span class="ch-rate mono">{sum.toFixed(2)}×</span>
          </div>
          {#each list as flow, index (flow)}
            {@const lane = laneOf(flow)}
            <div class="flow-row" class:has-lane={lane !== null}>
              <select class="select" bind:value={flow.target} aria-label={`${ch.id} 第 ${index + 1} 条流目标`}>
                <option value={-1}>— 无目标 —</option>
                {#each targetOptions(index, ch.id) as t (t.id)}
                  <option value={t.id}>{endpointLabel(t.id)} · R({t.x},{t.y})</option>
                {/each}
              </select>
              {#if lane !== null}
                <span class="flow-lane mono" title={`lane = ${lane}（K=${active.laneCount} · ${active.laneAxis}）`}>L{lane}</span>
              {/if}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                bind:value={flow.rate}
                style={`--ch:${ch.color};--p:${Math.round((Number(flow.rate) || 0) * 100)}%`}
                aria-label={`${ch.id} 第 ${index + 1} 条流注入率`}
              />
              <span class="flow-rate mono">{(Number(flow.rate) || 0).toFixed(2)}</span>
              <button class="flow-del" onclick={() => removeFlow(ch.id, index)} aria-label={`删除 ${ch.id} 第 ${index + 1} 条流`}>×</button>
            </div>
          {:else}
            <p class="flow-empty">该通道暂无流</p>
          {/each}
          <button class="flow-add" onclick={() => addFlow(ch.id)} disabled={endpoints.length < 2}>＋ 添加流</button>
        </div>
      {/each}
    </div>

    <button class="btn danger remove" onclick={() => onRemoveEndpoint(endpoint.id)}>删除该端点</button>
  {:else if router}
    <div class="subject">
      <span class="badge mono">R{router.x},{router.y}</span>
      <span class="subject-meta">出向负载 {routerOut.toFixed(2)}×</span>
    </div>

    <div class="slots">
      {#each routerSlots as slot (slot.slot)}
        <div class="slot" class:filled={!!slot.endpoint}>
          <span class="slot-name">{SLOT_NAMES[slot.slot]}</span>
          {#if slot.endpoint}
            {@const rate = channelRate(slot.endpoint, activeChannel)}
            <button class="slot-btn" onclick={() => onSelect('endpoint', slot.endpoint.id)}>
              <span class="mono">{endpointLabel(slot.endpoint.id)}</span>
              <span class="mono slot-rate">{rate.toFixed(2)}×</span>
            </button>
          {:else}
            <button class="slot-btn empty" onclick={() => onAddEndpoint(router.x, router.y)}>＋ 添加端点</button>
          {/if}
        </div>
      {/each}
    </div>
    <p class="card-note">每个 Router 最多挂载 4 个端点，点击空位即可创建。</p>
  {:else if linkInfo}
    <div class="subject">
      <span class="badge mono">R({linkInfo.a.x},{linkInfo.a.y}) ↔ R({linkInfo.b.x},{linkInfo.b.y})</span>
      {#if linkInfo.lanes > 1}
        <span class="subject-meta mono">×{linkInfo.lanes} lane</span>
      {/if}
    </div>

    {#each [{ dir: linkInfo.ab, from: linkInfo.a, to: linkInfo.b, tag: '正向' }, { dir: linkInfo.ba, from: linkInfo.b, to: linkInfo.a, tag: '反向' }] as row (row.tag)}
      {@const dir = row.dir}
      <div class="dir">
        <div class="dir-head">
          <span class="dir-tag">{row.tag}</span>
          <span class="subject-meta mono">R({row.from.x},{row.from.y}) → R({row.to.x},{row.to.y})</span>
          {#if linkInfo.lanes > 1}
            <span class="peak-lane mono">L{dir.lane}</span>
          {/if}
          <span class="mono dir-val">{dir.load.toFixed(2)}×</span>
        </div>
        <div class="bar"><span style:width={`${Math.min(100, (dir.load / 1.2) * 100)}%`} style:background={dir.load > 1 ? '#B4543A' : '#7E9C90'}></span></div>
        {#if linkInfo.lanes > 1}
          <div class="dir-lanes">
            {#each dir.lanes as load, lane (lane)}
              <span class="lane-chip mono" class:hot={load > 0 && load >= dir.load}>L{lane} {load.toFixed(2)}</span>
            {/each}
            <span class="lane-total mono">合计 {dir.total.toFixed(2)}×</span>
          </div>
        {/if}
        <div class="flows">
          {#each dir.flows.slice(0, 4) as flow}
            <span class="mono flow">
              {endpointLabel(flow.from)} → {endpointLabel(flow.to)} · {flow.rate.toFixed(2)}{linkInfo.lanes > 1 ? ` · L${flow.lane}` : ''}
            </span>
          {:else}
            <span class="mono flow muted">无经过流量</span>
          {/each}
          {#if dir.flows.length > 4}
            <span class="mono flow muted">+{dir.flows.length - 4}</span>
          {/if}
        </div>
      </div>
    {/each}
  {:else}
    <p class="empty-title hand">点击任意 Router 或端点</p>
    <p class="empty-copy">
      画布上的虚线空位可以直接创建端点。选中后在这里调节注入率与目标，右侧指标会即时更新。
    </p>

    {#if topEndpoints.length}
      <div class="top-list">
        <span class="field-label">注入最高</span>
        {#each topEndpoints as d (d.id)}
          <button class="top-row" onclick={() => onSelect('endpoint', d.id)}>
            <span class="mono">{endpointLabel(d.id)}</span>
            <span class="mono top-where">R({d.ep.x},{d.ep.y})</span>
            <span class="mono top-rate">{d.rate.toFixed(2)}×</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .clear {
    font-size: 10.5px;
    color: var(--muted);
    padding: 2px 6px;
    border-radius: 6px;
    transition: background 0.16s var(--ease), color 0.16s var(--ease);
  }

  .clear:hover {
    background: var(--paper-2);
    color: var(--ink-2);
  }

  .subject {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 12px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 9px;
    font-size: 11.5px;
    color: var(--accent);
    background: var(--accent-2);
    border: 1px solid #cfe0da;
    border-radius: 8px;
    letter-spacing: 0.02em;
  }

  .subject-meta {
    font-size: 11px;
    color: var(--muted);
  }

  .sub-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-bottom: 12px;
  }

  .sub-stats div {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 7px 8px;
    background: #fbf7ef;
    border: 1px solid var(--line-2);
    border-radius: 9px;
  }

  .sub-stats .k {
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .sub-stats .v {
    font-size: 12px;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .sub-stats .u {
    margin-left: 1px;
    font-size: 8.5px;
    color: var(--muted);
  }

  .ch-editors {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ch-editor-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 3px;
  }

  .ch-name {
    font-size: 11px;
    color: var(--ink-2);
    letter-spacing: 0.03em;
  }

  .ch-rate {
    margin-left: auto;
    font-size: 11px;
    color: var(--ink-2);
  }

  .ch-count {
    font-size: 9.5px;
    color: var(--muted);
  }

  .ch-editor select {
    margin-top: 2px;
  }

  .flow-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 26px 14px;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  .flow-row.has-lane {
    grid-template-columns: minmax(0, 1fr) 18px 62px 26px 14px;
  }

  .flow-lane {
    font-size: 9px;
    color: var(--accent);
    text-align: center;
  }

  .flow-row + .flow-row {
    margin-top: 3px;
  }

  .flow-row select {
    margin-top: 0;
    font-size: 10.5px;
    padding-top: 3px;
    padding-bottom: 3px;
  }

  .flow-row input[type='range'] {
    width: 100%;
  }

  .flow-rate {
    font-size: 10px;
    color: var(--ink-2);
    text-align: right;
  }

  .flow-del {
    width: 15px;
    height: 18px;
    font-size: 14px;
    line-height: 1;
    color: #a89e8c;
    border-radius: 4px;
    transition: color 0.16s var(--ease), background 0.16s var(--ease);
  }

  .flow-del:hover {
    color: var(--ember);
    background: #f2e4d5;
  }

  .flow-empty {
    margin-top: 3px;
    font-size: 10.5px;
    color: var(--muted);
  }

  .flow-add {
    margin-top: 5px;
    padding: 2px 6px;
    font-size: 10.5px;
    color: var(--accent);
    border-radius: 6px;
    transition: background 0.16s var(--ease), color 0.16s var(--ease);
  }

  .flow-add:hover:not(:disabled) {
    background: var(--accent-2);
  }

  .flow-add:disabled {
    color: #b8b0a1;
  }

  .remove {
    width: 100%;
    margin-top: 14px;
  }

  .slots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .slot {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 7px 9px 8px;
    border: 1px dashed #ded5c3;
    border-radius: 10px;
    background: #fcf9f2;
  }

  .slot.filled {
    border-style: solid;
    border-color: var(--line-2);
    background: #fbf7ef;
  }

  .slot-name {
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .slot-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11.5px;
    color: var(--ink-2);
    text-align: left;
  }

  .slot-btn.empty {
    justify-content: flex-start;
    color: #a29a89;
    font-size: 11px;
    transition: color 0.16s var(--ease);
  }

  .slot-btn.empty:hover {
    color: var(--accent);
  }

  .slot-rate {
    font-size: 10.5px;
    color: var(--muted);
  }

  .dir + .dir {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--line-2);
  }

  .dir-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 6px;
  }

  .dir-tag {
    flex: none;
    padding: 1px 5px;
    font-size: 9px;
    letter-spacing: 0.04em;
    color: var(--muted);
    background: #f1eadb;
    border-radius: 4px;
  }

  .dir-val {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--ink-2);
  }

  .peak-lane {
    font-size: 9px;
    color: var(--accent);
  }

  .dir-lanes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
  }

  .lane-chip {
    padding: 1px 5px;
    font-size: 9px;
    color: var(--muted);
    background: #f4efe3;
    border-radius: 4px;
  }

  .lane-chip.hot {
    color: var(--ink-2);
    background: #ece2cf;
  }

  .lane-total {
    font-size: 9px;
    color: var(--muted);
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
    transition: width 0.3s var(--ease);
  }

  .flows {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-top: 7px;
  }

  .flow {
    font-size: 10px;
    color: var(--ink-3);
  }

  .flow.muted,
  .muted {
    color: var(--muted);
  }

  .empty-title {
    font-size: 15px;
    color: var(--ink-2);
    margin-bottom: 4px;
  }

  .empty-copy {
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--muted);
  }

  .top-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--line-2);
  }

  .top-list .field-label {
    margin-bottom: 4px;
  }

  .top-row {
    display: grid;
    grid-template-columns: 38px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    font-size: 11px;
    color: var(--ink-2);
    border-radius: 7px;
    transition: background 0.16s var(--ease);
  }

  .top-row:hover {
    background: #faf6ed;
  }

  .top-where {
    font-size: 10px;
    color: var(--muted);
  }

  .top-rate {
    font-size: 10.5px;
  }
</style>
