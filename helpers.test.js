import test from 'node:test';
import assert from 'node:assert/strict';
import { inferType, resourceSize, isSizeUnavailable, hasRegression, NO_TAO, buildFindings } from './helpers.js';
import { toTable, toMarkdown, toHTML } from './format.js';

test('inferType uses URL extension before initiator type', () => {
  assert.equal(inferType('https://example.com/font.WOFF2?v=1', 'css'), 'font');
  assert.equal(inferType('https://example.com/photo.avif', 'fetch'), 'img');
  assert.equal(inferType('https://example.com/app.mjs', 'other'), 'script');
  assert.equal(inferType('https://example.com/data.json', 'fetch'), 'data');
  assert.equal(inferType('not a URL', 'fetch'), 'fetch');
  assert.equal(inferType('https://example.com', 'doc'), 'doc');
  assert.equal(inferType('https://example.com/page', 'other'), 'other');
  assert.equal(inferType('https://example.com/style.CSS', 'unknown'), 'css');
  assert.equal(inferType('https://example.com/script.MJS', 'unknown'), 'script');
  assert.equal(inferType('https://example.com/image.webp', 'unknown'), 'img');
});

test('isSizeUnavailable handles origins and TAO', () => {
  assert.equal(isSizeUnavailable(null, {}, 'https://third.test/tracker.png', 'https://site.test/'), true);
  assert.equal(isSizeUnavailable(null, { 'timing-allow-origin': '*' }, 'https://third.test/tracker.png', 'https://site.test/'), false);
  assert.equal(isSizeUnavailable(null, { 'timing-allow-origin': 'https://site.test' }, 'https://third.test/tracker.png', 'https://site.test/'), false);
  assert.equal(isSizeUnavailable(null, { 'timing-allow-origin': 'https://other.test' }, 'https://third.test/tracker.png', 'https://site.test/'), true);
  assert.equal(isSizeUnavailable(null, {}, 'https://site.test/empty.gif', 'https://site.test/page'), false);
  assert.equal(isSizeUnavailable(0, {}, 'https://third.test/pixel.gif', 'https://site.test/'), false);
  assert.equal(isSizeUnavailable(120, {}, 'https://third.test/pixel.gif', 'https://site.test/'), false);
});

test('resourceSize distinguishes cached, empty, and unavailable bytes', () => {
  const base = {url: 'https://site.test/a', transferSize: 0, encodedBodySize: 0};
  assert.deepEqual(resourceSize({...base, responseStart: 10}, {}, 'https://site.test/'), {size: 0, cors: false});
  assert.deepEqual(resourceSize({...base, url: 'https://cdn.test/a', responseStart: 10}, {}, 'https://site.test/'), {size: null, cors: true});
  assert.deepEqual(resourceSize({...base, url: 'https://cdn.test/a', responseStart: 10}, {'timing-allow-origin': '*'}, 'https://site.test/'), {size: 0, cors: false});
  assert.deepEqual(resourceSize({...base, responseStart: 0}, {}, 'https://site.test/'), {size: 0, cors: false});
});

test('hasRegression uses strict greater-than 10 percent', () => {
  const report = (lcp, totalDuration) => ({ vitals: { lcp }, assetsByType: [{ totalDuration }] });
  assert.equal(hasRegression(null, report(2000, 2000)), false);
  assert.equal(hasRegression(report(1000, 1000), report(1100, 1100)), false);
  assert.equal(hasRegression(report(1000, 1000), report(1000, 1100)), false);
  assert.equal(hasRegression(report(1000, 1000), report(1101, 1000)), true);
  assert.equal(hasRegression(report(1000, 1000), report(1000, 1101)), true);
  assert.equal(hasRegression(report(null, 0), report(1200, 1200)), false);
  assert.equal(hasRegression(report(1000, 0), report(null, 1200)), false);
});

