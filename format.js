import { NO_TAO } from './helpers.js';

export const fmtBytes = n => !n ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
export const fmtMs = n => n ? Math.round(n) + 'ms' : '—';
export const fmtCls = n => (n === null || n === undefined) ? '—' : n.toFixed(3);
export const shortType = t => t === 'xmlhttprequest' ? 'xhr' : t;
export const fmtEnc = e => e === 'gzip' ? 'gz' : e === 'br' ? 'br' : e || '—';
const NAV_LABELS = [
  ['redirect', 'redirect'], ['dns', 'dns'], ['connect', 'connect'], ['tls', 'tls'],
  ['request', 'request'], ['response', 'response'], ['domInteractive', 'dom interactive'],
  ['domContentLoaded', 'dom content loaded'], ['loadEvent', 'load event'],
];
const elTag = el => el?.tag ? `<${el.tag}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}>` : null;
const fmtSources = list => list.map(elTag).filter(Boolean).join(', ') || '—';
export const fmtTime = iso => {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    }).format(new Date(iso));
  } catch { return iso; }
};

function fmtSavings(s) {
  if (!s) return '';
  const parts = [];
  if (s.bytes) parts.push('~' + fmtBytes(s.bytes));
  if (s.ms) parts.push(fmtMs(s.ms));
  return parts.join(', ');
}

