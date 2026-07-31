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
    timeout: { type: 'string', default: '30000' },
    help:    { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`pageaudit <url> [options]

  --json           JSON to stdout
  --html <file>    write HTML report
  --md <file>      write Markdown report
  --share          upload HTML as GitHub Gist (needs gh CLI, gh auth login)
  --diff           show diff vs previous run
  --timeout <ms>   page load timeout (default 30000)
  -h, --help       this help

Snapshots stored at ~/.pageaudit/snapshots.json for --diff.
`);
  process.exit(values.help ? 0 : 1);
}

const targetUrl = positionals[0];
const timeout = parseInt(values.timeout, 10);

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
  { name: 'Squarespace',         test: (h) => /squarespace/i.test(h) },
  { name: 'Webflow',             test: (h) => /webflow/i.test(h) },
  { name: 'Ghost',               test: (h, hdr) => /ghost/i.test(hdr['x-powered-by'] || '') || /ghost-url/.test(h) },
  { name: 'Drupal',              test: (h, hdr) => /drupal/i.test(hdr['x-generator'] || '') || /drupal/i.test(h) },
  { name: 'Joomla',              test: (h) => /joomla/i.test(h) },
  { name: 'Magento',             test: (h) => /mage-\w+|magento/i.test(h) },
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
  { name: 'Tailwind CSS',        test: (h) => /\bclass="[^"]*\b(flex|grid|text-\w+|bg-\w+|p-\d)\b/.test(h) },
];

function detectTech(html, headers) {
  return techPatterns
    .filter(p => { try { return p.test(html, headers); } catch { return false; } })
    .map(p => p.name);
}

async function audit(url) {
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
      type: r.initiatorType || 'other',
      duration: Math.round(r.duration),
      size: r.transferSize > 0 ? r.transferSize : (r.encodedBodySize > 0 ? r.encodedBodySize : null),
    }));

  const assets = [...resources]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 15);

  // ponytail: naive eTLD+1 via last 2 labels — breaks on .co.uk etc.
  // Swap to `tldts` if false positives hurt.
  const mainReg = new URL(url).hostname.split('.').slice(-2).join('.');
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
  }).sort((a, b) => b.totalDuration - a.totalDuration);

  const tech = detectTech(html, mainHeaders);

  return { url, timestamp: new Date().toISOString(), loadMs, vitals, assets, thirdParty, tech };
}

const fmtBytes = n => !n ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const fmtMs = n => n ? Math.round(n) + 'ms' : '—';
const fmtCls = n => (n === null || n === undefined) ? '—' : n.toFixed(3);

function toTable(r, prev) {
  const L = [];
  L.push(`\npageaudit  ${r.url}`);
  L.push(`ran ${r.timestamp}`);
  L.push(`load ${fmtMs(r.loadMs)}   ttfb ${fmtMs(r.vitals.ttfb)}   fcp ${fmtMs(r.vitals.fcp)}   lcp ${fmtMs(r.vitals.lcp)}   cls ${fmtCls(r.vitals.cls)}\n`);
  L.push('HEAVY ASSETS (by duration)');
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
    L.push(`  ${fmtMs(a.duration).padStart(7)}  ${fmtBytes(a.size).padStart(9)}  ${a.type.padEnd(10)}  ${a.url.slice(0, 50)}${diff}`);
  }
  L.push('\n3RD PARTY (by total duration)');
  L.push('─'.repeat(90));
  for (const t of r.thirdParty.slice(0, 15)) {
    L.push(`  ${fmtMs(t.totalDuration).padStart(7)}  ${String(t.requests).padStart(3)} req  ${t.category.padEnd(14)}  ${t.entity}`);
  }
  L.push('\nTECH STACK');
  L.push('─'.repeat(90));
  L.push('  ' + (r.tech.join('   ') || 'none detected'));
  L.push('');
  return L.join('\n');
}

function toMarkdown(r) {
  const md = [`# pageaudit — ${r.url}\n`];
  md.push(`- **Ran:** ${r.timestamp}`);
  md.push(`- **Load:** ${fmtMs(r.loadMs)} • **TTFB:** ${fmtMs(r.vitals.ttfb)} • **FCP:** ${fmtMs(r.vitals.fcp)} • **LCP:** ${fmtMs(r.vitals.lcp)} • **CLS:** ${fmtCls(r.vitals.cls)}\n`);
  md.push(`## Heavy assets (by duration)\n`);
  md.push(`| Duration | Size | Type | URL |\n|---:|---:|---|---|`);
  for (const a of r.assets) md.push(`| ${fmtMs(a.duration)} | ${fmtBytes(a.size)} | ${a.type} | \`${a.url}\` |`);
  md.push(`\n## 3rd party (by total duration)\n`);
  md.push(`| Total | Requests | Category | Entity |\n|---:|---:|---|---|`);
  for (const t of r.thirdParty.slice(0, 20)) md.push(`| ${fmtMs(t.totalDuration)} | ${t.requests} | ${t.category} | ${t.entity} |`);
  md.push(`\n## Tech stack\n`);
  md.push(r.tech.map(t => `- ${t}`).join('\n') || '_none detected_');
  return md.join('\n');
}

function toHTML(r) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>pageaudit ${esc(r.url)}</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:960px;margin:2em auto;padding:0 1em;color:#222}
h1{font-size:1.4em}h2{margin-top:2em;border-bottom:1px solid #ddd;padding-bottom:.3em}
table{width:100%;border-collapse:collapse;margin:1em 0}
th,td{text-align:left;padding:.4em .6em;border-bottom:1px solid #eee;font-size:.9em}
th{background:#f6f8fa}
.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:.2em .5em;margin:.15em;background:#eef;border-radius:3px;font-size:.85em}
code{font:12px monospace;word-break:break-all}
@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}th{background:#222}td,th{border-color:#333}.badge{background:#223}}
</style></head><body>
<h1>pageaudit — ${esc(r.url)}</h1>
<p><strong>Ran:</strong> ${r.timestamp}<br>
<strong>Load:</strong> ${fmtMs(r.loadMs)} • <strong>TTFB:</strong> ${fmtMs(r.vitals.ttfb)} • <strong>FCP:</strong> ${fmtMs(r.vitals.fcp)} • <strong>LCP:</strong> ${fmtMs(r.vitals.lcp)} • <strong>CLS:</strong> ${fmtCls(r.vitals.cls)}</p>
<h2>Heavy assets (by duration)</h2>
<table><tr><th>Duration</th><th>Size</th><th>Type</th><th>URL</th></tr>
${r.assets.map(a => `<tr><td class="num">${fmtMs(a.duration)}</td><td class="num">${fmtBytes(a.size)}</td><td>${esc(a.type)}</td><td><code>${esc(a.url)}</code></td></tr>`).join('')}
</table>
<h2>3rd party (by total duration)</h2>
<table><tr><th>Total</th><th>Requests</th><th>Category</th><th>Entity</th></tr>
${r.thirdParty.slice(0, 20).map(t => `<tr><td class="num">${fmtMs(t.totalDuration)}</td><td class="num">${t.requests}</td><td>${esc(t.category)}</td><td>${esc(t.entity)}</td></tr>`).join('')}
</table>
<h2>Tech stack</h2>
<div>${r.tech.map(t => `<span class="badge">${esc(t)}</span>`).join('') || '<em>none detected</em>'}</div>
</body></html>`;
}

// --- run ---
try {
  const prev = snapshots[targetUrl];
  const report = await audit(targetUrl);

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
