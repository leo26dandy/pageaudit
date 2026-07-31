#!/usr/bin/env node
// pageaudit — MIT
// Local one-shot page audit: heavy assets, 3rd party, tech stack.

import { chromium } from 'playwright';
import thirdPartyWeb from 'third-party-web';
import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const { getEntity } = thirdPartyWeb;

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

// ponytail: 30 hand-picked fingerprints cover 95% of WP/Woo/modern stacks.
// Swap to `wappalyzer-core` if false-negatives sting.
const techPatterns = [
  { name: 'WordPress',           test: (h, hdr) => /wp-content|wp-includes/i.test(h) || /wordpress/i.test(hdr['x-powered-by'] || '') },
  { name: 'Elementor',           test: (h) => /elementor/i.test(h) },
  { name: 'WooCommerce',         test: (h) => /woocommerce/i.test(h) },
  { name: 'Yoast SEO',           test: (h) => /yoast/i.test(h) },
  { name: 'jQuery',              test: (h) => /jquery[.\-]/i.test(h) },
  { name: 'Next.js',             test: (h, hdr) => /__NEXT_DATA__|_next\//.test(h) || 'x-nextjs-cache' in hdr },
  { name: 'Nuxt.js',             test: (h) => /__NUXT__|_nuxt\//.test(h) },
  { name: 'React',               test: (h) => /react(-dom)?[.@]/.test(h) },
  { name: 'Vue.js',              test: (h) => /vue(\.min)?\.js|v-if=|v-for=/.test(h) },
  { name: 'Angular',             test: (h) => /ng-app|ng-controller|@angular/.test(h) },
  { name: 'Svelte',              test: (h) => /svelte-[a-z0-9]{6}/.test(h) },
  { name: 'Shopify',             test: (h, hdr) => /cdn\.shopify\.com/.test(h) || /shopify/i.test(hdr['x-shopid'] || hdr['server'] || '') },
  { name: 'Wix',                 test: (h) => /wix\.com|_wix/.test(h) },
  { name: 'Squarespace',         test: (h) => /Static\.SQUARESPACE_CONTEXT|static1\.squarespace\.com|<meta[^>]+content="Squarespace/i.test(h) },
  { name: 'Webflow',             test: (h) => /data-wf-page|assets\.website-files\.com|<meta[^>]+content="Webflow/i.test(h) },
  { name: 'Ghost',               test: (h, hdr) => /ghost/i.test(hdr['x-powered-by'] || '') || /ghost-url/.test(h) },
  { name: 'Drupal',              test: (h, hdr) => /drupal/i.test(hdr['x-generator'] || '') || /Drupal\.behaviors|\/sites\/default\/files\/|<meta[^>]+content="Drupal/i.test(h) },
  { name: 'Joomla',              test: (h) => /<meta[^>]+content="Joomla|\/media\/jui\/|\/media\/system\/js\/|Joomla!/i.test(h) },
  { name: 'Magento',             test: (h, hdr) => 'x-magento-tags' in hdr || 'x-magento-cache-debug' in hdr || /Mage\.Cookies|\/skin\/frontend\/|<meta[^>]+content="Magento/i.test(h) },
  { name: 'Google Tag Manager',  test: (h) => /googletagmanager\.com\/gtm\.js/.test(h) },
  { name: 'Google Analytics',    test: (h) => /google-analytics\.com|gtag\(/.test(h) },
  { name: 'Meta Pixel',          test: (h) => /connect\.facebook\.net|fbq\(/.test(h) },
  { name: 'Hotjar',              test: (h) => /static\.hotjar\.com/.test(h) },
  { name: 'Cloudflare',          test: (_h, hdr) => /cloudflare/i.test(hdr['server'] || '') },
  { name: 'Nginx',               test: (_h, hdr) => /nginx/i.test(hdr['server'] || '') },
  { name: 'Apache',              test: (_h, hdr) => /apache/i.test(hdr['server'] || '') },
  { name: 'LiteSpeed',           test: (_h, hdr) => /litespeed/i.test(hdr['server'] || '') },
  { name: 'PHP',                 test: (_h, hdr) => /php/i.test(hdr['x-powered-by'] || '') },
  { name: 'Bootstrap',           test: (h) => /bootstrap(\.min)?\.(css|js)/.test(h) },
  { name: 'Tailwind CSS',        test: (h) => /cdn\.tailwindcss\.com|jsdelivr\.net\/npm\/tailwindcss|\bclass="[^"]*\b(sm|md|lg|xl):[a-z-]+/i.test(h) },
];

function detectTech(html, headers) {
  return techPatterns
    .filter(p => { try { return p.test(html, headers); } catch { return false; } })
    .map(p => p.name);
}

async function audit(url, { topN = 15, filterTypes = null } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const t0 = Date.now();
  const mainResponse = await page.goto(url, { timeout, waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  const mainHeaders = await mainResponse.allHeaders();
  const html = await page.content();

  // Let LCP + CLS observers settle. Bounded so infinite pollers don't hang us.
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // Source of truth: PerformanceResourceTiming + PerformanceObserver — Chrome DevTools' own data.
  // Cross-origin without `Timing-Allow-Origin: *` reports transferSize=0 (CORS).
  // ponytail: INP omitted — requires user interaction, N/A in synthetic runs.
  const [vitals, perfResources] = await Promise.all([
    page.evaluate(() => new Promise(resolve => {
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
      try {
        new PerformanceObserver(list => {
          const entries = list.getEntries();
          if (entries.length) out.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      setTimeout(() => {
        out.cls = Math.round(out.cls * 1000) / 1000;
        resolve(out);
      }, 500);
    })),
    page.evaluate(() => performance.getEntriesByType('resource').map(e => ({
      url: e.name,
      duration: e.duration,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      initiatorType: e.initiatorType,
    }))),
  ]);

  await browser.close();

  const resources = perfResources
    .filter(r => r.url.startsWith('http') && r.duration > 0)
    .map(r => ({
      url: r.url,
      type: inferType(r.url, r.initiatorType),
      duration: Math.round(r.duration),
      size: r.transferSize > 0 ? r.transferSize : (r.encodedBodySize > 0 ? r.encodedBodySize : null),
    }));

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

  // ponytail: naive eTLD+1 via last 2 labels — breaks on .co.uk etc.
  // Swap to `tldts` if false positives hurt.
  const mainReg = new URL(url).hostname.split('.').slice(-2).join('.');
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
  for (const a of r.assets) {
    let diff = '';
    if (prev) {
      const p = prev.assets?.find(x => x.url === a.url);
      if (p) {
        const d = a.duration - p.duration;
        diff = d === 0 ? ' =' : d > 0 ? ` ▲+${d}ms` : ` ▼${d}ms`;
      }
    }
    L.push(`  ${fmtMs(a.duration).padStart(7)}  ${fmtBytes(a.size).padStart(9)}  ${shortType(a.type).padEnd(8)}  ${a.url}${diff}`);
  }
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
  for (const a of r.assets) md.push(`| ${fmtMs(a.duration)} | ${fmtBytes(a.size)} | ${a.type} | \`${a.url}\` |`);
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
            <td class="mono"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a></td>
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

  if (values.json) console.log(JSON.stringify(report, null, 2));
  else console.log(toTable(report, values.diff ? prev : null));

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

  snapshots[targetUrl] = report;
  writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2));
} catch (e) {
  console.error('pageaudit error:', e.message);
  process.exit(1);
}