export function toTable(r, prev) {
  const L = [];
  L.push(`\npageaudit  ${r.url}`);
  L.push(`ran ${fmtTime(r.timestamp)}`);
  L.push(`load ${fmtMs(r.loadMs)}   ttfb ${fmtMs(r.vitals.ttfb)}   fcp ${fmtMs(r.vitals.fcp)}   lcp ${fmtMs(r.vitals.lcp)}   cls ${fmtCls(r.vitals.cls)}   tbt ${fmtMs(r.vitals.tbt)}   fully loaded ${fmtMs(r.vitals.fullyLoaded)}\n`);
  if (r.findings?.length) {
    L.push(`FINDINGS (top ${r.findings.length})`);
    L.push('─'.repeat(90));
    for (const f of r.findings) {
      const sev = f.severity.toUpperCase().padEnd(4);
      const metrics = f.metrics?.length ? `[${f.metrics.join(' ')}]` : '';
      const save = fmtSavings(f.savings);
      L.push(`  ${sev}  ${metrics.padEnd(12)}  ${f.title}${save ? '  ·  ' + save : ''}`);
      if (f.detail) L.push(`         ${f.detail}`);
    }
    L.push('');
  }
  if (r.vitals.nav) {
    L.push('TIMING BREAKDOWN');
    L.push('─'.repeat(90));
    for (const [key, label] of NAV_LABELS) {
      if (r.vitals.nav[key] === undefined) continue;
      L.push(`  ${label.padEnd(20)} ${fmtMs(r.vitals.nav[key])}`);
    }
    if (r.vitals.fullyLoaded != null) L.push(`  ${'fully loaded'.padEnd(20)} ${fmtMs(r.vitals.fullyLoaded)}`);
    L.push('');
  }
  L.push('BY TYPE');
  L.push('─'.repeat(90));
  for (const t of r.assetsByType) {
    L.push(`  ${shortType(t.type).padEnd(8)}  ${String(t.count).padStart(3)} files   ${fmtBytes(t.totalSize).padStart(9)}   avg ${fmtMs(t.avgDuration).padStart(7)}   total ${fmtMs(t.totalDuration)}`);
  }
  L.push('');
  L.push(`HEAVY ASSETS (top ${r.assets.length} by duration)`);
  L.push('─'.repeat(90));
  let hasCors = false;
  for (const a of r.assets) {
    let diff = '';
    if (prev) {
      const p = prev.assets?.find(x => x.url === a.url);
      if (p) {
        const d = a.duration - p.duration;
        diff = d === 0 ? ' =' : d > 0 ? ` ▲+${d}ms` : ` ▼${d}ms`;
      }
    }
    const corsMark = a.cors ? ` ${NO_TAO}` : '';
    if (a.cors) hasCors = true;
    L.push(`  ${fmtMs(a.duration).padStart(7)}  ${fmtBytes(a.size).padStart(9)}  ${fmtEnc(a.encoding).padStart(3)}  ${(a.protocol || '—').padEnd(6)}  ${shortType(a.type).padEnd(8)}  ${a.url}${corsMark}${diff}`);
  }
  if (hasCors) L.push(`  ${NO_TAO} = cross-origin response with no matching Timing-Allow-Origin header; browser omits byte size (does not by itself indicate the request was CORS-blocked).`);
  if (r.vitals.lcpElement) {
    const el = r.vitals.lcpElement;
    L.push(`\nLCP ELEMENT: ${elTag(el)}${el.src ? ' src=' + el.src : ''}`);
  }
  if (r.vitals.clsShifts?.length) {
    L.push(`\nCLS SHIFTS (top ${r.vitals.clsShifts.length})`);
    L.push('─'.repeat(90));
    for (const s of r.vitals.clsShifts) {
      L.push(`  ${fmtCls(s.value)}  ${fmtSources(s.sources)}`);
    }
  }
  L.push('\n3RD PARTY (by total duration)');
  L.push('─'.repeat(90));
  for (const t of r.thirdParty) {
    const label = t.entity === t.host ? t.host : `${t.host}  (${t.entity})`;
    L.push(`  ${fmtMs(t.totalDuration).padStart(7)}  ${String(t.requests).padStart(3)} req  ${t.category.padEnd(14)}  ${label}`);
  }
  if (r.vitals.longTasks?.length) {
    L.push('\nLONG TASKS (top 5)');
    L.push('─'.repeat(90));
    L.push('  (attribution: self = own script; same-origin-descendant = child frame same-origin; cross-origin-* = 3rd party)');
    for (const t of r.vitals.longTasks) {
      L.push(`  start ${fmtMs(t.startTime).padStart(7)}  dur ${fmtMs(t.duration).padStart(7)}  ${t.name}`);
    }
  }
  if (r.domStats) {
    L.push('\nDOM STATS');
    L.push('─'.repeat(90));
    L.push(`  total elements   ${String(r.domStats.total).padStart(6)}`);
    L.push(`  max depth        ${String(r.domStats.maxDepth).padStart(6)}   ${r.domStats.deepestElement || ''}`);
    L.push(`  max children     ${String(r.domStats.maxChildren).padStart(6)}   ${r.domStats.widestElement || ''}`);
  }
  if (r.redirects?.chain?.length > 1) {
    L.push(`\nREDIRECTS (${r.redirects.chain.length - 1} hop${r.redirects.chain.length - 1 > 1 ? 's' : ''}${r.redirects.totalMs != null ? `, cost ${fmtMs(r.redirects.totalMs)}` : ''})`);
    L.push('─'.repeat(90));
    r.redirects.chain.forEach((h, i) => {
      const arrow = i === 0 ? '  ' : '→ ';
      const status = h.status != null ? `[${h.status}]` : '[?]';
      L.push(`  ${arrow}${status} ${h.url}`);
    });
  }
  if (r.cacheTtl?.length) {
    L.push(`\nCACHE TTL (top ${r.cacheTtl.length} static assets: no cache-control, no-cache, no-store, or max-age < 7 days)`);
    L.push('─'.repeat(90));
    for (const c of r.cacheTtl) {
      const ttl = c.maxAge != null ? `${Math.round(c.maxAge / 86400)}d` : c.reason;
      L.push(`  ${c.type.padEnd(6)}  ${fmtBytes(c.bytes).padStart(9)}  ${ttl.padStart(8)}  ${c.url}`);
    }
  }
  const rb = r.renderBlocking;
  const rbTotal = (rb?.css?.length || 0) + (rb?.js?.length || 0);
  if (rbTotal) {
    L.push(`\nRENDER-BLOCKING (${rb.css.length} CSS, ${rb.js.length} JS in <head> without async/defer/module)`);
    L.push('─'.repeat(90));
    for (const c of rb.css) L.push(`  css   ${fmtMs(c.duration).padStart(7)}  ${fmtBytes(c.bytes).padStart(9)}  media=${c.media}  ${c.url}`);
    for (const j of rb.js) L.push(`  js    ${fmtMs(j.duration).padStart(7)}  ${fmtBytes(j.bytes).padStart(9)}  ${j.url}`);
  }
  if (r.imagesMissingDims?.length) {
    L.push(`\nIMAGES MISSING width/height (top ${r.imagesMissingDims.length}, CLS risk)`);
    L.push('─'.repeat(90));
    for (const i of r.imagesMissingDims) {
      const miss = [!i.hasWidth && 'width', !i.hasHeight && 'height'].filter(Boolean).join('+');
      L.push(`  ${miss.padEnd(12)}  rendered ${(i.renderedWidth + '×' + i.renderedHeight).padStart(11)}  ${i.src}`);
    }
  }
  if (r.oversizedImages?.length) {
    L.push(`\nOVERSIZED IMAGES (top ${r.oversizedImages.length}, ratio > 2×)`);
    L.push('─'.repeat(90));
    for (const i of r.oversizedImages) {
      const nat = `${i.naturalWidth}×${i.naturalHeight}`;
      const rend = `${Math.round(i.renderedWidth * i.dpr)}×${Math.round(i.renderedHeight * i.dpr)}`;
      const save = i.savings ? '~' + fmtBytes(i.savings) : '—';
      L.push(`  ${(i.ratio + '×').padStart(6)}  ${nat.padStart(11)}  ${rend.padStart(11)}  ${save.padStart(9)}  ${i.src}`);
    }
  }
  L.push('\nTECH STACK');
  L.push('─'.repeat(90));
  L.push('  ' + (r.tech.join('   ') || 'none detected'));
  L.push('');
  return L.join('\n');
}