test('terminal, Markdown, and HTML render missing-size marker', () => {
  const report = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [{url: 'https://cdn.test/a.js', duration: 1, size: null, type: 'script', cors: true}], thirdParty: [], tech: []};
  for (const output of [toTable(report), toMarkdown(report), toHTML(report)]) assert.match(output, new RegExp(NO_TAO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('renderers stay backward compatible without v0.5 vitals fields, and render them when present', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(output.includes('TIMING BREAKDOWN'), false);
    assert.equal(output.includes('Timing breakdown'), false);
  }
  const withNav = {...base, vitals: {...base.vitals, tbt: 30, fullyLoaded: 250, nav: {redirect: 0, dns: 5, connect: 10, tls: 0, request: 20, response: 15, domInteractive: 100, domContentLoaded: 120, loadEvent: 200}}};
  assert.match(toTable(withNav), /TIMING BREAKDOWN/);
  assert.match(toMarkdown(withNav), /Timing breakdown/);
  assert.match(toHTML(withNav), /Timing breakdown/);
});

test('buildFindings ranks by severity and caps at 5', () => {
  const r = {
    vitals: { lcp: 5000, cls: 0.3, tbt: 700, ttfb: 200 },
    oversizedImages: [{ savings: 800000 }],
    renderBlocking: { css: [{ duration: 300 }, { duration: 250 }], js: [{ duration: 100 }] },
    cacheTtl: [1, 2, 3].map(() => ({ bytes: 200000 })),
    redirects: { chain: [1, 2, 3], totalMs: 1500 },
    imagesMissingDims: [1, 2, 3, 4, 5, 6],
    domStats: { total: 4000, maxDepth: 40, deepestElement: '<div>' },
  };
  const f = buildFindings(r);
  assert.ok(f.length <= 5);
  assert.equal(f[0].severity, 'high');
  const highs = f.filter(x => x.severity === 'high');
  assert.ok(highs.length >= 3);
  assert.equal(f.every(x => x.severity === 'high'), true);
});

test('buildFindings returns [] on a healthy page', () => {
  assert.deepEqual(buildFindings({ vitals: { lcp: 1500, cls: 0.05, tbt: 100, ttfb: 200 } }), []);
});

test('renderers include findings section when present', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/FINDINGS|Findings/.test(output), false);
  }
  const withFindings = {...base, findings: [
    { id: 'lcp', title: 'LCP is 5000ms', severity: 'high', metrics: ['LCP'], savings: { ms: 5000 }, detail: 'above 4000ms (poor)' },
  ]};
  assert.match(toTable(withFindings), /FINDINGS/);
  assert.match(toMarkdown(withFindings), /Findings/);
  assert.match(toHTML(withFindings), /Findings/);
  assert.match(toHTML(withFindings), /sev-high/);
  assert.match(toHTML(withFindings), /metric-pill/);
});

test('renderers include DOM stats and images-missing-dims sections when present', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/DOM stats|DOM STATS/.test(output), false);
    assert.equal(/[Mm]issing width\/height|IMAGES MISSING/.test(output), false);
  }
  const withStats = {...base,
    domStats: { total: 2000, maxDepth: 20, deepestElement: '<div#main>', maxChildren: 55, widestElement: '<ul#nav>' },
    imagesMissingDims: [{ src: 'https://site.test/x.jpg', renderedWidth: 400, renderedHeight: 300, hasWidth: false, hasHeight: false }],
  };
  assert.match(toTable(withStats), /DOM STATS/);
  assert.match(toTable(withStats), /IMAGES MISSING/);
  assert.match(toMarkdown(withStats), /DOM stats/);
  assert.match(toMarkdown(withStats), /missing width\/height/);
  assert.match(toHTML(withStats), /DOM stats/);
  assert.match(toHTML(withStats), /missing width\/height/);
});

