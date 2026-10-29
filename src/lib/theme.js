import { scaleLinear } from 'd3-scale';
import { interpolateRgb, interpolateRgbBasis } from 'd3-interpolate';

export const PALETTE = {
  paper: '#F6F2E9',
  ink: '#1B1C1E',
  muted: '#8A857A',
  line: '#E2DACB',
  idleLink: '#D8D2C5',
  accent: '#2F5D62',
  ember: '#B4543A'
};

const loadRamp = interpolateRgbBasis([
  '#DCC08C',
  '#E2A25F',
  '#CE7645',
  '#AE4F34',
  '#75302C'
]);

const loadToT = scaleLinear().domain([0, 1.2]).range([0, 1]).clamp(true);
const widthScale = scaleLinear().domain([0, 1.2]).range([1.4, 6.4]).clamp(true);

export function loadColor(load) {
  if (!(load > 0.001)) return PALETTE.idleLink;
  return loadRamp(loadToT(load));
}

export function loadWidth(load) {
  if (!(load > 0.001)) return 1.2;
  return widthScale(load);
}

export function loadOpacity(load) {
  if (!(load > 0.001)) return 0.55;
  return 0.55 + (loadToT(load) * 0.45);
}

const CREAM = '#FFF8EC';

// Heavy links turn dark and thick, so their arrows lift toward cream to stay legible
export function arrowColor(load) {
  const t = loadToT(load);
  const base = loadRamp(t);
  if (t < 0.4) return base;
  return interpolateRgb(base, CREAM)(Math.min(0.5, (t - 0.4) * 0.85));
}

export const CHANNEL_COLORS = [
  '#3C6E8F',
  '#5C8A6B',
  '#B0793C',
  '#8A5A8F',
  '#2F6F73',
  '#A8553E'
];