export function toMarkdown(r) {
  const md = [`# pageaudit — ${r.url}\n`];
  md.push(`- **Ran:** ${fmtTime(r.timestamp)}`);
  md.push(`- **Load:** ${fmtMs(r.loadMs)} • **TTFB:** ${fmtMs(r.vitals.ttfb)} • **FCP:** ${fmtMs(r.vitals.fcp)} • **LCP:** ${fmtMs(r.vitals.lcp)} • **CLS:** ${fmtCls(r.vitals.cls)} • **TBT:** ${fmtMs(r.vitals.tbt)} • **Fully loaded:** ${fmtMs(r.vitals.fullyLoaded)}\n`);
  if (r.findings?.length) {
    md.push(`## Findings (top ${r.findings.length})\n`);
    md.push(`| Severity | Metric | Issue | Savings | Detail |\n|---|---|---|---|---|`);
    for (const f of r.findings) {
      md.push(`| ${f.severity.toUpperCase()} | ${f.metrics?.join(', ') || '—'} | ${f.title} | ${fmtSavings(f.savings) || '—'} | ${f.detail || '—'} |`);
    }
    md.push('');
  }
  if (r.vitals.nav) {
    md.push(`## Timing breakdown\n`);
    md.push(`| Phase | Duration |\n|---|---:|`);
    for (const [key, label] of NAV_LABELS) if (r.vitals.nav[key] !== undefined) md.push(`| ${label} | ${fmtMs(r.vitals.nav[key])} |`);
    if (r.vitals.fullyLoaded != null) md.push(`| fully loaded | ${fmtMs(r.vitals.fullyLoaded)} |`);
    md.push('');
  }
  md.push(`## By type\n`);
  md.push(`| Type | Files | Total size | Avg duration | Total duration |\n|---|---:|---:|---:|---:|`);
  for (const t of r.assetsByType) md.push(`| ${t.type} | ${t.count} | ${fmtBytes(t.totalSize)} | ${fmtMs(t.avgDuration)} | ${fmtMs(t.totalDuration)} |`);
  md.push(`\n## Heavy assets (top ${r.assets.length} by duration)\n`);
  md.push(`| Duration | Size | Enc | Protocol | Type | URL |\n|---:|---:|---|---|---|---|`);
  for (const a of r.assets) md.push(`| ${fmtMs(a.duration)} | ${fmtBytes(a.size)} | ${fmtEnc(a.encoding)} | ${a.protocol || '—'} | ${a.type} | \`${a.url}\`${a.cors ? ` _${NO_TAO}_` : ''} |`);
  if (r.vitals.lcpElement) md.push(`\n**LCP element:** \`${elTag(r.vitals.lcpElement)}\`${r.vitals.lcpElement.src ? ` src=\`${r.vitals.lcpElement.src}\`` : ''}`);
  if (r.vitals.clsShifts?.length) {
    md.push(`\n## CLS shifts (top ${r.vitals.clsShifts.length})\n`);
    md.push(`| Value | Sources |\n|---:|---|`);
    for (const s of r.vitals.clsShifts) md.push(`| ${fmtCls(s.value)} | ${fmtSources(s.sources)} |`);
  }
  md.push(`\n## 3rd party (by total duration)\n`);
  md.push(`| Total | Requests | Category | Host | Entity |\n|---:|---:|---|---|---|`);
  for (const t of r.thirdParty) md.push(`| ${fmtMs(t.totalDuration)} | ${t.requests} | ${t.category} | \`${t.host}\` | ${t.entity} |`);
  if (r.vitals.longTasks?.length) {
    md.push(`\n## Long tasks (top 5)\n`);
    md.push(`| Start | Duration | Attribution |\n|---:|---:|---|`);
    for (const t of r.vitals.longTasks) md.push(`| ${fmtMs(t.startTime)} | ${fmtMs(t.duration)} | ${t.name} |`);
  }
  if (r.domStats) {
    md.push(`\n## DOM stats\n`);
    md.push(`| Metric | Value | Element |\n|---|---:|---|`);
    md.push(`| Total elements | ${r.domStats.total} | — |`);
    md.push(`| Max depth | ${r.domStats.maxDepth} | \`${r.domStats.deepestElement || '—'}\` |`);
    md.push(`| Max children | ${r.domStats.maxChildren} | \`${r.domStats.widestElement || '—'}\` |`);
  }
  if (r.redirects?.chain?.length > 1) {
    const hops = r.redirects.chain.length - 1;
    md.push(`\n## Redirects\n`);
    md.push(`${hops} hop${hops > 1 ? 's' : ''}${r.redirects.totalMs != null ? `, cost ${fmtMs(r.redirects.totalMs)}` : ''}.\n`);
    md.push(`| # | Status | URL |\n|---:|---|---|`);
    r.redirects.chain.forEach((h, i) => md.push(`| ${i + 1} | ${h.status ?? '?'} | \`${h.url}\` |`));
  }
  if (r.cacheTtl?.length) {
    md.push(`\n## Cache TTL\n`);
    md.push(`Top ${r.cacheTtl.length} static assets with missing or short (< 7 days) \`Cache-Control\`.\n`);
    md.push(`| Type | Bytes | TTL | Cache-Control | URL |\n|---|---:|---|---|---|`);
    for (const c of r.cacheTtl) {
      const ttl = c.maxAge != null ? `${Math.round(c.maxAge / 86400)}d` : c.reason;
      md.push(`| ${c.type} | ${fmtBytes(c.bytes)} | ${ttl} | \`${c.cacheControl || '—'}\` | \`${c.url}\` |`);
    }
  }
  const rb = r.renderBlocking;
  if ((rb?.css?.length || 0) + (rb?.js?.length || 0)) {
    md.push(`\n## Render-blocking\n`);
    md.push(`${rb.css.length} CSS, ${rb.js.length} JS in \`<head>\` without \`async\`/\`defer\`/\`type=module\`.\n`);
    md.push(`| Kind | Duration | Bytes | Detail | URL |\n|---|---:|---:|---|---|`);
    for (const c of rb.css) md.push(`| css | ${fmtMs(c.duration)} | ${fmtBytes(c.bytes)} | media=${c.media} | \`${c.url}\` |`);
    for (const j of rb.js) md.push(`| js | ${fmtMs(j.duration)} | ${fmtBytes(j.bytes)} | — | \`${j.url}\` |`);
  }
  if (r.imagesMissingDims?.length) {
    md.push(`\n## Images missing width/height\n`);
    md.push(`Top ${r.imagesMissingDims.length}. CLS risk: browser cannot reserve space before the image loads.\n`);
    md.push(`| Missing | Rendered | URL |\n|---|---|---|`);
    for (const i of r.imagesMissingDims) {
      const miss = [!i.hasWidth && 'width', !i.hasHeight && 'height'].filter(Boolean).join('+');
      md.push(`| ${miss} | ${i.renderedWidth}×${i.renderedHeight} | \`${i.src}\` |`);
    }
  }
  if (r.oversizedImages?.length) {
    md.push(`\n## Oversized images (top ${r.oversizedImages.length}, ratio > 2×)\n`);
    md.push(`| Ratio | Natural | Rendered @ DPR | Est. savings | URL |\n|---:|---|---|---:|---|`);
    for (const i of r.oversizedImages) {
      const nat = `${i.naturalWidth}×${i.naturalHeight}`;
      const rend = `${Math.round(i.renderedWidth * i.dpr)}×${Math.round(i.renderedHeight * i.dpr)}`;
      const save = i.savings ? '~' + fmtBytes(i.savings) : '—';
      md.push(`| ${i.ratio}× | ${nat} | ${rend} | ${save} | \`${i.src}\` |`);
    }
  }
  md.push(`\n## Tech stack\n`);
  md.push(r.tech.map(t => `- ${t}`).join('\n') || '_none detected_');
  return md.join('\n');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VITAL_THRESHOLDS = {
  FCP: [1800, 3000], LCP: [2500, 4000], CLS: [0.1, 0.25], TBT: [200, 600], TTFB: [800, 1800],
};
function vitalTier(label, value) {
  const t = VITAL_THRESHOLDS[label];
  if (!t || value == null || Number.isNaN(value)) return 'neutral';
  const [good, warn] = t;
  return value <= good ? 'good' : value <= warn ? 'warn' : 'bad';
}
function vitalItem(label, value, tier) {
  const cls = tier && tier !== 'neutral' ? ` v-${tier}` : '';
  return `<div class="v${cls}"><span class="v-l">${esc(label)}</span><span class="v-v">${esc(value)}</span></div>`;
}

