import test from 'node:test';
import assert from 'node:assert/strict';
import { inferType, resourceSize, isSizeUnavailable, hasRegression, NO_TAO } from './helpers.js';
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
