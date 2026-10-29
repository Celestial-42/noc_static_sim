<script>
  import {
    channelFlows,
    channelRate,
    clamp,
    dirKey,
    endpointLabel,
    nodeDash,
    nodeShapePath,
    nodeTypeOf,
    parseRouterKey,
    routerKey,
    undirectedKey
  } from './model.js';
  import { arrowColor, loadColor, loadOpacity, loadWidth } from './theme.js';

  let {
    cols,
    rows,
    links,
    endpoints,
    channels,
    activeChannel,
    activeColor,
    active,
    selected,
    hovered,
    onSelect,
    onHover
  } = $props();

  const PAD = 76;
  const RS = 23;
  const EP_DIST = 35;
  const SLOT_DIR = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ];

  let step = $derived(cols > 9 || rows > 9 ? 100 : cols > 6 || rows > 6 ? 116 : 132);
  let dense = $derived(cols > 9 || rows > 9);
  let medium = $derived(!dense && (cols > 6 || rows > 6));
  let labelSize = $derived(dense ? 14 : medium ? 11 : 9.5);
  let tickSize = $derived(dense ? 12.5 : medium ? 10.5 : 9);
  let epLabelSize = $derived(dense ? 11 : medium ? 9.5 : 8.5);
  let innerW = $derived((cols - 1) * step);
  let innerH = $derived((rows - 1) * step);
  let W = $derived(Math.max(innerW + PAD * 2, 640));
  let H = $derived(Math.max(innerH + PAD * 2, 520));
  let ox = $derived((W - innerW) / 2);
  let oy = $derived((H - innerH) / 2);

  let laneCount = $derived(active?.laneCount ?? 1);

  const px = (x) => ox + x * step;
  // NoC convention: the origin sits bottom-left, y grows upwards
  const py = (y) => oy + (rows - 1 - y) * step;

  let mouse = $state({ x: 0, y: 0 });
  let stageW = $state(0);
  let stageH = $state(0);
  let pointerInside = $state(false);

  // Wheel zoom + drag pan: content lives in mesh coordinates, the stage only
  // maps them to the screen through `base` (fit) and `zoom`/`pan`.
  let stageEl = $state(null);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let dragging = $state(false);
  let panDrag = null;
  let skipClick = false;

  const MIN_ZOOM = 0.6;
  const MAX_ZOOM = 4;

  let epsByRouter = $derived.by(() => {
    const map = new Map();
    for (const e of endpoints) {
      const key = routerKey(e.x, e.y);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  });

  let hoveredLink = $derived(hovered.kind === 'link' ? links.find((l) => l.id === hovered.id) : null);

  let previewEp = $derived.by(() => {
    if (hovered.kind === 'endpoint') return endpoints.find((e) => e.id === hovered.id) ?? null;
    if (selected.kind === 'endpoint') return endpoints.find((e) => e.id === selected.id) ?? null;
    return null;
  });
  let previewFromHover = $derived(hovered.kind === 'endpoint');

  // Heavier flows get a bolder dash, so a fan-out endpoint reads at a glance
  const pathDashWidth = (rate) => 1.9 + Math.min(Number(rate) || 0, 0.5) * 1.2;

  let previewFlows = $derived.by(() => {
    if (!previewEp || !active) return [];
    return active.flowsByEndpoint.get(previewEp.id) ?? [];
  });

  let pathLinkIds = $derived.by(() => {
    const ids = new Set();
    if (!previewEp || !active) return ids;
    for (const flow of previewFlows) {
      for (const hop of flow.hops) ids.add(undirectedKey(hop.from, hop.to));
    }
    return ids;
  });

  // One endpoint may fan out to several targets, so every routed flow gets its own path
  let pathData = $derived.by(() => {
    if (!previewEp || !active || !previewFlows.length) return null;
    const [dx, dy] = SLOT_DIR[previewEp.slot % 4];
    const ex = px(previewEp.x) + dx * EP_DIST;
    const ey = py(previewEp.y) + dy * EP_DIST;

    const rows = [];
    for (const flow of previewFlows) {
      if (flow.local || !flow.hops.length) continue;
      const d = flow.hops
        .map((hop) => `M ${px(hop.from.x)} ${py(hop.from.y)} L ${px(hop.to.x)} ${py(hop.to.y)}`)
        .join(' ');
      const targetEp = endpoints.find((e) => e.id === flow.targetId);
      const last = flow.hops[flow.hops.length - 1].to;
      const t = targetEp ? epPos(targetEp) : null;
      rows.push({
        d,
        rate: flow.rate,
        tail: t ? { x1: px(last.x), y1: py(last.y), x2: t.x, y2: t.y } : null
      });
    }
    if (!rows.length) return null;

    return {
      stub: {
        x1: ex - dx * 9,
        y1: ey - dy * 9,
        x2: px(previewEp.x),
        y2: py(previewEp.y)
      },
      rows
    };
  });

  let hoverCard = $derived.by(() => {
    if (!hovered.kind) return null;

    if (hovered.kind === 'router') {
      const { x, y } = parseRouterKey(hovered.id);
      const eps = epsByRouter.get(hovered.id) || [];
      const out = active?.routerOut.get(hovered.id) || 0;
      const dirs = [];
      for (const [dx, dy, label] of [
        [1, 0, 'E'],
        [-1, 0, 'W'],
        [0, 1, 'N'],
        [0, -1, 'S']
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const peak = active?.dirPeak.get(`${x},${y}>${nx},${ny}`);
        dirs.push({ label, load: peak?.load ?? 0, lane: peak?.lane ?? 0 });
      }
      return {
        kind: 'router',
        title: `Router ${x},${y}`,
        meta: `${eps.length} 端点 · 出向 ${out.toFixed(2)}×`,
        dirs,
        lanes: active?.laneCount ?? 1
      };
    }

    if (hovered.kind === 'endpoint') {
      const ep = endpoints.find((e) => e.id === hovered.id);
      if (!ep) return null;
      const rows = channels.map((ch) => {
        const list = channelFlows(ep, ch.id);
        return {
          id: ch.id,
          color: ch.color,
          rate: channelRate(ep, ch.id),
          flows: list.length,
          targets: list.filter((f) => (Number(f.rate) || 0) > 0 && f.target !== -1).map((f) => f.target)
        };
      });
      const act = rows.find((row) => row.id === activeChannel);
      const lanes = active?.laneCount ?? 1;
      const laneOfTarget = new Map((active?.flowsByEndpoint.get(ep.id) ?? []).map((f) => [f.targetId, f.lane]));
      let meta = null;
      if (act?.targets.length) {
        const labels = act.targets
          .slice(0, 3)
          .map((id) => (lanes > 1 && laneOfTarget.has(id) ? `${endpointLabel(id)}·L${laneOfTarget.get(id)}` : endpointLabel(id)));
        const extra = act.targets.length > 3 ? ` +${act.targets.length - 3}` : '';
        meta = `${activeChannel} → ${labels.join(' · ')}${extra}`;
      }
      return {
        kind: 'endpoint',
        title: `${endpointLabel(ep.id)} · ${nodeTypeOf(ep.type).id} · R(${ep.x},${ep.y})`,
        meta,
        typeName: nodeTypeOf(ep.type).name,
        rows
      };
    }

    if (hovered.kind === 'link') {
      const link = links.find((l) => l.id === hovered.id);
      if (!link) return null;
      return {
        kind: 'link',
        title: `R(${link.a.x},${link.a.y}) ↔ R(${link.b.x},${link.b.y})`,
        ab: active?.dirPeak.get(dirKey(link.a, link.b))?.load || 0,
        ba: active?.dirPeak.get(dirKey(link.b, link.a))?.load || 0,
        abLane: link.abLane ?? 0,
        baLane: link.baLane ?? 0,
        abLanes: link.abLanes ?? [],
        baLanes: link.baLanes ?? [],
        total: (link.abTotal ?? 0) + (link.baTotal ?? 0),
        lanes: active?.laneCount ?? 1,
        a: link.a,
        b: link.b
      };
    }

    return null;
  });

  const CARD_W = 176;
  const CARD_H = 132;
  const CARD_GAP = 14;
  const CARD_EDGE = 10;

  let cardW = $state(0);
  let cardH = $state(0);

  let base = $derived.by(() => {
    if (!stageW || !stageH) return null;
    const scale = Math.min(stageW / W, stageH / H);
    return { scale, x: (stageW - W * scale) / 2, y: (stageH - H * scale) / 2 };
  });

  let viewport = $derived(
    base
      ? {
          scale: base.scale * zoom,
          x: base.x + base.scale * pan.x,
          y: base.y + base.scale * pan.y
        }
      : null
  );

  function clampPan(next, z = zoom) {
    const maxX = Math.max(0, (W * (z - 1)) / 2) + W * 0.35;
    const maxY = Math.max(0, (H * (z - 1)) / 2) + H * 0.35;
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }

  // Zoom about the cursor: keep the mesh point under the pointer pinned.
  function zoomBy(factor, clientX, clientY) {
    if (!stageEl || !base) return;
    const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - zoom) < 1e-4) return;
    const rect = stageEl.getBoundingClientRect();
    const ux = (clientX - rect.left - base.x) / base.scale - pan.x;
    const uy = (clientY - rect.top - base.y) / base.scale - pan.y;
    pan = clampPan({ x: pan.x + (zoom - next) * ux, y: pan.y + (zoom - next) * uy }, next);
    zoom = next;
  }

  function resetView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
  }

  // A drag begins anywhere, but capture only arms after the pointer really
  // moves, so a plain click still reaches routers, links and endpoints.
  function startPan(event) {
    if (event.button !== 0) return;
    skipClick = false;
    panDrag = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
      pointerId: event.pointerId
    };
  }

  function endPan(event) {
    if (!panDrag) return;
    const moved = panDrag.moved;
    panDrag = null;
    dragging = false;
    if (stageEl?.hasPointerCapture?.(event.pointerId)) {
      stageEl.releasePointerCapture(event.pointerId);
    }
    if (moved) skipClick = true;
  }

  function suppressClick(event) {
    if (!skipClick) return;
    skipClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  $effect(() => {
    if (!stageEl) return;
    const onWheel = (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.006 : 0.0018));
      zoomBy(factor, event.clientX, event.clientY);
    };
    stageEl.addEventListener('wheel', onWheel, { passive: false });
    return () => stageEl.removeEventListener('wheel', onWheel);
  });

  let linkSegs = $derived(
    links.map((l) => ({
      id: l.id,
      x1: px(l.a.x),
      y1: py(l.a.y),
      x2: px(l.b.x),
      y2: py(l.b.y),
      load: Math.min(1, (l.ab || 0) + (l.ba || 0))
    }))
  );

  // Links plugged into the hovered router are part of its story; keep them visible.
  let incidentLinkIds = $derived.by(() => {
    const ids = new Set();
    let ep = null;
    if (hovered.kind === 'router') ep = parseRouterKey(hovered.id);
    else if (hovered.kind === 'endpoint') ep = endpoints.find((e) => e.id === hovered.id) ?? null;
    if (!ep) return ids;
    const { x, y } = ep;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      ids.add(undirectedKey({ x, y }, { x: nx, y: ny }));
    }
    return ids;
  });

  let routerRects = $derived.by(() => {
    const rects = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) rects.push({ x: px(x) - RS, y: py(y) - RS, w: RS * 2, h: RS * 2 });
    }
    return rects;
  });

  // Length of a segment inside a rectangle (Liang–Barsky clipping).
  function segRectLen(x1, y1, x2, y2, rx, ry, rw, rh) {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return 0;
        continue;
      }
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return 0;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return 0;
        if (r < t1) t1 = r;
      }
    }
    return Math.hypot(dx, dy) * (t1 - t0);
  }

  function rectOverlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // Try the eight directions around the hovered element and keep the spot that
  // hides the least traffic, so the card never sits on the link it describes.
  let calloutPos = $derived.by(() => {
    if (!hoverCard || !pointerInside || !viewport) return null;

    const { scale, x: vx, y: vy } = viewport;
    const w = cardW || CARD_W;
    const h = cardH || CARD_H;

    let ax;
    let ay;
    let clear;
    let preferred;

    if (hoverCard.kind === 'endpoint') {
      const ep = endpoints.find((e) => e.id === hovered.id);
      if (!ep) return null;
      const [dx, dy] = SLOT_DIR[ep.slot % 4];
      ax = px(ep.x) + dx * EP_DIST;
      ay = py(ep.y) + dy * EP_DIST;
      clear = 15;
      preferred = [
        [dx, dy],
        [dx, 0],
        [0, dy]
      ];
    } else if (hoverCard.kind === 'router') {
      const { x, y } = parseRouterKey(hovered.id);
      ax = px(x);
      ay = py(y);
      clear = RS + 4;
      const offX = x - (cols - 1) / 2;
      const offY = y - (rows - 1) / 2;
      const qx = offX === 0 ? (mouse.x >= vx + ax * scale ? 1 : -1) : Math.sign(offX);
      // screen y is inverted relative to the coordinate system
      const qy = offY === 0 ? (mouse.y >= vy + ay * scale ? 1 : -1) : -Math.sign(offY);
      preferred = [
        [qx, qy],
        [qx, 0],
        [0, qy]
      ];
    } else if (hoverCard.kind === 'link') {
      const link = hoveredLink;
      if (!link) return null;
      ax = (px(link.a.x) + px(link.b.x)) / 2;
      ay = (py(link.a.y) + py(link.b.y)) / 2;
      clear = 12;
      preferred =
        link.axis === 'h'
          ? [
              [0, -1],
              [0, 1]
            ]
          : [
              [-1, 0],
              [1, 0]
            ];
    } else {
      return null;
    }

    const gap = clear * scale + CARD_GAP;
    const ax2 = vx + ax * scale;
    const ay2 = vy + ay * scale;
    const allDirs = [
      [1, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [-1, 1]
    ];
    const dirs = [
      ...preferred,
      ...allDirs.filter(([dx, dy]) => !preferred.some(([px2, py2]) => px2 === dx && py2 === dy))
    ];

    let best = null;
    for (const [qx, qy] of dirs) {
      const left = qx > 0 ? ax2 + gap : qx < 0 ? ax2 - gap - w : ax2 - w / 2;
      const top = qy > 0 ? ay2 + gap : qy < 0 ? ay2 - gap - h : ay2 - h / 2;
      const l = clamp(left, CARD_EDGE, Math.max(CARD_EDGE, stageW - w - CARD_EDGE));
      const t = clamp(top, CARD_EDGE, Math.max(CARD_EDGE, stageH - h - CARD_EDGE));
      const shift = Math.abs(l - left) + Math.abs(t - top);

      const box = { x: (l - vx) / scale, y: (t - vy) / scale, w: w / scale, h: h / scale };
      let cost = shift * 3;
      for (const seg of linkSegs) {
        const len = segRectLen(seg.x1, seg.y1, seg.x2, seg.y2, box.x, box.y, box.w, box.h);
        if (!len) continue;
        const weight =
          hoveredLink && seg.id === hoveredLink.id
            ? 10
            : pathLinkIds.has(seg.id)
              ? 3
              : incidentLinkIds.has(seg.id)
                ? 5
                : 1;
        // idle links are cheap to cover, loaded ones are not
        cost += len * weight * (0.5 + 2.5 * seg.load);
      }
      for (const rect of routerRects) cost += rectOverlap(box, rect) * 0.04;

      if (!best || cost < best.cost) best = { cost, left: l, top: t };
    }

    return { left: `${best.left}px`, top: `${best.top}px` };
  });

  function track(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointerInside = true;
  }

  function movePointer(event) {
    track(event);
    if (!panDrag || !base) return;
    const dx = event.clientX - panDrag.x;
    const dy = event.clientY - panDrag.y;
    if (!panDrag.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      panDrag.moved = true;
      dragging = true;
      stageEl?.setPointerCapture?.(panDrag.pointerId);
    }
    pan = clampPan({ x: panDrag.panX + dx / base.scale, y: panDrag.panY + dy / base.scale });
  }

  function dirGeom(link, offset) {
    const ax = px(link.a.x);
    const ay = py(link.a.y);
    const bx = px(link.b.x);
    const by = py(link.b.y);
    if (link.axis === 'h') return { x1: ax, y1: ay + offset, x2: bx, y2: by + offset };
    return { x1: ax + offset, y1: ay, x2: bx + offset, y2: by };
  }

  // K lanes per direction sit side by side across the link; side -1 is a→b, +1 is b→a.
  const RAIL_GAP = 3.4;
  const RAIL_BASE = 1.4;
  const sideCenter = (k) => (k <= 1 ? 2.6 : RAIL_BASE + ((k - 1) * RAIL_GAP) / 2);

  function railOffset(k, side, lane) {
    if (k <= 1) return side * 2.6;
    return side * (sideCenter(k) + (lane - (k - 1) / 2) * RAIL_GAP);
  }

  function railWidth(load, k) {
    const w = loadWidth(load);
    if (k <= 1) return w;
    const max = k === 2 ? 3.2 : 2.8;
    return 1 + Math.max(0, w - 1.4) * ((max - 1) / 5);
  }

  function railHitWidth(k) {
    if (k <= 1) return 15;
    const outer = sideCenter(k) + ((k - 1) / 2) * RAIL_GAP;
    return Math.max(15, outer * 2 + 4);
  }

  // Loaded directions show one rail per lane; an idle direction keeps a single hairline.
  function railsFor(loads, total, k, side) {
    if (total > 0.001 && loads.length === k) {
      return loads.map((load, lane) => ({ load, offset: railOffset(k, side, lane), idle: false }));
    }
    return [{ load: 0, offset: side * sideCenter(k), idle: true }];
  }

  function arrowAt(link, offset, reverse = false) {
    const g = dirGeom(link, offset);
    const t = reverse ? 0.38 : 0.62;
    const angle = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI;
    return {
      x: g.x1 + (g.x2 - g.x1) * t,
      y: g.y1 + (g.y2 - g.y1) * t,
      angle: reverse ? angle + 180 : angle
    };
  }

  function linkDim(link) {
    if (hovered.kind === 'router') {
      const { x, y } = parseRouterKey(hovered.id);
      return (link.a.x === x && link.a.y === y) || (link.b.x === x && link.b.y === y) ? 1 : 0.13;
    }
    if (hovered.kind === 'link') return link.id === hovered.id ? 1 : 0.16;
    if (previewEp) return pathLinkIds.has(link.id) ? 1 : 0.34;
    if (selected.kind === 'router') {
      const { x, y } = parseRouterKey(selected.id);
      return (link.a.x === x && link.a.y === y) || (link.b.x === x && link.b.y === y) ? 1 : 0.5;
    }
    return 1;
  }

  // Drawn as their own layer so thick load bars never bury the direction cue
  let linkArrows = $derived.by(() => {
    const out = [];
    const k = laneCount;
    const scale = k > 1 ? 0.82 : 1;
    for (const link of links) {
      const dim = linkDim(link);
      if (link.ab > 0.02) {
        out.push({
          id: `${link.id}:ab`,
          ...arrowAt(link, railOffset(k, -1, link.abLane)),
          fill: arrowColor(link.ab),
          dim,
          scale
        });
      }
      if (link.ba > 0.02) {
        out.push({
          id: `${link.id}:ba`,
          ...arrowAt(link, railOffset(k, 1, link.baLane), true),
          fill: arrowColor(link.ba),
          dim,
          scale
        });
      }
    }
    return out;
  });

  function routerDim(x, y) {
    if (hovered.kind === 'router') return routerKey(x, y) === hovered.id ? 1 : 0.28;
    if (hoveredLink) {
      return (hoveredLink.a.x === x && hoveredLink.a.y === y) || (hoveredLink.b.x === x && hoveredLink.b.y === y)
        ? 1
        : 0.3;
    }
    if (previewEp) return 0.6;
    return 1;
  }

  function endpointDim(ep) {
    if (hovered.kind === 'router') return routerKey(ep.x, ep.y) === hovered.id ? 1 : 0.22;
    if (hovered.kind === 'endpoint') return ep.id === hovered.id ? 1 : 0.28;
    if (previewEp) return ep.id === previewEp.id ? 1 : 0.32;
    return 1;
  }

  function epPos(ep) {
    const [dx, dy] = SLOT_DIR[ep.slot % 4];
    return { x: px(ep.x) + dx * EP_DIST, y: py(ep.y) + dy * EP_DIST, dx, dy };
  }

  const hits = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // Endpoint id labels: outward of the dot, nudged aside when a neighbour is in the way
  let labelLayout = $derived.by(() => {
    const fs = epLabelSize;
    const th = fs * 1.15;
    const taken = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        taken.push({ x: px(x) - RS - 2, y: py(y) - RS - 2, w: RS * 2 + 4, h: RS * 2 + 4 });
      }
    }
    const out = new Map();
    for (const ep of endpoints) {
      const p = epPos(ep);
      const tw = endpointLabel(ep.id).length * fs * 0.62;
      const vert = p.dy * (12 + th / 2);
      const diagY = p.dy * (th / 2 + 6);
      const cands = [
        { x: p.x, y: p.y + vert, anchor: 'middle', left: p.x - tw / 2 },
        { x: p.x + p.dx * 9, y: p.y + diagY, anchor: p.dx > 0 ? 'start' : 'end', left: p.dx > 0 ? p.x + p.dx * 9 : p.x + p.dx * 9 - tw },
        { x: p.x, y: p.y - vert, anchor: 'middle', left: p.x - tw / 2 },
        { x: p.x + p.dx * (12 + tw / 2), y: p.y, anchor: 'middle', left: p.x + p.dx * (12 + tw / 2) - tw / 2 }
      ];
      let pick = cands[0];
      for (const c of cands) {
        const r = { x: c.left, y: c.y - th / 2, w: tw, h: th };
        if (!taken.some((t) => hits(r, t))) {
          pick = c;
          taken.push(r);
          break;
        }
      }
      out.set(ep.id, pick);
    }
    return out;
  });

  let activeRouterKey = $derived(
    hovered.kind === 'router' ? hovered.id : selected.kind === 'router' ? selected.id : null
  );
