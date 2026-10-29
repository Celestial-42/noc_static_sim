export const DEFAULT_CHANNELS = [
  { id: 'REQ', color: '#3C6E8F' },
  { id: 'RSP', color: '#5C8A6B' },
  { id: 'SNP', color: '#B0793C' },
  { id: 'DAT', color: '#8A5A8F' }
];

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const endpointLabel = (id) => `E${String(id).padStart(2, '0')}`;

export const routerKey = (x, y) => `${x},${y}`;

export function parseRouterKey(key) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function makeMesh(cols, rows) {
  const routers = [];
  const links = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      routers.push({ id: routerKey(x, y), x, y });
      if (x < cols - 1) {
        links.push({ id: `h:${x},${y}`, axis: 'h', a: { x, y }, b: { x: x + 1, y } });
      }
      if (y < rows - 1) {
        links.push({ id: `v:${x},${y}`, axis: 'v', a: { x, y }, b: { x, y: y + 1 } });
      }
    }
  }
  return { routers, links };
}

export const dirKey = (a, b) => `${a.x},${a.y}>${b.x},${b.y}`;

export function dirParts(key) {
  const [from, to] = key.split('>');
  return { from: parseRouterKey(from), to: parseRouterKey(to) };
}

export function undirectedKey(a, b) {
  if (a.y === b.y) return `h:${Math.min(a.x, b.x)},${a.y}`;
  return `v:${a.x},${Math.min(a.y, b.y)}`;
}

export function pathHops(from, to, routing = 'xy') {
  const hops = [];
  let x = from.x;
  let y = from.y;

  const moveX = () => {
    while (x !== to.x) {
      const nx = x + Math.sign(to.x - x);
      hops.push({ from: { x, y }, to: { x: nx, y } });
      x = nx;
    }
  };

  const moveY = () => {
    while (y !== to.y) {
      const ny = y + Math.sign(to.y - y);
      hops.push({ from: { x, y }, to: { x, y: ny } });
      y = ny;
    }
  };

  if (routing === 'yx') {
    moveY();
    moveX();
  } else {
    moveX();
    moveY();
  }
  return hops;
}

/** A channel may carry several flows out of one endpoint: each has its own target and rate. */
export function channelFlows(ep, chId) {
  const list = ep?.flows?.[chId];
  return Array.isArray(list) ? list : [];
}

export function channelRate(ep, chId) {
  let sum = 0;
  for (const flow of channelFlows(ep, chId)) sum += Number(flow.rate) || 0;
  return sum;
}

/** Duplicate-lane configuration: K parallel rails per physical link. */
export const LANE_OPTIONS = [1, 2, 4];

export const LANE_AXES = [
  { id: 'xid', label: 'X', name: 'target xid bit0' },
  { id: 'yid', label: 'Y', name: 'target yid bit0' },
  { id: 'xor', label: 'XOR', name: 'src^tgt 均匀异或' }
];

export const DEFAULT_LANES = { count: 1, axis: 'xid' };

export function normalizeLaneCount(value) {
  const n = Math.round(Number(value) || 1);
  if (n <= 1) return 1;
  return n <= 2 ? 2 : 4;
}

export function normalizeLaneAxis(value) {
  return LANE_AXES.some((a) => a.id === value) ? value : 'xid';
}

/** lane = coordinate & (K-1); a flow keeps one lane on every hop of its route. */
export function laneIdFor(axis, count, src, tgt) {
  const k = normalizeLaneCount(count);
  if (k === 1) return 0;
  const mask = k - 1;
  let coord;
  if (axis === 'yid') coord = tgt.y;
  else if (axis === 'xor') coord = tgt.x ^ tgt.y ^ src.x ^ src.y;
  else coord = tgt.x;
  return coord & mask;
}

/**
 * Static traffic analysis.
 * Each endpoint emits zero or more flows per channel; a flow injects `rate`
 * (fraction of one link's bandwidth) toward its target. Every flow follows the
 * configured dimension-order route, and its rate is accumulated on each
 * traversed directional link.
 *
 * With duplicate lanes (K > 1) every link carries K rails: a flow sticks to one
 * lane for its whole route, so the load that matters per rail is the per-lane
 * load, not the aggregate on the physical link.
 */
