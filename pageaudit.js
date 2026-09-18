#!/usr/bin/env node
// pageaudit — MIT
// Local one-shot page audit: heavy assets, 3rd party, tech stack.

import { chromium } from 'playwright';
import thirdPartyWeb from 'third-party-web';
import { getDomain } from 'tldts';
import Wappalyzer from 'wappalyzer-core';
import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { inferType, resourceSize, hasRegression } from './helpers.js';
import { toTable, toMarkdown, toHTML, fmtMs } from './format.js';

const { getEntity } = thirdPartyWeb;

const require = createRequire(import.meta.url);
const simpleWappalyzerPath = join(require.resolve('simple-wappalyzer'), '..');
const categories = JSON.parse(readFileSync(join(simpleWappalyzerPath, 'categories.json'), 'utf8'));
const technologies = JSON.parse(readFileSync(join(simpleWappalyzerPath, 'technologies.json'), 'utf8'));
Wappalyzer.setCategories(categories);
Wappalyzer.setTechnologies(technologies);

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

function detectTech(html, headers, scripts, meta, cookies, url) {
  try {
    // Format headers: { key: [value] }
    const formattedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      formattedHeaders[key.toLowerCase()] = [value];
    }
    // Format meta: { key: [value] }
    const formattedMeta = {};
    for (const [key, value] of Object.entries(meta)) {
      formattedMeta[key.toLowerCase()] = [value];
    }
    // Format cookies: parse into objects
    const formattedCookies = cookies.map(c => {
      const [name, ...rest] = c.split('=');
      return { name, value: rest.join('=') };
    });
    const detections = Wappalyzer.analyze({
      url,
      html,
      headers: formattedHeaders,
      scripts,
      meta: formattedMeta,
      cookies: formattedCookies,
    });
    return Wappalyzer.resolve(detections).map(t => t.name);
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
  const responseHeadersList = [];
  page.on('response', res => {
    const url = res.url();
    if (!url.startsWith('http')) return;
    responseHeaders.set(url, res.headers());
    responseHeadersList.push({ url, headers: res.headers() });
  });

  const t0 = Date.now();
  const mainResponse = await page.goto(url, { timeout, waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  const finalUrl = mainResponse?.url() || url;
  const mainHeaders = await mainResponse.allHeaders();
  const html = await page.content();

  // Collect Wappalyzer detection data
  const techData = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map(s => s.src).filter(Boolean);
    const meta = {};
    document.querySelectorAll('meta').forEach(m => {
      const key = m.getAttribute('name') || m.getAttribute('property');
      if (key) meta[key.toLowerCase()] = m.getAttribute('content');
    });
    return { scripts, meta };
  });

  // Source of truth: PerformanceResourceTiming + PerformanceObserver — Chrome DevTools' own data.
  // Cross-origin without `Timing-Allow-Origin: *` reports transferSize=0 (CORS).
  // ponytail: INP omitted — requires user interaction, N/A in synthetic runs.
  // Let LCP + CLS observers settle. Bounded so infinite pollers don't hang us.
  const vitals = await page.evaluate(() => new Promise(resolve => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint');
    // nav timing split — ms per phase, NaN/negative dropped (entry not supported/applicable)
    const navRaw = {
      redirect: nav.redirectEnd - nav.redirectStart,
      dns: nav.domainLookupEnd - nav.domainLookupStart,
      connect: nav.connectEnd - nav.connectStart,
      tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
      request: nav.responseStart - nav.requestStart,
      response: nav.responseEnd - nav.responseStart,
      domInteractive: nav.domInteractive,
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadEvent: nav.loadEventEnd,
    };
    const navSplit = {};
    for (const [k, v] of Object.entries(navRaw)) if (Number.isFinite(v) && v >= 0) navSplit[k] = Math.round(v);

    const out = {
      ttfb: nav.responseStart,
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadEvent: nav.loadEventEnd,
      onload: nav.loadEventEnd, // alias of loadEvent, mirrors GTmetrix copy
      fcp: paint.find(p => p.name === 'first-contentful-paint')?.startTime,
      lcp: null,
      lcpElement: null,
      cls: 0,
      clsShifts: [],
      nav: navSplit,
      tbt: 0,
      longTasks: [],
    };
    const clsShifts = [];
    const longTasks = [];
    let lastActivity = Date.now();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      out.cls = Math.round(out.cls * 1000) / 1000;
      clsShifts.sort((a, b) => b.value - a.value);
      out.clsShifts = clsShifts.slice(0, 5).map(s => ({ value: Math.round(s.value * 1000) / 1000, sources: s.sources }));
      longTasks.sort((a, b) => b.duration - a.duration);
      out.longTasks = longTasks.slice(0, 5).map(t => ({ startTime: Math.round(t.startTime), duration: Math.round(t.duration), name: t.name }));
      // TBT: blocking portion (>50ms) of long tasks between FCP and loadEventEnd (TTI stand-in)
      const fcpTime = out.fcp ?? 0;
      const loadEnd = navSplit.loadEvent ?? Infinity;
      out.tbt = Math.round(longTasks.reduce((sum, t) => (t.startTime >= fcpTime && t.duration > 50 && t.startTime <= loadEnd) ? sum + (t.duration - 50) : sum, 0));
      resolve(out);
    };
    const maybeSettle = () => {
      if (Date.now() - lastActivity > 2000) done();
    };
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (!entries.length) return;
        lastActivity = Date.now();
        const last = entries[entries.length - 1];
        out.lcp = last.startTime;
        const el = last.element; // can be null on cross-frame LCP
        out.lcpElement = el ? {
          tag: el.tagName,
          id: el.id || '',
          className: String(el.className || ''),
          src: el.tagName === 'IMG' ? (el.currentSrc || el.src || '') : '',
          snippet: (el.outerHTML || '').slice(0, 200),
        } : null;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          out.cls += e.value;
          lastActivity = Date.now();
          clsShifts.push({
            value: e.value,
            sources: (e.sources || []).map(s => ({
              tag: s.node?.tagName || '',
              id: s.node?.id || '',
              className: String(s.node?.className || ''),
              snippet: (s.node?.outerHTML || '').slice(0, 200),
            })),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          longTasks.push({ startTime: e.startTime, duration: e.duration, name: e.name });
          lastActivity = Date.now();
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    const tick = setInterval(maybeSettle, 250);
    setTimeout(() => { clearInterval(tick); done(); }, 10000);
  }));

  // approximate "fully loaded" via network idle — best-effort, capped so a chatty page can't hang us
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  vitals.fullyLoaded = Date.now() - t0;

  const perfResources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({
    url: e.name,
    duration: e.duration,
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    initiatorType: e.initiatorType,
    protocol: e.nextHopProtocol || null,
    startTime: e.startTime,
  })));

  await browser.close();

  // Extract cookies from set-cookie headers
  const cookies = responseHeadersList
    .flatMap(r => r.headers['set-cookie'] || [])
    .map(c => c.split(';')[0]);

  const resources = perfResources
    .filter(r => r.url.startsWith('http') && r.duration > 0)
    .map(r => {
      const h = responseHeaders.get(r.url) || {};
      const { size, cors: isCors } = resourceSize(r, h, finalUrl);
      return {
        url: r.url,
        type: inferType(r.url, r.initiatorType),
        duration: Math.round(r.duration),
        size,
        cors: isCors,
        contentType: h['content-type'] || null,
        protocol: r.protocol || null,
        encoding: h['content-encoding'] || null,
        startTime: Math.round(r.startTime),
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

  const tech = detectTech(html, mainHeaders, techData.scripts, techData.meta, cookies, url);

  return { url, timestamp: new Date().toISOString(), loadMs, vitals, assetsByType, assets, thirdParty, tech };
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
    if (prev) {
      const prevTotal = (prev.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
      const nowTotal = (report.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
      if (report.vitals.lcp != null && prev.vitals?.lcp != null && report.vitals.lcp > prev.vitals.lcp * 1.1) {
        console.error(`LCP regression: ${fmtMs(prev.vitals.lcp)} → ${fmtMs(report.vitals.lcp)} (+${Math.round((report.vitals.lcp / prev.vitals.lcp - 1) * 100)}%)`);
      }
      if (prevTotal > 0 && nowTotal > prevTotal * 1.1) {
        console.error(`Total duration regression: ${fmtMs(prevTotal)} → ${fmtMs(nowTotal)} (+${Math.round((nowTotal / prevTotal - 1) * 100)}%)`);
      }
    } else {
      console.error('--fail: no previous snapshot for this URL; baseline recorded.');
    }
    if (hasRegression(prev, report)) process.exitCode = 1;
  }

  snapshots[targetUrl] = report;
  writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2));
} catch (e) {
  console.error('pageaudit error:', e.message);
  process.exit(1);
}
