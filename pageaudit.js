#!/usr/bin/env node
// pageaudit — MIT
// Local one-shot page audit: heavy assets, 3rd party, tech stack.

import { chromium } from 'playwright';
import thirdPartyWeb from 'third-party-web';
import { getDomain } from 'tldts';
import Wappalyzer from 'wappalyzer';
import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { getEntity } = thirdPartyWeb;

import Wappalyzer from 'wappalyzer';
const require = createRequire(import.meta.url);
const wappalyzerPath = join(require.resolve('wappalyzer'), '..');
const { setTechnologies, setCategories, analyze, resolve } = Wappalyzer;

const categories = JSON.parse(
  readFileSync(join(wappalyzerPath, 'categories.json'), 'utf8')
);
setCategories(categories);

const technologies = {};
for (const file of readdirSync(join(wappalyzerPath, 'technologies'))) {
  const data = JSON.parse(
    readFileSync(join(wappalyzerPath, 'technologies', file), 'utf8')
  );
  Object.assign(technologies, data);
}
setTechnologies(technologies);

const { values, positionals } = parseArgs({
  options: {
    json:    { type: 'boolean' },
    html:    { type: 'string' },
    md:      { type: 'string' },
    share:   { type: 'boolean' },
    diff:    { type: 'boolean' },
    top:     { type: 'string', default: '15' },
    filter:  { type: 'string' },
    timeout: { type: 'string', default: '30000' },
    fail:    { type: 'boolean' },
    help:    { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`pageaudit <url> [options]

  --json              JSON to stdout
  --html <file>       write HTML report
  --md <file>         write Markdown report
  --share             upload HTML as GitHub Gist (needs gh CLI, gh auth login)
  --diff              show diff vs previous run
  --fail              exit 1 if regression found (LCP +10% or total duration +10%)
  --top <n>           show top N heavy assets and 3rd parties (default 15)
  --filter <types>    only show assets of given types, comma-separated
                      (e.g. img,font,script — see BY TYPE section for names)
  --timeout <ms>      page load timeout (default 30000)
  -h, --help          this help

  Snapshots stored at ~/.pageaudit/snapshots.json for --diff.
`);
  process.exit(values.help ? 0 : 1);
}

const targetUrl = positionals[0];
const timeout = parseInt(values.timeout, 10);
const topN = Math.max(1, parseInt(values.top, 10) || 15);
const filterTypes = values.filter
  ? values.filter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  : null;

const stateDir = join(homedir(), '.pageaudit');
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
const snapshotFile = join(stateDir, 'snapshots.json');
const snapshots = existsSync(snapshotFile)
  ? JSON.parse(readFileSync(snapshotFile, 'utf8'))
  : {};

function detectTech(html, headers) {
  try {
    const detections = analyze({ html, headers });
    return resolve(detections).map(t => t.name);
  } catch {
    return [];
  }
}

async function audit(url, { topN = 15, filterTypes = null } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture headers for CORS/TAO diagnosis
  const responseHeaders = new Map();
  page.on('response', res => {
    const url = res.url();
    if (!url.startsWith('http')) return;
    responseHeaders.set(url, res.headers());
  });

  const t0 = Date.now();
  const mainResponse = await page.goto(url, { timeout, waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  const mainHeaders = await mainResponse.allHeaders();
  const html = await page.content();

  // Source of truth: PerformanceResourceTiming + PerformanceObserver — Chrome DevTools' own data.
  // Cross-origin without `Timing-Allow-Origin: *` reports transferSize=0 (CORS).
  // ponytail: INP omitted — requires user interaction, N/A in synthetic runs.
  // Let LCP + CLS observers settle. Bounded so infinite pollers don't hang us.
  const vitals = await page.evaluate(() => new Promise(resolve => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint');
    const out = {
      ttfb: nav.responseStart,
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadEvent: nav.loadEventEnd,
      fcp: paint.find(p => p.name === 'first-contentful-paint')?.startTime,
      lcp: null,
      cls: 0,
    };
    let lastActivity = Date.now();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      out.cls = Math.round(out.cls * 1000) / 1000;
      resolve(out);
    };
    const maybeSettle = () => {
      if (Date.now() - lastActivity > 2000) done();
    };
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) { out.lcp = e.startTime; lastActivity = Date.now(); }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) { if (!e.hadRecentInput) { out.cls += e.value; lastActivity = Date.now(); } }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    const tick = setInterval(maybeSettle, 250);
    setTimeout(() => { clearInterval(tick); done(); }, 10000);
  }));
  const perfResources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({
    url: e.name,
    duration: e.duration,
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    initiatorType: e.initiatorType,
  })));

  await browser.close();

  const resources = perfResources
    .filter(r => r.url.startsWith('http') && r.duration > 0)
    .map(r => {
      const h = responseHeaders.get(r.url) || {};
      const size = r.transferSize > 0 ? r.transferSize : (r.encodedBodySize > 0 ? r.encodedBodySize : null);
      const isCors = size === null && !h['timing-allow-origin'];
      return {
        url: r.url,
        type: inferType(r.url, r.initiatorType),
        duration: Math.round(r.duration),
        size,
        cors: isCors,
        contentType: h['content-type'] || null,
      };
    });

  // Aggregate all resources by type — bird's-eye view before drilling into individuals.
  const typeAgg = {};
  for (const r of resources) {
    if (!typeAgg[r.type]) typeAgg[r.type] = { count: 0, totalSize: 0, totalDuration: 0 };
    typeAgg[r.type].count++;
    typeAgg[r.type].totalSize += r.size || 0;
    typeAgg[r.type].totalDuration += r.duration;
  }
  const assetsByType = Object.entries(typeAgg).map(([type, s]) => ({
    type,
    count: s.count,
    totalSize: s.totalSize,
    totalDuration: s.totalDuration,
    avgDuration: Math.round(s.totalDuration / s.count),
  })).sort((a, b) => b.totalDuration - a.totalDuration);

  const filtered = filterTypes ? resources.filter(r => filterTypes.includes(r.type)) : resources;
  const assets = [...filtered]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, topN);

  // tldts handles real eTLD+1 rules — .co.uk, .com.au, .github.io etc.
  const mainReg = getDomain(url);
  // Group by hostname (per-subdomain granularity for debugging — devs want to see
  // each clarity.ms subdomain's cost separately, not collapsed into one row).
  const byHost = new Map();
  for (const r of resources) {
    let host;
    try { host = new URL(r.url).hostname; } catch { continue; }
    if (host.endsWith(mainReg)) continue;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(r);
  }
  const thirdParty = [...byHost.entries()].map(([host, list]) => {
    const entity = getEntity(list[0].url);
    return {
      host,
      entity: entity?.name || host,
      category: entity?.categories?.[0] || 'unknown',
      requests: list.length,
      totalDuration: Math.round(list.reduce((s, x) => s + x.duration, 0)),
    };
  }).sort((a, b) => b.totalDuration - a.totalDuration).slice(0, topN);

  const tech = detectTech(html, mainHeaders);

  return { url, timestamp: new Date().toISOString(), loadMs, vitals, assetsByType, assets, thirdParty, tech };
}

