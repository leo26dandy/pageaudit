export const NO_TAO = '[size unavailable: no matching TAO]';

export function inferType(url, initiatorType) {
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

export function resourceSize(resource, headers, pageUrl) {
  const measured = resource.transferSize > 0 ? resource.transferSize : resource.encodedBodySize > 0 ? resource.encodedBodySize : null;
  const cors = isSizeUnavailable(measured, headers, resource.url, pageUrl);
  let knownOrigin = false;
  try { knownOrigin = new URL(resource.url).origin !== 'null' && new URL(pageUrl).origin !== 'null'; } catch {}
  return { size: measured ?? (!cors && knownOrigin && resource.encodedBodySize === 0 ? 0 : null), cors };
}

export function isSizeUnavailable(size, headers, resourceUrl, pageUrl) {
  if (size !== null) return false;
  let rOrigin, pOrigin;
  try { rOrigin = new URL(resourceUrl).origin; } catch { return false; }
  try { pOrigin = new URL(pageUrl).origin; } catch { return false; }
  if (rOrigin === pOrigin) return false;
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = v;
  const tao = h['timing-allow-origin'];
  if (!tao) return true;
  const allowed = String(tao).split(',').map(s => s.trim());
  return !(allowed.includes('*') || allowed.includes(pOrigin));
}

const CWV = { LCP: [2500, 4000], CLS: [0.1, 0.25], TBT: [200, 600], TTFB: [800, 1800], FCP: [1800, 3000] };
const SEV_RANK = { high: 3, med: 2, low: 1 };

export function buildFindings(r) {
  const v = r.vitals || {};
  const out = [];
  const push = (id, title, severity, metrics, savings, detail) => out.push({ id, title, severity, metrics, savings, detail });

  const tier = (label, val) => {
    const t = CWV[label];
    if (!t || val == null) return null;
    return val > t[1] ? 'high' : val > t[0] ? 'med' : null;
  };

  const lcpT = tier('LCP', v.lcp);
  if (lcpT) push('lcp', `LCP is ${Math.round(v.lcp)}ms`, lcpT, ['LCP'], { ms: v.lcp }, lcpT === 'high' ? 'above 4000ms (poor)' : 'above 2500ms (needs improvement)');
  const clsT = tier('CLS', v.cls);
  if (clsT) {
    const top = v.clsShifts?.[0];
    push('cls', `CLS is ${v.cls?.toFixed(3)}`, clsT, ['CLS'], {}, top ? `top shift ${top.value.toFixed(3)}, ${top.sources?.length || 0} source(s)` : (clsT === 'high' ? 'above 0.25 (poor)' : 'above 0.1'));
  }
  const tbtT = tier('TBT', v.tbt);
  if (tbtT) push('tbt', `TBT is ${Math.round(v.tbt)}ms`, tbtT, ['TBT'], { ms: v.tbt }, tbtT === 'high' ? 'above 600ms (poor)' : 'above 200ms (needs improvement)');
  const ttfbT = tier('TTFB', v.ttfb);
  if (ttfbT) push('ttfb', `TTFB is ${Math.round(v.ttfb)}ms`, ttfbT, ['LCP'], { ms: v.ttfb }, ttfbT === 'high' ? 'above 1800ms (poor)' : 'above 800ms (needs improvement)');

  const oi = r.oversizedImages || [];
  if (oi.length) {
    const totalSave = oi.reduce((s, i) => s + (i.savings || 0), 0);
    const sev = totalSave > 500 * 1024 ? 'high' : totalSave > 100 * 1024 ? 'med' : 'low';
    push('oversized-images', `${oi.length} oversized image${oi.length > 1 ? 's' : ''}`, sev, ['LCP'], { bytes: totalSave || null }, totalSave ? `~${fmtB(totalSave)} potential savings` : 'natural size exceeds rendered × DPR by 2× or more');
  }

  const rb = r.renderBlocking;
  const rbCount = (rb?.css?.length || 0) + (rb?.js?.length || 0);
  if (rbCount) {
    const rbMs = [...(rb.css || []), ...(rb.js || [])].reduce((s, x) => s + (x.duration || 0), 0);
    const sev = rbMs > 500 || rbCount >= 3 ? 'high' : rbMs > 200 ? 'med' : 'low';
    push('render-blocking', `${rbCount} render-blocking resource${rbCount > 1 ? 's' : ''}`, sev, ['FCP', 'LCP'], { ms: rbMs || null }, `${rb.css?.length || 0} CSS, ${rb.js?.length || 0} JS in <head> without async/defer/module`);
  }

  if (r.redirects?.chain?.length > 1) {
    const hops = r.redirects.chain.length - 1;
    const ms = r.redirects.totalMs || 0;
    const sev = ms > 1000 || hops >= 3 ? 'high' : ms > 500 || hops >= 2 ? 'med' : 'low';
    push('redirects', `${hops} redirect hop${hops > 1 ? 's' : ''}`, sev, ['LCP'], { ms }, ms ? `costs ${Math.round(ms)}ms` : 'main document redirected');
  }

  const ct = r.cacheTtl || [];
  if (ct.length) {
    const totalB = ct.reduce((s, x) => s + (x.bytes || 0), 0);
    const sev = ct.length >= 10 || totalB > 500 * 1024 ? 'med' : 'low';
    push('cache-ttl', `${ct.length} asset${ct.length > 1 ? 's' : ''} with short or missing Cache-Control`, sev, [], { bytes: totalB || null }, 'repeat visitors pay full download again');
  }

  const md = r.imagesMissingDims || [];
  if (md.length) {
    const sev = md.length >= 5 ? 'med' : 'low';
    push('missing-dims', `${md.length} image${md.length > 1 ? 's' : ''} missing width/height`, sev, ['CLS'], {}, 'browser cannot reserve space before load');
  }

  const ds = r.domStats;
  if (ds) {
    if (ds.total > 3000) push('dom-total', `DOM has ${ds.total} elements`, 'med', ['TBT'], {}, 'style, layout, and JS traversal all scale with element count');
    if (ds.maxDepth > 32) push('dom-depth', `DOM depth is ${ds.maxDepth}`, 'low', ['TBT'], {}, `deepest: ${ds.deepestElement || '?'}`);
  }

  return out
    .sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || ((b.savings?.bytes || 0) - (a.savings?.bytes || 0)) || ((b.savings?.ms || 0) - (a.savings?.ms || 0)))
    .slice(0, 5);
}

function fmtB(n) {
  return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
}

export function hasRegression(prev, current) {
  if (!prev) return false;
  const prevTotal = (prev.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
  const nowTotal = (current.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
  const lcpRegressed = current.vitals?.lcp != null && prev.vitals?.lcp != null && current.vitals.lcp > prev.vitals.lcp * 1.1;
  const totalRegressed = prevTotal > 0 && nowTotal > prevTotal * 1.1;
  return lcpRegressed || totalRegressed;
}
