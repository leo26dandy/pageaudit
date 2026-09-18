# pageaudit

Local one-shot page audit CLI. See what's slow, who's tracking, what's under the hood - without waiting on PageSpeed Insights.

## What it shows

- **By type summary** - all assets grouped by kind (img, script, font, css, video, ...) with count, total size, average + total duration.
- **Heavy assets** - top N by real load duration (default 15, override with `--top`). Filter to one class with `--filter`. Table includes HTTP protocol (`h2`, `h3`, ...) and content-encoding (`gz`, `br`, ...) per asset.
- **Third-party services** - grouped by host, labeled by entity + category (analytics / ads / cdn / tag-manager / social / ...), sorted by total duration.
- **Tech stack** - WordPress, Elementor, WooCommerce, Next.js, Nuxt, React, Vue, Shopify, Cloudflare, etc.
- **Core Web Vitals** - TTFB, FCP, LCP, CLS, TBT (Total Blocking Time). (INP omitted - requires user interaction.)
- **LCP element identity** - tag, id, class, and (for images) src of the element that painted the LCP.
- **CLS shift sources** - top 5 largest layout shifts with the elements that moved.
- **Timing breakdown** - navigation timing split into redirect, DNS, connect, TLS, request, response, DOM interactive, DOM content loaded, load event, and fully-loaded (network-idle) time.
- **Long tasks** - top 5 main-thread tasks over 50ms, with start time and duration.
- **Fully loaded time** - approximated via network idle after the load event, closer to GTmetrix's "Fully Loaded Time" than the raw `load` event.
- **Diff vs previous run** - instant regression check for the same URL.
- **Human-readable timestamp** in your local timezone; ISO kept in JSON for machine parsing.

Powered by real Chromium (Playwright), reading directly from the browser's `PerformanceResourceTiming` and `PerformanceObserver` APIs - the same source Chrome DevTools uses.

## Requirements

- Node.js 20+
- Chromium browser fetched separately via `npx playwright install chromium` (Playwright no longer downloads browsers automatically on `npm install`).

## Install

Clone + install:
```bash
git clone https://github.com/leo26dandy/pageaudit.git
cd pageaudit
npm install
npx playwright install chromium
```

Or install system Chromium deps (Linux only):
```bash
sudo npx playwright install-deps chromium
```

Global link (`pageaudit <url>` from anywhere):
```bash
npm link
```

## Usage

```bash
node pageaudit.js https://example.com
```

With flags:

```bash
node pageaudit.js https://example.com --diff
node pageaudit.js https://example.com --fail
node pageaudit.js https://example.com --top 30
node pageaudit.js https://example.com --filter font
node pageaudit.js https://example.com --filter img,font,script
node pageaudit.js https://example.com --html report.html --md report.md
node pageaudit.js https://example.com --json | jq '.thirdParty[0:5]'
node pageaudit.js https://example.com --share            # requires `gh` CLI
node pageaudit.js https://example.com --timeout 60000
```

## Options

| Flag | Purpose |
|---|---|
| `--json` | Emit raw JSON to stdout |
| `--html <file>` | Write HTML report |
| `--md <file>` | Write Markdown report |
| `--share` | Upload HTML as GitHub Gist (needs `gh auth login`) |
| `--diff` | Show diff vs previous run for this URL |
| `--fail` | Exit 1 if LCP or total asset duration regressed more than 10% vs previous run (strict `>`, CI-friendly) |
| `--top <n>` | Show top N heavy assets and 3rd parties (default `15`) |
| `--filter <types>` | Only show assets of given types (comma-separated): `img,font,script,css,video,audio,data,doc` |
| `--timeout <ms>` | Page load timeout (default `30000`) |
| `-h`, `--help` | Show help |

Snapshots stored at `~/.pageaudit/snapshots.json` for `--diff` / `--fail`.

## Tests

```bash
npm test
```

Runs `node --test` against `helpers.test.js` covering:

- `inferType` extension coverage and malformed URL fallback
- `isSizeUnavailable` origin + TAO matrix (same-origin, wildcard, matching origin, mismatched TAO, cross-origin no TAO, known sizes)
- `resourceSize` empty-body vs. cross-origin-no-TAO paths
- `hasRegression` strict `>10%` gate, null LCP, zero baseline, no baseline
- All three renderers (`toTable`, `toMarkdown`, `toHTML`) emit the missing-size marker
- All three renderers stay backward compatible when v0.5 vitals fields (`nav`, `tbt`, `lcpElement`, `clsShifts`, `longTasks`) are absent, and render the timing-breakdown heading when present

## Known limitations

- **Cross-origin size unknown.** When a resource is fetched from a different origin and its response does not carry a `Timing-Allow-Origin` header that matches the page origin (either `*` or the exact origin), the browser hides `transferSize` and `encodedBodySize` from `PerformanceResourceTiming`. Those rows are flagged `[size unavailable: no matching TAO]`. Note this marker only means byte accounting is hidden by the browser; the request itself may have loaded normally (the absence of TAO does not by itself indicate a CORS-blocked response).
- **No INP.** INP requires real user interaction; synthetic audits can't measure it.
- **Tech detection dataset is a snapshot.** `wappalyzer-core` reads the `technologies.json` bundled with `simple-wappalyzer` at install time. That dataset is not guaranteed to track the latest upstream Wappalyzer definitions - update `simple-wappalyzer` when detection accuracy drifts.
- **Single URL per run.** No crawl / multi-page mode yet.

## Architecture

- `pageaudit.js` - CLI entry: argument parsing, Playwright orchestration, snapshot management.
- `helpers.js` - pure logic: `inferType`, `isSizeUnavailable`, `resourceSize`, `hasRegression`, `NO_TAO` constant.
- `format.js` - pure renderers: `toTable`, `toMarkdown`, `toHTML`, plus small formatters (`fmtMs`, `fmtBytes`, `fmtCls`, `fmtTime`, `shortType`).
- `helpers.test.js` - `node --test` suite; no test framework dependency.

Snapshots: `~/.pageaudit/snapshots.json` for `--diff` / `--fail`.

## License

[MIT](LICENSE) © Leo Dandy
