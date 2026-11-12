// Small, dependency-free inline-SVG chart helpers for the dashboard.

export const PIE_PALETTE = ['#ff5a36', '#0f766e', '#f5a524', '#6366f1', '#14b8a6', '#ec4899', '#64748b', '#84cc16'];

// segments: [{ label, value }] — colors are assigned from PIE_PALETTE in order.
// Returns { svg, legend: [{label, value, pct, color}] } so callers can render a matching legend.
export function pieChart(segments, { size = 160, stroke = 28 } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let cumFrac = 0;
  const legend = [];
  const arcs = segments
    .map((s, i) => {
      const color = PIE_PALETTE[i % PIE_PALETTE.length];
      const frac = s.value / total;
      const dash = frac * circumference;
      const offset = -cumFrac * circumference;
      cumFrac += frac;
      legend.push({ label: s.label, value: s.value, pct: Math.round(frac * 1000) / 10, color });
      if (frac <= 0) return '';
      return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 ${c} ${c})" class="pie-arc"/>`;
    })
    .join('');
  const svg = segments.length
    ? `<svg class="pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`
    : `<svg class="pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(16,24,40,.08)" stroke-width="${stroke}"/></svg>`;
  return { svg, legend };
}

export function donutChart(pct, { size = 112, stroke = 12, color = 'var(--chart)', track = 'rgba(16,24,40,.08)', label = '' } = {}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 ${c} ${c})" class="donut-arc"/>
    <text x="${c}" y="${c - 3}" text-anchor="middle" class="donut-value">${Math.round(clamped)}%</text>
    <text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-label">${label}</text>
  </svg>`;
}

// points: [{ label, value }] — an area/line graph with a few x labels and a max-value label.
export function lineChart(points, { width = 620, height = 160, color = 'var(--chart)', mini = false } = {}) {
  if (!points.length) return '';
  if (mini) {
    // Scale between the series' own min and max so small changes stay visible.
    const vals = points.map((p) => p.value);
    const lo = Math.min(...vals);
    const span = Math.max(...vals) - lo || 1;
    const step = points.length > 1 ? width / (points.length - 1) : 0;
    const xy = points.map((p, i) => [i * step, height - 6 - ((p.value - lo) / span) * (height - 12)]);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `<svg class="linechart" width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:${height}px"><path d="${line} L${width} ${height} L0 ${height} Z" fill="${color}" opacity=".13"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const padL = 34, padB = 20, padT = 8;
  const w = width - padL, h = height - padB - padT;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const xy = points.map((p, i) => [padL + i * step, padT + h - (p.value / max) * h]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${padT + h} L${padL} ${padT + h} Z`;
  const every = Math.max(1, Math.ceil(points.length / 6));
  const labels = points
    .map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text x="${xy[i][0].toFixed(1)}" y="${height - 5}" text-anchor="middle" class="spark-label">${p.label}</text>` : ''))
    .join('');
  const dots = points.length <= 40 ? xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"><title>${points[i].label}: ${points[i].value.toLocaleString()}</title></circle>`).join('') : '';
  return `<svg class="linechart" width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
    <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" class="spark-label">${max.toLocaleString()}</text>
    <text x="${padL - 6}" y="${padT + h}" text-anchor="end" class="spark-label">0</text>
    <line x1="${padL}" y1="${padT + h}" x2="${width}" y2="${padT + h}" stroke="rgba(16,24,40,.12)"/>
    <path d="${area}" fill="${color}" opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>${dots}${labels}</svg>`;
}

export function barSpark(values, { width = 280, height = 84, color = 'var(--chart)', labels = [] } = {}) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 6;
  const barW = (width - gap * (n - 1)) / n;
  const bars = values
    .map((v, i) => {
      const h = Math.max(3, (v / max) * (height - 18));
      const x = i * (barW + gap);
      const y = height - 18 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" class="spark-bar" style="animation-delay:${i * 45}ms"/>
        ${labels[i] ? `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="spark-label">${labels[i]}</text>` : ''}`;
    })
    .join('');
  return `<svg class="barspark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
}

// Donut split into coloured segments with a total in the middle.
// segments: [{ label, value, color }]. Returns SVG markup only; callers render their own legend.
export function segDonut(segments, { size = 150, stroke = 22, center = '', sub = '' } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let acc = 0;
  const arcs = total
    ? segments
        .map((s) => {
          if (s.value <= 0) return '';
          const len = (s.value / total) * circ;
          const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
            stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(circ - Math.max(0, len - gap)).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"
            transform="rotate(-90 ${c} ${c})" class="pie-arc"><title>${s.label}: ${s.value}</title></circle>`;
          acc += len;
          return el;
        })
        .join('')
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--hover)" stroke-width="${stroke}"/>`;
  return `<svg class="segdonut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}
    <text x="${c}" y="${c - 1}" text-anchor="middle" class="segdonut-sub">${sub}</text>
    <text x="${c}" y="${c + 20}" text-anchor="middle" class="segdonut-val">${center}</text></svg>`;
}

// Smooth multi-series area/line chart with hover guides.
// series: [{ name, color, values: number[] }], labels: string[] (one per point).
export function multiLine(series, labels, { width = 640, height = 230 } = {}) {
  const n = labels.length;
  if (!n) return '';
  const padL = 34, padR = 10, padT = 10, padB = 24;
  const w = width - padL - padR, h = height - padT - padB;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const step = rawMax <= 4 ? 1 : Math.ceil(rawMax / 4);
  const max = step * Math.ceil(rawMax / step);
  const x = (i) => padL + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const y = (v) => padT + h - (v / max) * h;
  const smooth = (pts) =>
    pts.reduce((d, [px, py], i) => {
      if (!i) return `M${px.toFixed(1)} ${py.toFixed(1)}`;
      const [qx, qy] = pts[i - 1];
      const mx = (px + qx) / 2;
      return `${d} C${mx.toFixed(1)} ${qy.toFixed(1)} ${mx.toFixed(1)} ${py.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`;
    }, '');
  const grid = [];
  for (let v = 0; v <= max; v += step)
    grid.push(`<line x1="${padL}" x2="${width - padR}" y1="${y(v)}" y2="${y(v)}" class="ml-grid"/><text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end" class="spark-label">${v}</text>`);
  const every = Math.max(1, Math.ceil(n / 6));
  const xl = labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="spark-label">${l}</text>` : '')).join('');
  const paths = series
    .map((s, k) => {
      const pts = s.values.map((v, i) => [x(i), y(v)]);
      const line = smooth(pts);
      const area = `${line} L${x(n - 1).toFixed(1)} ${padT + h} L${x(0).toFixed(1)} ${padT + h} Z`;
      return `<defs><linearGradient id="mlg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".18"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
        <path d="${area}" fill="url(#mlg${k})"/><path d="${line}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round"/>`;
    })
    .join('');
  const colW = n > 1 ? w / (n - 1) : w;
  const hits = labels
    .map((l, i) => {
      const tip = `${l} — ${series.map((s) => `${s.name}: ${s.values[i]}`).join(', ')}`;
      const dots = series.map((s) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.values[i]).toFixed(1)}" r="4" fill="var(--card)" stroke="${s.color}" stroke-width="2"/>`).join('');
      return `<g class="ml-hit"><rect x="${(x(i) - colW / 2).toFixed(1)}" y="${padT}" width="${colW.toFixed(1)}" height="${h}" fill="transparent"><title>${tip}</title></rect><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${padT}" y2="${padT + h}" class="ml-guide"/>${dots}</g>`;
    })
    .join('');
  return `<svg class="multiline" width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${grid.join('')}${xl}${paths}${hits}</svg>`;
}
