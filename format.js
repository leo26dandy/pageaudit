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

export function toTable(r, prev) {
  const L = [];
  L.push(`\npageaudit  ${r.url}`);
  L.push(`ran ${fmtTime(r.timestamp)}`);
  L.push(`load ${fmtMs(r.loadMs)}   ttfb ${fmtMs(r.vitals.ttfb)}   fcp ${fmtMs(r.vitals.fcp)}   lcp ${fmtMs(r.vitals.lcp)}   cls ${fmtCls(r.vitals.cls)}   tbt ${fmtMs(r.vitals.tbt)}   fully loaded ${fmtMs(r.vitals.fullyLoaded)}\n`);
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
  md.push(`\n## Tech stack\n`);
  md.push(r.tech.map(t => `- ${t}`).join('\n') || '_none detected_');
  return md.join('\n');
}

export function toHTML(r) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vitalCard = (label, value) => `
        <div class="stat-card">
          <div class="stat-label">${esc(label)}</div>
          <div class="stat-value">${esc(value)}</div>
        </div>`;
  const vitals = [
    ['Load', fmtMs(r.loadMs)],
    ['TTFB', fmtMs(r.vitals.ttfb)],
    ['FCP',  fmtMs(r.vitals.fcp)],
    ['LCP',  fmtMs(r.vitals.lcp)],
    ['CLS',  fmtCls(r.vitals.cls)],
    ['TBT',  fmtMs(r.vitals.tbt)],
    ['Fully loaded', fmtMs(r.vitals.fullyLoaded)],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pageaudit — ${esc(r.url)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #4a154b;
    --primary-press: #611f69;
    --primary-tint: #592466;
    --link-blue: #1264a3;
    --link-hover: #3860be;
    --canvas: #ffffff;
    --canvas-cream: #f4ede4;
    --canvas-lavender: #f9f0ff;
    --hairline: #e6e6e6;
    --ink: #1d1d1d;
    --ink-mute: #696969;
    --on-primary: #ffffff;
    --on-aubergine-mute: #d9bdde;
    --rounded-md: 8px;
    --rounded-lg: 12px;
    --rounded-xl: 16px;
    --rounded-pill: 90px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 16px;
    line-height: 1.55;
    color: var(--ink);
    background: var(--canvas);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  a { color: var(--link-blue); text-decoration: none; }
  a:hover { color: var(--link-hover); text-decoration: underline; }

  .hero { background: var(--primary); color: var(--on-primary); padding: 56px 24px 48px; }
  .hero-inner, .vitals-grid, .container-inner, .footer-inner { max-width: 1240px; margin: 0 auto; }
  .hero-eyebrow { font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: 0.96px; text-transform: uppercase; color: var(--on-aubergine-mute); margin-bottom: 16px; }
  .hero-title { font-size: 58px; font-weight: 600; line-height: 1.25; letter-spacing: -0.464px; margin: 0 0 12px; word-break: break-word; }
  .hero-title a { color: var(--on-primary); text-decoration: none; }
  .hero-title a:hover { color: var(--on-aubergine-mute); text-decoration: underline; }
  .hero-meta { font-size: 14px; line-height: 1.43; letter-spacing: 0.1px; color: var(--on-aubergine-mute); font-variant-numeric: tabular-nums; }

  .vitals-band { background: var(--canvas-cream); padding: 32px 24px; }
  .vitals-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
  .stat-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--rounded-xl); padding: 20px 24px; }
  .stat-label { font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: 0.96px; text-transform: uppercase; color: var(--ink-mute); }
  .stat-value { font-size: 32px; font-weight: 700; line-height: 1.12; letter-spacing: -0.256px; color: var(--primary); margin-top: 8px; font-variant-numeric: tabular-nums; }

  main { padding: 48px 24px 64px; }
  section { margin-bottom: 40px; }
  section:last-of-type { margin-bottom: 0; }
  .h2-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  h2 { font-size: 32px; font-weight: 700; line-height: 1.25; letter-spacing: -0.256px; color: var(--ink); margin: 0; }
  .count { font-size: 14px; color: var(--ink-mute); font-variant-numeric: tabular-nums; }

  .card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--rounded-xl); overflow: hidden; }
  .card-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 12px 20px; border-bottom: 1px solid var(--hairline); vertical-align: top; line-height: 1.43; }
  tr:last-child td { border-bottom: none; }
  th { font-size: 12px; font-weight: 700; line-height: 1; letter-spacing: 0.96px; text-transform: uppercase; color: var(--ink-mute); background: var(--canvas-lavender); white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }

  .badges { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge { display: inline-block; padding: 8px 20px; border: 2px solid var(--primary); color: var(--primary); border-radius: var(--rounded-pill); font-size: 14.4px; font-weight: 700; line-height: 1; letter-spacing: 0.144px; background: var(--canvas); }
  .empty { color: var(--ink-mute); font-size: 14px; font-style: italic; padding: 12px; }

  footer.bottom { background: var(--primary); color: var(--on-primary); padding: 40px 24px 32px; }
  .footer-inner { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .footer-brand { font-size: 22px; font-weight: 700; line-height: 1.33; letter-spacing: -0.02em; }
  .footer-meta { font-size: 14px; line-height: 1.43; letter-spacing: 0.1px; color: var(--on-aubergine-mute); font-variant-numeric: tabular-nums; }
  footer.bottom a { color: var(--on-primary); text-decoration: underline; }
  footer.bottom a:hover { color: var(--on-aubergine-mute); }

  @media (max-width: 992px) {
    .vitals-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 768px) {
    .hero { padding: 40px 16px 32px; }
    .hero-title { font-size: 32px; letter-spacing: -0.256px; }
    h2 { font-size: 24px; letter-spacing: -0.192px; }
    .vitals-band { padding: 24px 16px; }
    .vitals-grid { grid-template-columns: repeat(2, 1fr); }
    .stat-value { font-size: 28px; }
    main { padding: 32px 16px 48px; }
    footer.bottom { padding: 32px 16px 24px; }
  }
</style>
</head>
<body>

<header class="hero">
  <div class="hero-inner">
    <div class="hero-eyebrow">Page audit</div>
    <h1 class="hero-title"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></h1>
    <div class="hero-meta">Ran ${esc(fmtTime(r.timestamp))}</div>
  </div>
</header>

<section class="vitals-band">
  <div class="vitals-grid">
    ${vitals.map(([label, value]) => vitalCard(label, value)).join('')}
  </div>
</section>

<main>
  <div class="container-inner">

    ${r.vitals.nav ? `<section>
      <div class="h2-row">
        <h2>Timing breakdown</h2>
      </div>
      <div class="card card-scroll"><table>
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
      <div class="h2-row">
        <h2>Assets by type</h2>
        <span class="count">${r.assetsByType.length} types</span>
      </div>
      <div class="card card-scroll"><table>
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
      <div class="h2-row">
        <h2>Slowest ${r.assets.length} assets</h2>
        <span class="count">by duration</span>
      </div>
      <div class="card card-scroll"><table>
        <thead><tr><th class="num">Duration</th><th class="num">Size</th><th>Enc</th><th>Protocol</th><th>Type</th><th>URL</th></tr></thead>
        <tbody>
           ${r.assets.map(a => `<tr>
             <td class="num">${fmtMs(a.duration)}</td>
             <td class="num">${fmtBytes(a.size)}</td>
             <td>${esc(fmtEnc(a.encoding))}</td>
             <td>${esc(a.protocol || '—')}</td>
             <td>${esc(a.type)}</td>
             <td class="mono"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a>${a.cors ? ` <span style="color:var(--ink-mute); font-size:10px;">${esc(NO_TAO)}</span>` : ''}</td>
           </tr>`).join('')}
        </tbody>
      </table></div>
      ${r.vitals.lcpElement ? `<p class="count" style="margin-top:12px;">LCP element: <code class="mono">${esc(elTag(r.vitals.lcpElement))}</code>${r.vitals.lcpElement.src ? ` src=<code class="mono">${esc(r.vitals.lcpElement.src)}</code>` : ''}</p>` : ''}
    </section>

    ${r.vitals.clsShifts?.length ? `<section>
      <div class="h2-row">
        <h2>CLS shifts</h2>
        <span class="count">top ${r.vitals.clsShifts.length}</span>
      </div>
      <div class="card card-scroll"><table>
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
      <div class="h2-row">
        <h2>Third parties</h2>
        <span class="count">${r.thirdParty.length} hosts</span>
      </div>
      <div class="card card-scroll"><table>
        <thead><tr><th class="num">Total</th><th class="num">Req</th><th>Category</th><th>Host</th><th>Entity</th></tr></thead>
        <tbody>
          ${r.thirdParty.length ? r.thirdParty.map(t => `<tr>
            <td class="num">${fmtMs(t.totalDuration)}</td>
            <td class="num">${t.requests}</td>
            <td>${esc(t.category)}</td>
            <td class="mono">${esc(t.host)}</td>
            <td>${esc(t.entity)}</td>
          </tr>`).join('') : `<tr><td colspan="5" class="empty">None detected.</td></tr>`}
        </tbody>
      </table></div>
    </section>

    ${r.vitals.longTasks?.length ? `<section>
      <div class="h2-row">
        <h2>Long tasks</h2>
        <span class="count">top ${r.vitals.longTasks.length}</span>
      </div>
      <div class="card card-scroll"><table>
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

    <section>
      <div class="h2-row">
        <h2>Tech stack</h2>
        <span class="count">${r.tech.length} detected</span>
      </div>
      ${r.tech.length ? `<div class="badges">${r.tech.map(t => `<span class="badge">${esc(t)}</span>`).join('')}</div>` : '<div class="empty">None detected.</div>'}
    </section>

  </div>
</main>

<footer class="bottom">
  <div class="footer-inner">
    <div class="footer-brand">pageaudit</div>
    <div class="footer-meta">MIT · <a href="https://github.com/leo26dandy/pageaudit" target="_blank" rel="noopener">github.com/leo26dandy/pageaudit</a></div>
  </div>
</footer>

</body>
</html>`;
}