const TYPE_COLOR = { img: 'var(--type-img)', script: 'var(--primary)', css: 'var(--type-css)', font: 'var(--type-font)', doc: 'var(--type-doc)' };
const typeColor = type => TYPE_COLOR[type] || 'var(--type-other)';

function shortLabel(url) {
  let s;
  try { s = new URL(url).pathname || url; } catch { s = url; }
  return s.length > 40 ? '…' + s.slice(-39) : s;
}

function timelineMarkers(vitals) {
  return [
    ['FCP', vitals.fcp, 'var(--warn)'],
    ['LCP', vitals.lcp, 'var(--primary)'],
    ['DCL', vitals.nav?.domContentLoaded, 'var(--muted)'],
    ['Onload', vitals.nav?.loadEvent, 'var(--muted)'],
    ['Fully loaded', vitals.fullyLoaded, 'var(--muted)'],
  ].filter(([, v]) => typeof v === 'number' && !Number.isNaN(v));
}

function timelineSection(vitals) {
  const markers = timelineMarkers(vitals);
  if (!markers.length) return '';
  const max = Math.max(...markers.map(([, v]) => v), 1);
  const sx = v => Math.min(1000, Math.max(0, (v / max) * 1000));
  const sorted = [...markers].sort((a, b) => a[1] - b[1]);
  let lastX = -Infinity, toggle = 0;
  const rows = sorted.map(([name, v, color]) => {
    const px = sx(v);
    toggle = (px - lastX < 90) ? (toggle ? 0 : 1) : 0;
    lastX = px;
    return { name, v, color, px, labelY: toggle ? 78 : 66 };
  });
  const lines = rows.map(m => `<line x1="${m.px.toFixed(1)}" y1="15" x2="${m.px.toFixed(1)}" y2="55" stroke="${m.color}" stroke-width="2"/>`).join('');
  const labels = rows.map(m => `<text x="${m.px.toFixed(1)}" y="${m.labelY}" font-size="11" fill="${m.color}" text-anchor="middle">${esc(m.name)} ${Math.round(m.v)}ms</text>`).join('');
  return `<section>
      <h2>Timeline</h2>
      <svg viewBox="0 0 1000 90" preserveAspectRatio="xMinYMid meet" width="100%" height="90" role="img" aria-label="Load timeline">
        <line x1="0" y1="35" x2="1000" y2="35" stroke="var(--rule)" stroke-width="1"/>
        ${lines}${labels}
      </svg>
    </section>`;
}

