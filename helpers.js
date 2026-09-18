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

export function hasRegression(prev, current) {
  if (!prev) return false;
  const prevTotal = (prev.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
  const nowTotal = (current.assetsByType || []).reduce((s, t) => s + (t.totalDuration || 0), 0);
  const lcpRegressed = current.vitals?.lcp != null && prev.vitals?.lcp != null && current.vitals.lcp > prev.vitals.lcp * 1.1;
  const totalRegressed = prevTotal > 0 && nowTotal > prevTotal * 1.1;
  return lcpRegressed || totalRegressed;
}
