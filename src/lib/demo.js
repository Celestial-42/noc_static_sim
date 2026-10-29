import { DEFAULT_CHANNELS } from './model.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeds a traffic pattern that reads well on screen: most endpoints converge
 * on a single hotspot, a few chase the centre or the far corner, some split
 * their request traffic across two targets, and a couple stay idle so hollow
 * endpoints show up in the mix.
 */
export function demoEndpoints(cols, rows, channels = DEFAULT_CHANNELS) {
  const rnd = mulberry32(0x9e3779b9 ^ (cols * 131 + rows * 17));
  const cells = [];
  let seq = 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) cells.push({ id: seq++, x, y });
  }

  const idAt = (x, y) => y * cols + x + 1;
  const hotspot = { x: Math.max(0, cols - 2), y: Math.min(rows - 1, Math.floor(rows / 2)) };
  const center = { x: Math.floor((cols - 1) / 2), y: Math.floor((rows - 1) / 2) };
  const far = { x: 0, y: 0 };
  const hotId = idAt(hotspot.x, hotspot.y);
  const centerId = idAt(center.x, center.y);
  const farId = idAt(far.x, far.y);

  const pickOther = (self, avoid) => {
    if (cells.length < 2) return self;
    let id = self;
    while (id === self || id === avoid) id = cells[Math.floor(rnd() * cells.length)].id;
    return id;
  };

  // The hotspot behaves as a home node, the centre as its I/O counterpart,
  // the far corner as a slave; the rest alternate between the two request nodes.
  const typeOf = (id, x, y) => {
    if (id === hotId) return 'HNF';
    if (id === centerId) return 'HNI';
    if (id === farId) return 'SN';
    return (x + y) % 2 === 0 ? 'RNF' : 'RNI';
  };

  return cells.map(({ id, x, y }) => {
    const isHot = id === hotId;
    const reqIdle = !isHot && cells.length > 4 && rnd() < 0.12;

    let reqTarget = hotId;
    if (isHot) {
      reqTarget = farId;
    } else {
      const roll = rnd();
      if (roll > 0.93) reqTarget = centerId;
      else if (roll > 0.87) reqTarget = farId;
    }
    if (reqTarget === id) reqTarget = pickOther(id);

    const inject = {
      REQ: reqIdle ? 0 : isHot ? 0.06 : 0.09 + rnd() * 0.14,
      RSP: rnd() < 0.24 ? 0 : 0.01 + rnd() * 0.035,
      SNP: rnd() < 0.52 ? 0 : 0.006 + rnd() * 0.025,
      DAT: rnd() < 0.14 ? 0 : 0.025 + rnd() * 0.06
    };
    const target = {
      REQ: reqTarget,
      RSP: pickOther(id),
      SNP: pickOther(id),
      DAT: pickOther(id)
    };

    const flows = {};
    for (const ch of channels) {
      if (inject[ch.id] === undefined) inject[ch.id] = rnd() < 0.6 ? 0 : 0.01 + rnd() * 0.03;
      if (target[ch.id] === undefined) target[ch.id] = pickOther(id);

      const rate = inject[ch.id];
      if (rate <= 0) {
        flows[ch.id] = [{ target: target[ch.id], rate: 0 }];
        continue;
      }
      // A slice of the request traffic fans out to a second target
      if (ch.id === 'REQ' && cells.length > 2 && rnd() < 0.3) {
        const share = 0.6 + rnd() * 0.15;
        flows[ch.id] = [
          { target: target[ch.id], rate: +(rate * share).toFixed(3) },
          { target: pickOther(id, target[ch.id]), rate: +(rate * (1 - share)).toFixed(3) }
        ];
      } else {
        flows[ch.id] = [{ target: target[ch.id], rate: +rate.toFixed(3) }];
      }
    }

    return { id, x, y, type: typeOf(id, x, y), slot: (x + y) % 4, flows };
  });
}