function waterfallSection(assets, vitals) {
  if (assets.length < 3 || !assets.every(a => typeof a.startTime === 'number')) return '';
  const rows = [...assets].sort((a, b) => a.startTime - b.startTime).slice(0, 30);
  const markers = timelineMarkers(vitals);
  const maxEnd = Math.max(...rows.map(a => a.startTime + a.duration), ...markers.map(([, v]) => v), 1);
  const labelW = 260, rightPad = 50, chartX0 = labelW, chartW = 1000 - labelW - rightPad;
  const rowH = 20, headerH = 20, h = headerH + rows.length * rowH + 10;
  const sx = t => chartX0 + (t / maxEnd) * chartW;
  const bars = rows.map((a, i) => {
    const y = headerH + i * rowH;
    const bx = sx(a.startTime);
    const bw = Math.max(2, (a.duration / maxEnd) * chartW);
    const durInside = bw > 30;
    return `<g>
      <text x="4" y="${y + 14}" font-size="9" fill="var(--muted)">${esc(shortLabel(a.url))}</text>
      <rect x="${bx.toFixed(1)}" y="${y + 3}" width="${bw.toFixed(1)}" height="14" rx="2" fill="${typeColor(a.type)}"/>
      <text x="${(durInside ? bx + bw - 4 : bx + bw + 4).toFixed(1)}" y="${y + 14}" font-size="9" text-anchor="${durInside ? 'end' : 'start'}" fill="${durInside ? '#fff' : 'var(--muted)'}">${esc(fmtMs(a.duration))}</text>
    </g>`;
  }).join('');
  const markerLines = markers.map(([, v, color]) => `<line x1="${sx(v).toFixed(1)}" y1="0" x2="${sx(v).toFixed(1)}" y2="${h}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`).join('');
  return `<section>
      <h2>Waterfall <span class="count">${rows.length} requests</span></h2>
      <svg viewBox="0 0 1000 ${h}" preserveAspectRatio="xMinYMid meet" width="100%" height="${Math.min(h, 640)}" role="img" aria-label="Request waterfall">
        ${markerLines}${bars}
      </svg>
    </section>`;
}

function segBar(items, valueFn, labelFn) {
  const total = items.reduce((s, t) => s + valueFn(t), 0) || 1;
  return items.map(t => {
    const v = valueFn(t);
    if (!v) return '';
    const pct = (v / total) * 100;
    const showLabel = pct > 8;
    return `<div class="segbar-seg" style="width:${pct.toFixed(2)}%; background:${typeColor(t.type)};" title="${esc(t.type)}: ${esc(labelFn(t))}">${showLabel ? esc(shortType(t.type) + ' ' + labelFn(t)) : ''}</div>`;
  }).join('');
}
function assetsByTypeSection(assetsByType) {
  if (!assetsByType.length) return '';
  const legend = `<div class="segbar-legend">${assetsByType.map(t => `<span class="legend-item"><span class="legend-swatch" style="background:${typeColor(t.type)};"></span>${esc(shortType(t.type))} (${t.count})</span>`).join('')}</div>`;
  return `
      <div class="segbar-row">
        <div class="segbar-label">Requests</div>
        <div class="segbar">${segBar(assetsByType, t => t.count, t => String(t.count))}</div>
      </div>
      <div class="segbar-row">
        <div class="segbar-label">Duration</div>
        <div class="segbar">${segBar(assetsByType, t => t.totalDuration, t => fmtMs(t.totalDuration))}</div>
      </div>
      ${legend}`;
}