</script>

<div
  class="stage"
  class:dragging
  role="presentation"
  bind:this={stageEl}
  bind:clientWidth={stageW}
  bind:clientHeight={stageH}
  onpointerenter={track}
  onpointermove={movePointer}
  onpointerdown={startPan}
  onpointerup={endPan}
  onpointercancel={endPan}
  onpointerleave={() => {
    pointerInside = false;
    onHover(null, null);
  }}
  ondblclick={resetView}
  onclickcapture={suppressClick}
  onclick={() => onSelect(null, null)}
>
  <svg
    viewBox={`${-pan.x / zoom} ${-pan.y / zoom} ${W / zoom} ${H / zoom}`}
    preserveAspectRatio="xMidYMid meet"
    class="mesh"
  >
    <defs>
      <filter id="router-shadow" x="-40%" y="-40%" width="180%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#3a2f1d" flood-opacity="0.16" />
      </filter>
    </defs>


    <!-- coordinate ticks -->
    <g class="ticks">
      {#each Array.from({ length: cols }) as _, x}
        <text x={px(x)} y={py(rows - 1) - 40} text-anchor="middle" style:font-size={`${tickSize}px`}>{x}</text>
      {/each}
      {#each Array.from({ length: rows }) as _, y}
        <text x={px(0) - 40} y={py(y)} text-anchor="middle" dominant-baseline="middle" style:font-size={`${tickSize}px`}>{y}</text>
      {/each}
    </g>

    <!-- links -->
    {#each links as link, index (link.id)}
      {@const dim = linkDim(link)}
      {@const isHot = hovered.kind === 'link' && hovered.id === link.id}
      {@const isSelected = selected.kind === 'link' && selected.id === link.id}
      {@const idle = link.ab < 0.001 && link.ba < 0.001}
      {@const fadeDelay = index * 6}
      <g
        class="link"
        class:hot={isHot}
        class:selected-link={isSelected}
        style:opacity={dim}
        style:animation-delay={`${fadeDelay}ms`}
      >
        {#if isSelected}
          {@const gs = dirGeom(link, 0)}
          <path class="select-halo" d={`M ${gs.x1} ${gs.y1} L ${gs.x2} ${gs.y2}`} />
        {/if}
        {#if idle}
          {@const g = dirGeom(link, 0)}
          <path class="link-line" d={`M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`} stroke={loadColor(0)} stroke-width="1.2" />
        {:else}
          {#each railsFor(link.abLanes, link.abTotal, laneCount, -1) as rail}
            {@const g = dirGeom(link, rail.offset)}
            <path
              class="link-line"
              d={`M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`}
              stroke={loadColor(rail.load)}
              stroke-width={rail.idle ? 1 : railWidth(rail.load, laneCount)}
              stroke-opacity={loadOpacity(rail.load)}
            />
          {/each}
          {#each railsFor(link.baLanes, link.baTotal, laneCount, 1) as rail}
            {@const g = dirGeom(link, rail.offset)}
            <path
              class="link-line"
              d={`M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`}
              stroke={loadColor(rail.load)}
              stroke-width={rail.idle ? 1 : railWidth(rail.load, laneCount)}
              stroke-opacity={loadOpacity(rail.load)}
            />
          {/each}
        {/if}
        <path
          class="hit"
          role="button"
          tabindex="-1"
          aria-label={`链路 R${link.a.x},${link.a.y} 与 R${link.b.x},${link.b.y}`}
          style:stroke-width={railHitWidth(laneCount)}
          d={(() => {
            const g = dirGeom(link, 0);
            return `M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`;
          })()}
          onpointerenter={() => onHover('link', link.id)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect('link', link.id);
            }
          }}
          onclick={(event) => {
            event.stopPropagation();
            onSelect('link', link.id);
          }}
        />
      </g>
    {/each}

    <!-- direction arrows sit above every load bar -->
    <g class="arrows">
      {#each linkArrows as a (a.id)}
        <path
          class="arrow"
          d="M -4 -3 L 3.4 0 L -4 3 Z"
          fill={a.fill}
          transform={`translate(${a.x} ${a.y}) rotate(${a.angle}) scale(${a.scale})`}
          style:opacity={a.dim}
        />
      {/each}
    </g>

    <!-- router + local endpoint stubs -->
    {#each Array.from({ length: rows }) as _, y}
      {#each Array.from({ length: cols }) as _, x}
        {@const rk = routerKey(x, y)}
        {@const eps = epsByRouter.get(rk) || []}
        {@const rdim = routerDim(x, y)}
        {@const rSelected = selected.kind === 'router' && selected.id === rk}
        {@const rHovered = hovered.kind === 'router' && hovered.id === rk}
        <g class="router" style:opacity={rdim}>
          {#each eps as ep}
            {@const p = epPos(ep)}
            <line
              class="stub"
              x1={px(x) + p.dx * (RS - 8)}
              y1={py(y) + p.dy * (RS - 8)}
              x2={p.x - p.dx * 10}
              y2={p.y - p.dy * 10}
              stroke={activeColor}
              stroke-opacity={ep.id === previewEp?.id ? 0.9 : 0.45}
              stroke-width={ep.id === previewEp?.id ? 1.6 : 1.1}
              stroke-dasharray={nodeDash(ep.type)}
            />
          {/each}

          {#if rSelected}
            <rect
              x={px(x) - RS - 5.5}
              y={py(y) - RS - 5.5}
              width={RS * 2 + 11}
              height={RS * 2 + 11}
              rx="15"
              fill="none"
              stroke="#2F5D62"
              stroke-opacity="0.45"
              stroke-width="1"
              stroke-dasharray="2 4"
            />
          {/if}

          <rect
            x={px(x) - RS + 0.5}
            y={py(y) - RS + 2}
            width={RS * 2}
            height={RS * 2}
            rx="10"
            fill="rgba(148, 126, 90, 0.10)"
          />
          <rect
            class="router-body"
            class:active={rHovered || rSelected}
            role="button"
            tabindex="-1"
            aria-label={`Router ${x},${y}`}
            x={px(x) - RS}
            y={py(y) - RS}
            width={RS * 2}
            height={RS * 2}
            rx="10"
            filter={rHovered ? 'url(#router-shadow)' : undefined}
            onpointerenter={() => onHover('router', rk)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect('router', rk);
              }
            }}
            onclick={(event) => {
              event.stopPropagation();
              onSelect('router', rk);
            }}
          />
          {#each eps as ep}
            {@const p = epPos(ep)}
            {@const lp = labelLayout.get(ep.id)}
            {@const rate = channelRate(ep, activeChannel)}
            {@const isPreview = ep.id === previewEp?.id}
            {@const bodyR = 6.2 + Math.min(rate, 1) * 2.9}
            {@const bodyD = nodeShapePath(ep.type, bodyR)}
            <g
              class="endpoint"
              role="button"
              tabindex="-1"
              aria-label={`端点 ${endpointLabel(ep.id)}`}
              style:opacity={endpointDim(ep)}
              onpointerenter={() => onHover('endpoint', ep.id)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect('endpoint', ep.id);
                }
              }}
              onclick={(event) => {
                event.stopPropagation();
                onSelect('endpoint', ep.id);
              }}
            >
              <path
                class="endpoint-body"
                class:active={isPreview}
                d={bodyD}
                transform={`translate(${p.x} ${p.y})`}
                fill={rate > 0 ? activeColor : 'none'}
                fill-opacity={Math.min(1, 0.2 + rate * 1.05)}
                stroke={activeColor}
                stroke-opacity={rate > 0 ? 1 : 0.42}
                stroke-width="1.5"
                stroke-linejoin="round"
              />
              {#if rate > 0.55}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={bodyR + 5}
                  fill="none"
                  stroke={activeColor}
                  stroke-opacity="0.32"
                  stroke-width="1"
                  stroke-dasharray="1.5 4"
                  class="orbit"
                />
              {/if}
              {#if isPreview}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={bodyR + 5}
                  fill="none"
                  stroke={activeColor}
                  stroke-width="1.3"
                  stroke-dasharray="3 3.5"
                  class="orbit"
                />
              {/if}
              <circle cx={p.x} cy={p.y} r={bodyR + 6} fill="transparent" />
              <text
                class="endpoint-label"
                class:active={isPreview}
                x={lp.x}
                y={lp.y}
                text-anchor={lp.anchor}
                dominant-baseline="middle"
                style:font-size={`${epLabelSize}px`}
              >
                {endpointLabel(ep.id)}
              </text>
            </g>
          {/each}

          {#if activeRouterKey === rk && eps.length < 4}
            {#each [0, 1, 2, 3] as slot}
              {#if !eps.some((e) => e.slot === slot)}
                {@const dx = SLOT_DIR[slot][0]}
                {@const dy = SLOT_DIR[slot][1]}
                {@const sx = px(x) + dx * EP_DIST}
                {@const sy = py(y) + dy * EP_DIST}
                <g
                  class="empty-slot"
                  role="button"
                  tabindex="-1"
                  aria-label={`在 R${x},${y} 的 ${slot} 号槽位添加端点`}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect('add', `${x},${y}`);
                    }
                  }}
                  onclick={(event) => {
                    event.stopPropagation();
                    onSelect('add', `${x},${y}`);
                  }}
                >
                  <circle cx={sx} cy={sy} r="7" fill="rgba(255,253,248,.7)" stroke="#C9C0AD" stroke-dasharray="2 2.5" />
                  <path d={`M ${sx - 3} ${sy} H ${sx + 3} M ${sx} ${sy - 3} V ${sy + 3}`} stroke="#9C9384" stroke-width="1.2" stroke-linecap="round" />
                  <circle cx={sx} cy={sy} r="14" fill="transparent" />
                </g>
              {/if}
            {/each}
          {/if}
        </g>
      {/each}
    {/each}

    <!-- route preview sits above router bodies so it can run into the center -->
    {#if pathData}
      <g class="path" class:preview={previewFromHover}>
        <path class="path-stub" d={`M ${pathData.stub.x1} ${pathData.stub.y1} L ${pathData.stub.x2} ${pathData.stub.y2}`} stroke={activeColor} />
        {#each pathData.rows as row, index (index)}
          <g class="flow-path">
            <path class="path-glow" d={row.d} stroke={activeColor} />
            <path class="path-dash" d={row.d} stroke={activeColor} style:stroke-width={pathDashWidth(row.rate)} />
            {#if row.tail}
              <path class="path-stub" d={`M ${row.tail.x1} ${row.tail.y1} L ${row.tail.x2} ${row.tail.y2}`} stroke={activeColor} />
            {/if}
          </g>
        {/each}
      </g>
    {/if}

    <!-- labels stay above the route -->
    <g class="router-labels">
      {#each Array.from({ length: rows }) as _, y}
        {#each Array.from({ length: cols }) as _, x}
          <text
            class="router-label"
            x={px(x)}
            y={py(y) + 3.4}
            text-anchor="middle"
            style:font-size={`${labelSize}px`}
            style:opacity={routerDim(x, y)}
          >
            R{x},{y}
          </text>
        {/each}
      {/each}
    </g>
  </svg>

  {#if zoom !== 1 || pan.x !== 0 || pan.y !== 0}
    <button
      class="view-reset mono"
      title="双击画布或点击此处恢复默认视图"
      onclick={(event) => {
        event.stopPropagation();
        resetView();
      }}
    >
      {Math.round(zoom * 100)}% · 复位
    </button>
  {/if}

  {#if hoverCard && calloutPos}
    <div
      class="callout"
      style:left={calloutPos.left}
      style:top={calloutPos.top}
      bind:offsetWidth={cardW}
      bind:offsetHeight={cardH}
    >
      <div class="callout-title mono">{hoverCard.title}</div>

      {#if hoverCard.kind === 'router'}
        <div class="callout-meta">{hoverCard.meta}</div>
        <div class="callout-rows">
          {#each hoverCard.dirs as dir}
            <div class="callout-row">
              <span class="dir-label mono">{dir.label}</span>
              {#if hoverCard.lanes > 1}
                <span class="lane-tag mono">L{dir.lane}</span>
              {/if}
              <span class="mini-bar"><span style:width={`${Math.min(100, (dir.load / 1.2) * 100)}%`} style:background={loadColor(dir.load)}></span></span>
              <span class="mini-val mono">{dir.load.toFixed(2)}</span>
            </div>
          {/each}
        </div>
      {:else if hoverCard.kind === 'endpoint'}
        {#if hoverCard.meta}
          <div class="callout-meta">{hoverCard.meta}</div>
        {:else}
          <div class="callout-meta">{hoverCard.typeName}</div>
        {/if}
        <div class="callout-rows">
          {#each hoverCard.rows as row}
            <div class="callout-row">
              <span class="dot" style:background={row.color}></span>
              <span class="ch-name mono">{row.id}</span>
              {#if row.flows > 1}
                <span class="ch-mult mono">×{row.flows}</span>
              {/if}
              <span class="mini-bar"><span style:width={`${Math.min(100, (row.rate / 1.2) * 100)}%`} style:background={loadColor(row.rate)}></span></span>
              <span class="mini-val mono">{row.rate.toFixed(2)}</span>
            </div>
          {/each}
        </div>
      {:else if hoverCard.kind === 'link'}
        {#if hoverCard.lanes > 1}
          <div class="callout-meta mono">×{hoverCard.lanes} lane · 双向合计 {hoverCard.total.toFixed(2)}×</div>
        {/if}
        <div class="callout-rows">
          <div class="callout-row">
            <span class="dir-label mono">→</span>
            {#if hoverCard.lanes > 1}
              <span class="lane-tag mono">L{hoverCard.abLane}</span>
            {/if}
            <span class="mini-bar"><span style:width={`${Math.min(100, (hoverCard.ab / 1.2) * 100)}%`} style:background={loadColor(hoverCard.ab)}></span></span>
            <span class="mini-val mono">{hoverCard.ab.toFixed(2)}×</span>
          </div>
          {#if hoverCard.lanes > 1}
            <div class="lane-strip">
              {#each hoverCard.abLanes as load, lane (lane)}
                <span class="lane-cell" class:hot={load > 0 && load >= hoverCard.ab}>
                  <span class="mono">L{lane}</span>
                  <span class="mono lane-cell-val">{load.toFixed(2)}</span>
                </span>
              {/each}
            </div>
          {/if}
          <div class="callout-row">
            <span class="dir-label mono">←</span>
            {#if hoverCard.lanes > 1}
              <span class="lane-tag mono">L{hoverCard.baLane}</span>
            {/if}
            <span class="mini-bar"><span style:width={`${Math.min(100, (hoverCard.ba / 1.2) * 100)}%`} style:background={loadColor(hoverCard.ba)}></span></span>
            <span class="mini-val mono">{hoverCard.ba.toFixed(2)}×</span>
          </div>
          {#if hoverCard.lanes > 1}
            <div class="lane-strip">
              {#each hoverCard.baLanes as load, lane (lane)}
                <span class="lane-cell" class:hot={load > 0 && load >= hoverCard.ba}>
                  <span class="mono">L{lane}</span>
                  <span class="mono lane-cell-val">{load.toFixed(2)}</span>
                </span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    touch-action: none;
  }

  .stage.dragging,
  .stage.dragging .mesh,
  .stage.dragging .mesh * {
    cursor: grabbing;
  }

  .mesh {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
    cursor: grab;
    user-select: none;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .mesh :focus {
    outline: none;
  }

  .ticks text {
    fill: #b6ad9c;
    font-size: 9px;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .link {
    animation: fade-in 0.7s var(--ease) backwards;
  }

  .link-line {
    fill: none;
    stroke-linecap: round;
    transition: stroke 0.3s var(--ease), stroke-width 0.3s var(--ease), stroke-opacity 0.25s var(--ease);
  }

  .arrows {
    animation: fade-in 0.7s var(--ease) 0.1s backwards;
  }

  .arrow {
    pointer-events: none;
    paint-order: stroke;
    stroke: #fffdf8;
    stroke-width: 0.7px;
    stroke-linejoin: round;
    transition: fill 0.3s var(--ease);
  }

  .link.hot .link-line {
    transition-duration: 0.12s;
  }

  .select-halo {
    fill: none;
    stroke: #2f5d62;
    stroke-opacity: 0.13;
    stroke-width: 22;
    stroke-linecap: round;
    pointer-events: none;
  }

  .hit {
    stroke: transparent;
    fill: none;
    cursor: pointer;
    pointer-events: stroke;
  }

  .path {
    pointer-events: none;
    animation: path-in 0.35s var(--ease) backwards;
  }

  .path-stub {
    fill: none;
    stroke-width: 1.6;
    stroke-opacity: 0.85;
    stroke-dasharray: 3 3;
    stroke-linecap: round;
    animation: dash-flow 1.1s linear infinite;
  }

  .path-glow {
    fill: none;
    stroke-width: 10;
    stroke-opacity: 0.12;
    stroke-linecap: round;
  }

  .path-dash {
    fill: none;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-dasharray: 5 7;
    animation: dash-flow 1.1s linear infinite;
  }

  .path.preview .path-glow {
    stroke-opacity: 0.08;
  }

  .path.preview .path-dash {
    stroke-width: 1.8;
    stroke-opacity: 0.8;
  }

  .router {
    transition: opacity 0.2s var(--ease);
  }

  .router-body {
    fill: #fffdf8;
    stroke: #dcd4c3;
    stroke-width: 1.2;
    cursor: pointer;
    transition: stroke 0.2s var(--ease), fill 0.2s var(--ease), filter 0.2s var(--ease);
  }

  .router-body:hover,
  .router-body.active {
    stroke: #2f5d62;
    stroke-width: 1.5;
  }

  .router-label {
    fill: #6f6a5f;
    font-size: 9.5px;
    letter-spacing: 0.03em;
    paint-order: stroke;
    stroke: #fffdf8;
    stroke-width: 2.8px;
    stroke-linejoin: round;
    pointer-events: none;
    user-select: none;
    transition: opacity 0.2s var(--ease);
  }

  .router-labels {
    pointer-events: none;
  }

  .stub {
    fill: none;
    stroke-linecap: round;
    transition: stroke-opacity 0.2s var(--ease);
  }

  .endpoint {
    cursor: pointer;
    transition: opacity 0.2s var(--ease);
  }

  .endpoint-body {
    transition: fill-opacity 0.3s var(--ease), stroke 0.3s var(--ease);
  }

  .endpoint-label {
    fill: #a79d8b;
    letter-spacing: 0.02em;
    paint-order: stroke;
    stroke: #fffdf8;
    stroke-width: 2.2px;
    stroke-linejoin: round;
    pointer-events: none;
    user-select: none;
    transition: fill 0.2s var(--ease);
  }

  .endpoint-label.active {
    fill: #2f5d62;
    font-weight: 500;
  }

  .endpoint-body.active {
    filter: drop-shadow(0 1px 3px rgba(47, 93, 98, 0.35));
  }

  .orbit {
    transform-box: fill-box;
    transform-origin: center;
    animation: spin 14s linear infinite;
    pointer-events: none;
  }

  .empty-slot {
    cursor: pointer;
    opacity: 0.9;
  }

  .empty-slot:hover circle {
    stroke: #2f5d62;
  }

  .view-reset {
    position: absolute;
    right: 14px;
    bottom: 12px;
    z-index: 9;
    padding: 5px 10px;
    font-size: 10px;
    color: var(--ink-2);
    background: rgba(255, 253, 248, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid var(--line);
    border-radius: 999px;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: color 0.16s var(--ease), border-color 0.16s var(--ease);
  }

  .view-reset:hover {
    color: var(--ink);
    border-color: #cfc4ad;
  }

  .callout {
    position: absolute;
    z-index: 10;
    width: max-content;
    min-width: 176px;
    max-width: 226px;
    padding: 10px 12px 11px;
    background: rgba(255, 253, 248, 0.94);
    backdrop-filter: blur(10px);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-lift);
    pointer-events: none;
    animation: callout-in 0.16s var(--ease) backwards;
  }

  .callout-title {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--ink-2);
    letter-spacing: 0.03em;
  }

  .callout-meta {
    margin-top: 3px;
    font-size: 10.5px;
    color: var(--muted);
  }

  .callout-rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 8px;
  }

  .callout-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10px;
    color: var(--ink-3);
  }

  .dir-label {
    width: 12px;
    color: var(--muted);
    text-align: center;
  }

  .ch-name {
    width: 28px;
    color: var(--ink-3);
  }

  .ch-mult {
    margin-left: -3px;
    font-size: 9px;
    color: var(--accent);
  }

  .lane-tag {
    width: 15px;
    font-size: 8.5px;
    color: var(--accent);
    text-align: center;
  }

  .lane-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: -1px 0 1px 19px;
  }

  .lane-cell {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    padding: 1px 5px;
    font-size: 8.5px;
    color: var(--muted);
    background: #f4efe3;
    border-radius: 4px;
  }

  .lane-cell.hot {
    color: var(--ink-2);
    background: #ece2cf;
  }

  .lane-cell-val {
    color: var(--ink-2);
  }

  .mini-bar {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: #efe7d7;
    overflow: hidden;
  }

  .mini-bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    transition: width 0.25s var(--ease), background 0.25s var(--ease);
  }

  .mini-val {
    min-width: 34px;
    text-align: right;
    color: var(--ink-2);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes path-in {
    from {
      opacity: 0;
    }
  }

  @keyframes dash-flow {
    to {
      stroke-dashoffset: -24;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes callout-in {
    from {
      opacity: 0;
    }
  }
</style>