const fmtBytes = n => !n ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const fmtMs = n => n ? Math.round(n) + 'ms' : '—';
const fmtCls = n => (n === null || n === undefined) ? '—' : n.toFixed(3);
const shortType = t => t === 'xmlhttprequest' ? 'xhr' : t;
// Human-readable local time. Keeps ISO in JSON snapshots for machine parsing / diff.
const fmtTime = iso => {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    }).format(new Date(iso));
  } catch { return iso; }
};

// initiatorType from PerformanceResourceTiming tells us WHO fetched the asset
// (`link`, `css`, `script`) — not WHAT it is. Devs care about the resource kind.
// Infer from URL extension; fall back to initiatorType.
function inferType(url, initiatorType) {
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { return initiatorType || 'other'; }
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  if (/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)$/.test(path)) return 'img';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(path)) return 'audio';
  if (/\.css$/.test(path)) return 'css';
  if (/\.(js|mjs|cjs)$/.test(path)) return 'script';
  if (/\.(json|xml)$/.test(path)) return 'data';
  if (/\.(html?|php)$/.test(path)) return 'doc';
  return initiatorType || 'other';
}

function toTable(r, prev) {
  const L = [];
  L.push(`\npageaudit  ${r.url}`);
  L.push(`ran ${fmtTime(r.timestamp)}`);
  L.push(`load ${fmtMs(r.loadMs)}   ttfb ${fmtMs(r.vitals.ttfb)}   fcp ${fmtMs(r.vitals.fcp)}   lcp ${fmtMs(r.vitals.lcp)}   cls ${fmtCls(r.vitals.cls)}\n`);
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
    const corsMark = a.cors ? ' [cors]' : '';
    if (a.cors) hasCors = true;
    L.push(`  ${fmtMs(a.duration).padStart(7)}  ${fmtBytes(a.size).padStart(9)}  ${shortType(a.type).padEnd(8)}  ${a.url}${corsMark}${diff}`);
  }
  if (hasCors) L.push('  [cors] = cross-origin, no Timing-Allow-Origin → size unknown');
  L.push('\n3RD PARTY (by total duration)');
  L.push('─'.repeat(90));
  for (const t of r.thirdParty) {
    const label = t.entity === t.host ? t.host : `${t.host}  (${t.entity})`;
    L.push(`  ${fmtMs(t.totalDuration).padStart(7)}  ${String(t.requests).padStart(3)} req  ${t.category.padEnd(14)}  ${label}`);
  }
  L.push('\nTECH STACK');
  L.push('─'.repeat(90));
  L.push('  ' + (r.tech.join('   ') || 'none detected'));
  L.push('');
  return L.join('\n');
}