export function toHTML(r) {
  const vitals = [
    ['Load', fmtMs(r.loadMs), null],
    ['TTFB', fmtMs(r.vitals.ttfb), r.vitals.ttfb],
    ['FCP',  fmtMs(r.vitals.fcp), r.vitals.fcp],
    ['LCP',  fmtMs(r.vitals.lcp), r.vitals.lcp],
    ['CLS',  fmtCls(r.vitals.cls), r.vitals.cls],
    ['TBT',  fmtMs(r.vitals.tbt), r.vitals.tbt],
    ['Fully loaded', fmtMs(r.vitals.fullyLoaded), null],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pageaudit — ${esc(r.url)}</title>
<style>
  :root {
    --primary: #c02026;
    --primary-dark: #9a1a1e;
    --tint: #f6ddde;
    --ink: #131313;
    --muted: #636363;
    --faint: #b3b3b3;
    --rule: #eaeaea;
    --alt: #f7f7f7;
    --good: #28b936;
    --warn: #eea63a;
    --bad: #c02026;
    --type-img: #1264a3;
    --type-css: #7b4b94;
    --type-font: #d97706;
    --type-doc: #3d3d3d;
    --type-other: #b3b3b3;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink);
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--primary); text-decoration: none; }
  a:hover { color: var(--primary-dark); text-decoration: underline; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }

  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }

  .brandmark { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink); margin-bottom: 20px; }
  .brandmark .dot { width: 10px; height: 10px; background: var(--primary); display: inline-block; }
  h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; word-break: break-word; }
  h1 a { color: var(--ink); }
  h1 a:hover { color: var(--primary); }
  .ran { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; margin-bottom: 28px; }

  .vitals { display: flex; flex-wrap: wrap; gap: 24px 32px; padding: 16px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-bottom: 28px; }
  .v { display: flex; flex-direction: column; gap: 2px; }
  .v-l { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .v-v { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
  .v-good .v-v { color: var(--good); }
  .v-warn .v-v { color: var(--warn); }
  .v-bad  .v-v { color: var(--bad); }

  section { margin-bottom: 28px; }
  h2 { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 10px; color: var(--ink); }
  h2 .count { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 8px; }

  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); background: var(--alt); border-bottom: 1px solid var(--rule); white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tbl-scroll { overflow-x: auto; }

  .segbar-row { margin-bottom: 6px; display: grid; grid-template-columns: 80px 1fr; align-items: center; gap: 10px; }
  .segbar-label { font-size: 11px; color: var(--muted); }
  .segbar { display: flex; width: 100%; height: 22px; border-radius: 3px; overflow: hidden; background: var(--alt); }
  .segbar-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; font-weight: 600; white-space: nowrap; overflow: hidden; padding: 0 6px; }
  .segbar-legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 10px 0 16px; font-size: 11px; color: var(--muted); }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-swatch { width: 9px; height: 9px; border-radius: 2px; }

  .findings { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .finding { display: grid; grid-template-columns: 50px auto 1fr auto; align-items: baseline; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rule); }
  .finding:first-child { border-top: 0; }
  .sev { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 3px; color: #fff; text-transform: uppercase; text-align: center; }
  .sev-high { background: var(--bad); }
  .sev-med { background: var(--warn); }
  .sev-low { background: var(--faint); }
  .f-metrics { display: flex; gap: 4px; flex-wrap: wrap; }
  .metric-pill { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; padding: 1px 6px; border: 1px solid var(--rule); border-radius: 3px; color: var(--muted); background: var(--alt); }
  .f-body { display: flex; flex-direction: column; gap: 2px; }
  .f-title { font-size: 14px; font-weight: 600; color: var(--ink); }
  .f-detail { font-size: 12px; color: var(--muted); }
  .f-save { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

  .tech { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--ink); }
  .tech code { background: var(--tint); color: var(--ink); padding: 1px 6px; border-radius: 3px; margin: 0 4px 4px 0; display: inline-block; }
  .empty { color: var(--muted); font-size: 12px; }
  .tao { color: var(--muted); font-size: 10px; }

  footer { border-top: 1px solid var(--rule); margin-top: 40px; padding: 16px 0; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--muted); }

  @media (max-width: 640px) {
    .wrap { padding: 16px; }
    h1 { font-size: 20px; }
    .vitals { gap: 16px 24px; }
    .v-v { font-size: 18px; }
    .segbar-row { grid-template-columns: 60px 1fr; }
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="brandmark"><span class="dot"></span>pageaudit</div>

  <h1><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></h1>
  <div class="ran">Ran ${esc(fmtTime(r.timestamp))}</div>

  <div class="vitals">
    ${vitals.map(([label, value, raw]) => vitalItem(label, value, vitalTier(label, raw))).join('')}
  </div>

  ${r.findings?.length ? `<section>
    <h2>Findings <span class="count">top ${r.findings.length}</span></h2>
    <div class="findings">
      ${r.findings.map(f => `<div class="finding">
        <span class="sev sev-${f.severity}">${esc(f.severity)}</span>
        <div class="f-metrics">${(f.metrics || []).map(m => `<span class="metric-pill">${esc(m)}</span>`).join('')}</div>
        <div class="f-body">
          <span class="f-title">${esc(f.title)}</span>
          ${f.detail ? `<span class="f-detail">${esc(f.detail)}</span>` : ''}
        </div>
        <span class="f-save">${esc(fmtSavings(f.savings))}</span>
      </div>`).join('')}
    </div>
  </section>` : ''}

  ${timelineSection(r.vitals)}

  ${r.vitals.nav ? `<section>
    <h2>Timing breakdown</h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th>Phase</th><th class="num">Duration</th></tr></thead>
      <tbody>
        ${NAV_LABELS.filter(([key]) => r.vitals.nav[key] !== undefined).map(([key, label]) => `<tr>
          <td>${esc(label)}</td>
          <td class="num">${fmtMs(r.vitals.nav[key])}</td>
        </tr>`).join('')}
        ${r.vitals.fullyLoaded != null ? `<tr><td>fully loaded</td><td class="num">${fmtMs(r.vitals.fullyLoaded)}</td></tr>` : ''}
      </tbody>
    </table></div>
  </section>` : ''}

  <section>
    <h2>Assets by type <span class="count">${r.assetsByType.length} types</span></h2>
    ${assetsByTypeSection(r.assetsByType)}
    <div class="tbl-scroll"><table>
      <thead><tr><th>Type</th><th class="num">Files</th><th class="num">Total size</th><th class="num">Avg</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${r.assetsByType.map(t => `<tr>
          <td>${esc(t.type)}</td>
          <td class="num">${t.count}</td>
          <td class="num">${fmtBytes(t.totalSize)}</td>
          <td class="num">${fmtMs(t.avgDuration)}</td>
          <td class="num">${fmtMs(t.totalDuration)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>

  <section>
    <h2>Slowest ${r.assets.length} assets <span class="count">by duration</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">Duration</th><th class="num">Size</th><th>Enc</th><th>Protocol</th><th>Type</th><th>URL</th></tr></thead>
      <tbody>
        ${r.assets.map(a => `<tr>
          <td class="num">${fmtMs(a.duration)}</td>
          <td class="num">${fmtBytes(a.size)}</td>
          <td>${esc(fmtEnc(a.encoding))}</td>
          <td>${esc(a.protocol || '—')}</td>
          <td>${esc(a.type)}</td>
          <td class="mono"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a>${a.cors ? ` <span class="tao">${esc(NO_TAO)}</span>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${r.vitals.lcpElement ? `<p class="count" style="margin-top:8px; font-size:12px; color:var(--muted);">LCP element: <code>${esc(elTag(r.vitals.lcpElement))}</code>${r.vitals.lcpElement.src ? ` src=<code>${esc(r.vitals.lcpElement.src)}</code>` : ''}</p>` : ''}
  </section>

  ${waterfallSection(r.assets, r.vitals)}

  ${r.vitals.clsShifts?.length ? `<section>
    <h2>CLS shifts <span class="count">top ${r.vitals.clsShifts.length}</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">Value</th><th>Sources</th></tr></thead>
      <tbody>
        ${r.vitals.clsShifts.map(s => `<tr>
          <td class="num">${fmtCls(s.value)}</td>
          <td class="mono">${esc(fmtSources(s.sources))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  <section>
    <h2>Third parties <span class="count">${r.thirdParty.length} hosts</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">Total</th><th class="num">Req</th><th>Category</th><th>Host</th><th>Entity</th></tr></thead>
      <tbody>
        ${r.thirdParty.length ? r.thirdParty.map(t => `<tr>
          <td class="num">${fmtMs(t.totalDuration)}</td>
          <td class="num">${t.requests}</td>
          <td>${esc(t.category)}</td>
          <td class="mono">${esc(t.host)}</td>
          <td>${esc(t.entity)}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty">None.</td></tr>`}
      </tbody>
    </table></div>
  </section>

  ${r.vitals.longTasks?.length ? `<section>
    <h2>Long tasks <span class="count">top ${r.vitals.longTasks.length}</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">Start</th><th class="num">Duration</th><th>Attribution</th></tr></thead>
      <tbody>
        ${r.vitals.longTasks.map(t => `<tr>
          <td class="num">${fmtMs(t.startTime)}</td>
          <td class="num">${fmtMs(t.duration)}</td>
          <td class="mono">${esc(t.name)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  ${r.domStats ? `<section>
    <h2>DOM stats</h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th>Metric</th><th class="num">Value</th><th>Element</th></tr></thead>
      <tbody>
        <tr><td>Total elements</td><td class="num">${r.domStats.total}</td><td>—</td></tr>
        <tr><td>Max depth</td><td class="num">${r.domStats.maxDepth}</td><td class="mono">${esc(r.domStats.deepestElement || '—')}</td></tr>
        <tr><td>Max children</td><td class="num">${r.domStats.maxChildren}</td><td class="mono">${esc(r.domStats.widestElement || '—')}</td></tr>
      </tbody>
    </table></div>
  </section>` : ''}

  ${r.redirects?.chain?.length > 1 ? (() => {
    const hops = r.redirects.chain.length - 1;
    const cost = r.redirects.totalMs != null ? `, cost ${fmtMs(r.redirects.totalMs)}` : '';
    return `<section>
    <h2>Redirects <span class="count">${hops} hop${hops > 1 ? 's' : ''}${cost}</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">#</th><th>Status</th><th>URL</th></tr></thead>
      <tbody>
        ${r.redirects.chain.map((h, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td>${h.status ?? '?'}</td>
          <td class="mono"><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.url)}</a></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>`;
  })() : ''}

  ${r.cacheTtl?.length ? `<section>
    <h2>Cache TTL <span class="count">${r.cacheTtl.length} static assets, missing or &lt; 7 days</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th>Type</th><th class="num">Bytes</th><th>TTL</th><th>Cache-Control</th><th>URL</th></tr></thead>
      <tbody>
        ${r.cacheTtl.map(c => {
          const ttl = c.maxAge != null ? Math.round(c.maxAge / 86400) + 'd' : c.reason;
          return `<tr>
            <td>${esc(c.type)}</td>
            <td class="num">${fmtBytes(c.bytes)}</td>
            <td>${esc(ttl)}</td>
            <td class="mono">${esc(c.cacheControl || '—')}</td>
            <td class="mono"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  ${(r.renderBlocking?.css?.length || 0) + (r.renderBlocking?.js?.length || 0) ? `<section>
    <h2>Render-blocking <span class="count">${r.renderBlocking.css.length} CSS, ${r.renderBlocking.js.length} JS</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th>Kind</th><th class="num">Duration</th><th class="num">Bytes</th><th>Detail</th><th>URL</th></tr></thead>
      <tbody>
        ${r.renderBlocking.css.map(c => `<tr>
          <td>css</td>
          <td class="num">${fmtMs(c.duration)}</td>
          <td class="num">${fmtBytes(c.bytes)}</td>
          <td>media=${esc(c.media)}</td>
          <td class="mono"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></td>
        </tr>`).join('')}
        ${r.renderBlocking.js.map(j => `<tr>
          <td>js</td>
          <td class="num">${fmtMs(j.duration)}</td>
          <td class="num">${fmtBytes(j.bytes)}</td>
          <td>—</td>
          <td class="mono"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.url)}</a></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  ${r.imagesMissingDims?.length ? `<section>
    <h2>Images missing width/height <span class="count">top ${r.imagesMissingDims.length}, CLS risk</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th>Missing</th><th>Rendered</th><th>URL</th></tr></thead>
      <tbody>
        ${r.imagesMissingDims.map(i => {
          const miss = [!i.hasWidth && 'width', !i.hasHeight && 'height'].filter(Boolean).join('+');
          return `<tr>
            <td>${esc(miss)}</td>
            <td>${i.renderedWidth}×${i.renderedHeight}</td>
            <td class="mono"><a href="${esc(i.src)}" target="_blank" rel="noopener">${esc(i.src)}</a></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  ${r.oversizedImages?.length ? `<section>
    <h2>Oversized images <span class="count">top ${r.oversizedImages.length}, ratio &gt; 2×</span></h2>
    <div class="tbl-scroll"><table>
      <thead><tr><th class="num">Ratio</th><th>Natural</th><th>Rendered @ DPR</th><th class="num">Est. savings</th><th>URL</th></tr></thead>
      <tbody>
        ${r.oversizedImages.map(i => `<tr>
          <td class="num">${i.ratio}×</td>
          <td>${i.naturalWidth}×${i.naturalHeight}</td>
          <td>${Math.round(i.renderedWidth * i.dpr)}×${Math.round(i.renderedHeight * i.dpr)}</td>
          <td class="num">${i.savings ? '~' + fmtBytes(i.savings) : '—'}</td>
          <td class="mono"><a href="${esc(i.src)}" target="_blank" rel="noopener">${esc(i.src)}</a></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </section>` : ''}

  <section>
    <h2>Tech stack <span class="count">${r.tech.length} detected</span></h2>
    ${r.tech.length ? `<div class="tech">${r.tech.map(t => `<code>${esc(t)}</code>`).join('')}</div>` : '<div class="empty">None detected.</div>'}
  </section>

  <footer>
    <span>MIT</span>
    <span><a href="https://github.com/leo26dandy/pageaudit" target="_blank" rel="noopener">github.com/leo26dandy/pageaudit</a></span>
  </footer>

</div>
</body>
</html>`;
}