export function analyze({ routing, channels, endpoints, lanes }) {
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  const laneCount = normalizeLaneCount(lanes?.count);
  const laneAxis = normalizeLaneAxis(lanes?.axis);
  const byChannel = {};

  for (const ch of channels) {
    const dirLoad = new Map();
    const dirLaneLoad = new Map();
    const dirFlows = new Map();
    const flows = [];
    const flowsByEndpoint = new Map();
    const endpointRate = new Map();

    const record = (flow) => {
      flows.push(flow);
      const list = flowsByEndpoint.get(flow.endpointId);
      if (list) list.push(flow);
      else flowsByEndpoint.set(flow.endpointId, [flow]);
    };

    for (const ep of endpoints) {
      let injected = 0;
      for (const spec of channelFlows(ep, ch.id)) {
        const rate = Number(spec.rate) || 0;
        if (rate <= 0) continue;
        injected += rate;

        const target = byId.get(spec.target);
        if (!target || target.id === ep.id) continue;

        const lane = laneIdFor(laneAxis, laneCount, ep, target);

        if (target.x === ep.x && target.y === ep.y) {
          record({ endpointId: ep.id, targetId: target.id, rate, lane, hops: [], hopKeys: [], latency: 0, local: true });
          continue;
        }

        const hops = pathHops(ep, target, routing);
        const hopKeys = hops.map((h) => dirKey(h.from, h.to));
        for (const key of hopKeys) {
          dirLoad.set(key, (dirLoad.get(key) || 0) + rate);
          let laneArr = dirLaneLoad.get(key);
          if (!laneArr) {
            laneArr = new Array(laneCount).fill(0);
            dirLaneLoad.set(key, laneArr);
          }
          laneArr[lane] += rate;
          const list = dirFlows.get(key);
          const entry = { from: ep.id, to: target.id, rate, lane };
          if (list) list.push(entry);
          else dirFlows.set(key, [entry]);
        }

        record({ endpointId: ep.id, targetId: target.id, rate, lane, hops, hopKeys, latency: 0, local: false });
      }
      if (injected > 0) endpointRate.set(ep.id, injected);
    }

    let totalRate = 0;
    let weighted = 0;
    let weightedHops = 0;
    let weightedLatency = 0;

    for (const flow of flows) {
      totalRate += flow.rate;
      if (flow.local) continue;
      weighted += flow.rate;
      weightedHops += flow.rate * flow.hops.length;
      let latency = 0;
      for (const key of flow.hopKeys) {
        const laneArr = dirLaneLoad.get(key);
        const load = Math.min(laneArr ? laneArr[flow.lane] : 0, 0.97);
        // 2 cycles of pipeline per hop, plus an M/M/1 style queueing term
        latency += 2 + load / (1 - load);
      }
      flow.latency = latency;
      weightedLatency += flow.rate * latency;
    }

    const routerOut = new Map();
    let maxLoad = 0;
    let maxKey = null;
    let peakLane = 0;
    let overCount = 0;
    const dirPeak = new Map();

    for (const [key, laneArr] of dirLaneLoad) {
      let peak = 0;
      let lane = 0;
      for (let i = 0; i < laneArr.length; i++) {
        const load = laneArr[i];
        if (load > peak) {
          peak = load;
          lane = i;
        }
        if (load > 1.0001) overCount++;
      }
      dirPeak.set(key, { load: peak, lane });

      const { from } = dirParts(key);
      const rk = routerKey(from.x, from.y);
      routerOut.set(rk, (routerOut.get(rk) || 0) + peak);

      if (peak > maxLoad) {
        maxLoad = peak;
        maxKey = key;
        peakLane = lane;
      }
    }

    const peak = maxKey ? dirParts(maxKey) : null;

    byChannel[ch.id] = {
      id: ch.id,
      flows,
      flowsByEndpoint,
      endpointRate,
      dirLoad,
      dirLaneLoad,
      dirPeak,
      dirFlows,
      routerOut,
      totalRate,
      avgHops: weighted ? weightedHops / weighted : 0,
      avgLatency: weighted ? weightedLatency / weighted : 0,
      laneCount,
      laneAxis,
      maxLoad,
      maxKey,
      maxLane: peakLane,
      peakFrom: peak?.from ?? null,
      peakTo: peak?.to ?? null,
      overCount
    };
  }

  return { channels: byChannel };
}

export function bottlenecksOf(analysisChannel, limit = 6) {
  if (!analysisChannel) return [];
  return [...analysisChannel.dirPeak.entries()]
    .map(([key, { load, lane }]) => {
      const { from, to } = dirParts(key);
      return {
        key,
        load,
        lane,
        laneLoads: analysisChannel.dirLaneLoad.get(key) || [],
        total: analysisChannel.dirLoad.get(key) || 0,
        from,
        to,
        linkId: undirectedKey(from, to)
      };
    })
    .sort((a, b) => b.load - a.load)
    .slice(0, limit);
}