function toMarkdown(r) {
  const md = [`# pageaudit — ${r.url}\n`];
  md.push(`- **Ran:** ${fmtTime(r.timestamp)}`);
  md.push(`- **Load:** ${fmtMs(r.loadMs)} • **TTFB:** ${fmtMs(r.vitals.ttfb)} • **FCP:** ${fmtMs(r.vitals.fcp)} • **LCP:** ${fmtMs(r.vitals.lcp)} • **CLS:** ${fmtCls(r.vitals.cls)}\n`);
  md.push(`## By type\n`);
  md.push(`| Type | Files | Total size | Avg duration | Total duration |\n|---|---:|---:|---:|---:|`);
  for (const t of r.assetsByType) md.push(`| ${t.type} | ${t.count} | ${fmtBytes(t.totalSize)} | ${fmtMs(t.avgDuration)} | ${fmtMs(t.totalDuration)} |`);
  md.push(`\n## Heavy assets (top ${r.assets.length} by duration)\n`);
  md.push(`| Duration | Size | Type | URL |\n|---:|---:|---|---|`);
  for (const a of r.assets) md.push(`| ${fmtMs(a.duration)} | ${fmtBytes(a.size)} | ${a.type} | \`${a.url}\`${a.cors ? ' _(cors — no TAO, size unknown)_' : ''} |`);
  md.push(`\n## 3rd party (by total duration)\n`);
  md.push(`| Total | Requests | Category | Host | Entity |\n|---:|---:|---|---|---|`);
  for (const t of r.thirdParty) md.push(`| ${fmtMs(t.totalDuration)} | ${t.requests} | ${t.category} | \`${t.host}\` | ${t.entity} |`);
  md.push(`\n## Tech stack\n`);
  md.push(r.tech.map(t => `- ${t}`).join('\n') || '_none detected_');
  return md.join('\n');
}

function toHTML(r) {
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
        <thead><tr><th class="num">Duration</th><th class="num">Size</th><th>Type</th><th>URL</th></tr></thead>
        <tbody>
           ${r.assets.map(a => `<tr>
             <td class="num">${fmtMs(a.duration)}</td>
             <td class="num">${fmtBytes(a.size)}</td>
             <td>${esc(a.type)}</td>
             <td class="mono"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a>${a.cors ? ' <span style="color:var(--ink-mute); font-size:10px;">(cors)</span>' : ''}</td>
           </tr>`).join('')}
        </tbody>
      </table></div>
    </section>

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

// --- run ---
try {
  const prev = snapshots[targetUrl];
  const report = await audit(targetUrl, { topN, filterTypes });

  const showDiff = values.diff || values.fail;
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else console.log(toTable(report, showDiff ? prev : null));

  if (values.html) {
    writeFileSync(values.html, toHTML(report));
    console.error(`HTML written: ${values.html}`);
  }
  if (values.md) {
    writeFileSync(values.md, toMarkdown(report));
    console.error(`Markdown written: ${values.md}`);
  }

  if (values.share) {
    const tmp = join(stateDir, 'share.html');
    writeFileSync(tmp, toHTML(report));
    const out = execSync(`gh gist create --public --desc "pageaudit ${report.url}" ${tmp}`, { encoding: 'utf8' }).trim();
    console.error(`Shared: ${out}`);
  }

  // --fail: exit 1 on LCP or total-duration regression
  if (values.fail) {
    let fail = false;
    if (prev) {
      const prevTotal = (prev.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
      const nowTotal = (report.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
      if (report.vitals.lcp != null && prev.vitals?.lcp != null && report.vitals.lcp > prev.vitals.lcp * 1.1) {
        console.error(`LCP regression: ${fmtMs(prev.vitals.lcp)} → ${fmtMs(report.vitals.lcp)} (+${Math.round((report.vitals.lcp / prev.vitals.lcp - 1) * 100)}%)`);
        fail = true;
      }
      if (prevTotal > 0 && nowTotal > prevTotal * 1.1) {
        console.error(`Total duration regression: ${fmtMs(prevTotal)} → ${fmtMs(nowTotal)} (+${Math.round((nowTotal / prevTotal - 1) * 100)}%)`);
        fail = true;
      }
    } else {
      console.error('--fail: no previous snapshot for this URL; baseline recorded.');
    }
    if (fail) process.exitCode = 1;
  }

  snapshots[targetUrl] = report;
  writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2));
} catch (e) {
  console.error('pageaudit error:', e.message);
  process.exit(1);
}