test('renderers include redirects section only when chain has hops', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/[Rr]edirects/.test(output), false);
  }
  const single = {...base, redirects: { chain: [{ url: 'https://site.test/', status: 200 }], totalMs: 0 }};
  for (const output of [toTable(single), toMarkdown(single), toHTML(single)]) {
    assert.equal(/[Rr]edirects/.test(output), false);
  }
  const withHops = {...base, redirects: { chain: [
    { url: 'https://www.site.test/', status: 301 },
    { url: 'https://site.test/', status: 200 },
  ], totalMs: 250 }};
  assert.match(toTable(withHops), /REDIRECTS/);
  assert.match(toMarkdown(withHops), /Redirects/);
  assert.match(toHTML(withHops), /Redirects/);
});

test('renderers include cache-TTL section only when non-empty', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/[Cc]ache TTL/.test(output), false);
  }
  const withTtl = {...base, cacheTtl: [
    { url: 'https://site.test/a.js', type: 'script', bytes: 20000, duration: 100, cacheControl: 'max-age=3600', maxAge: 3600, reason: 'short' },
    { url: 'https://site.test/b.png', type: 'img', bytes: 50000, duration: 50, cacheControl: null, maxAge: null, reason: 'missing' },
  ]};
  assert.match(toTable(withTtl), /CACHE TTL/);
  assert.match(toMarkdown(withTtl), /Cache TTL/);
  assert.match(toHTML(withTtl), /Cache TTL/);
});

test('renderers include render-blocking section only when non-empty', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/[Rr]ender-blocking/.test(output), false);
  }
  const withBlock = {...base, renderBlocking: {
    css: [{ url: 'https://site.test/a.css', media: 'all', bytes: 20000, duration: 120 }],
    js: [{ url: 'https://site.test/a.js', bytes: 50000, duration: 250 }],
  }};
  assert.match(toTable(withBlock), /RENDER-BLOCKING/);
  assert.match(toMarkdown(withBlock), /Render-blocking/);
  assert.match(toHTML(withBlock), /Render-blocking/);
});

test('renderers include oversized-images section only when non-empty', () => {
  const base = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: 1, fcp: 1, lcp: null, cls: 0}, assetsByType: [], assets: [], thirdParty: [], tech: []};
  for (const output of [toTable(base), toMarkdown(base), toHTML(base)]) {
    assert.equal(/[Oo]versized images/.test(output), false);
  }
  const withImgs = {...base, oversizedImages: [
    {src: 'https://site.test/hero.jpg', naturalWidth: 2000, naturalHeight: 1000, renderedWidth: 400, renderedHeight: 200, dpr: 1, ratio: 5, bytes: 500000, savings: 480000},
  ]};
  assert.match(toTable(withImgs), /OVERSIZED IMAGES/);
  assert.match(toMarkdown(withImgs), /Oversized images/);
  assert.match(toHTML(withImgs), /Oversized images/);
});

test('toHTML renders SVG visualizations when startTime+vitals present, and skips cleanly without them', () => {
  const noStart = {url: 'https://site.test/', timestamp: '2026-01-01T00:00:00.000Z', loadMs: 1, vitals: {ttfb: null, fcp: null, lcp: null, cls: null}, assetsByType: [{type: 'script', count: 1, totalSize: 10, totalDuration: 5, avgDuration: 5}], assets: [{url: 'https://site.test/a.js', duration: 5, size: 10, type: 'script', cors: false}], thirdParty: [], tech: []};
  assert.doesNotThrow(() => toHTML(noStart));
  assert.equal(toHTML(noStart).includes('<svg'), false);

  const withStart = {...noStart, vitals: {...noStart.vitals, lcp: 900, fullyLoaded: 1200, nav: {domContentLoaded: 600, loadEvent: 1000}}, assets: [
    {url: 'https://site.test/a.js', duration: 100, size: 10, type: 'script', cors: false, startTime: 0},
    {url: 'https://site.test/b.css', duration: 50, size: 5, type: 'css', cors: false, startTime: 50},
    {url: 'https://site.test/c.png', duration: 200, size: 500, type: 'img', cors: false, startTime: 100},
  ]};
  const html = toHTML(withStart);
  assert.match(html, /<svg/);
  assert.match(html, /Waterfall/);
  assert.match(html, /Timeline/);
});
