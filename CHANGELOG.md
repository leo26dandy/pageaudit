# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- HTML report: vitals cards color-coded green/amber/red against Core Web Vitals thresholds (FCP, LCP, CLS, TBT, TTFB).
- HTML report: timeline marker bar (inline SVG) showing FCP, LCP, DOM content loaded, onload, and fully-loaded.
- HTML report: waterfall chart (inline SVG) of up to 30 requests by start time, colored by asset type, with lifecycle markers overlaid.
- HTML report: assets-by-type segmented bar (requests + duration) with color-key legend.
- Per-asset `startTime` (ms since navigation start) — powers the waterfall chart; terminal/Markdown output unchanged.

## [0.5.0] — 2026-09-18

### Added
- `vitals.lcpElement` — tag, id, class, src, and truncated HTML snippet of the LCP element.
- `vitals.clsShifts` — top 5 layout shifts, each with score and source element markup.
- `vitals.nav` — navigation timing split (redirect, DNS, connect, TLS, request, response, `domInteractive`, `domContentLoadedEventEnd`, `loadEventEnd`).
- `vitals.tbt` — Total Blocking Time (sum of `long-task` blocking portions between FCP and load).
- `vitals.longTasks` — top 5 longest main-thread tasks (start time, duration, attribution).
- `vitals.fullyLoaded` — wall-clock ms until network idle (after `load`).
- `vitals.onload` — alias of `loadEvent` for clarity in the report.
- Per-asset `protocol` column (`h2` / `h3` / `http/1.1`) from `PerformanceResourceTiming.nextHopProtocol`.
- Per-asset `encoding` column (`gz` / `br` / raw value) from response `content-encoding`.
- Renderers: TIMING BREAKDOWN section, LCP element line, CLS shifts card, long tasks card in terminal, Markdown, and HTML outputs.

### Changed
- HTML report gains new sections without altering the existing brand system.
- Markdown and terminal outputs extended with the same new sections.

### Notes
- Backward compatible: only new keys added to the JSON report; `--diff` snapshots from 0.4.x still parse.

## [0.4.0] — 2026-08-03

### Added
- `--fail` flag: exit code 1 when LCP or total asset duration regresses more than 10% vs the previous snapshot.
- `tldts` for eTLD+1-aware third-party grouping (real handling of `.co.uk`, `.com.au`, `.github.io`, etc.).
- `wappalyzer-core` + `simple-wappalyzer` for Apache-2.0-licensed tech-stack detection.
- Cookie extraction from `set-cookie` response headers, fed to the detector.
- DOM script and meta collection (`page.evaluate`) so the detector sees the same evidence the browser does.
- `helpers.js` (pure logic: `inferType`, `resourceSize`, `isSizeUnavailable`, `hasRegression`, `NO_TAO`).
- `format.js` (pure renderers: `toTable`, `toMarkdown`, `toHTML`, formatters).
- `helpers.test.js` — `node --test` suite covering type inference, TAO origin matrix, regression checks, and renderer marker injection. No test framework dependency.

### Changed
- Size / CORS classification rewritten: same-origin and matching-TAO cross-origin empty bodies keep `size = 0`; only genuinely cross-origin responses with no matching `Timing-Allow-Origin` get flagged unavailable. Uses `mainResponse.url()` as the origin so post-redirect origins are compared correctly.
- Unified marker `[size unavailable: no matching TAO]` across terminal, Markdown, and HTML outputs. Wording no longer implies TAO absence proves a CORS block — only that byte accounting is hidden by the browser.
- README updated: dropped stale "~30 hand-picked patterns" line (detection now uses the bundled `technologies.json` dataset), corrected `--fail` threshold to strict `>10%`, made `npx playwright install chromium` an explicit required install step.

### Removed
- Deprecated, unused `wappalyzer` package. Registry metadata carried no license field and the package was superseded upstream; replaced end-to-end by `wappalyzer-core` + `simple-wappalyzer` (both Apache-2.0).

### Fixed
- Duplicate `import Wappalyzer` in `pageaudit.js` that caused `SyntaxError: Identifier 'Wappalyzer' has already been declared`.
- `hasRegression` gate is now strict `>10%` (a run exactly on the 10% boundary no longer trips `--fail`).

## [0.3.0] — 2026-07-31

### Added
- Brand-guided HTML report: aubergine hero and footer bands, cream vitals band, Inter font (Google Fonts CDN), pill-style tech badges, plain human copy ("Assets by type", "Slowest N assets", "Third parties", "Tech stack").

## [0.2.0] — 2026-07-31

### Added
- `--top <n>` to control the size of the heavy-assets and third-party sections.
- `--filter <types>` (comma-separated) to narrow output to `img`, `font`, `script`, `css`, `video`, `audio`, `data`, or `doc`.
- BY TYPE summary section: counts, total size, and average / total duration per asset class.
- Human-readable local timestamps in output (ISO kept in JSON for machine parsing).
- Full URLs shown in the assets table (no truncation).
- Type column derived from the URL extension (what the asset is) rather than from `initiatorType` (who fetched it).

### Changed
- Tighter tech-stack regex before the switch to `wappalyzer-core` in 0.4.0.

## [0.1.0] — 2026-07-31

### Added
- Initial local one-shot page audit CLI.
- Heavy assets, third-party grouping (per host + entity via `third-party-web`), and tech-stack detection.
- Core Web Vitals via `PerformanceObserver`: TTFB, FCP, LCP, CLS.
- `--diff` mode against a snapshot at `~/.pageaudit/snapshots.json`.
- Output formats: terminal table (default), `--json`, `--html`, `--md`, `--share` (uploads HTML as a GitHub Gist via the `gh` CLI).
- `--timeout <ms>` for slow origins.

[0.5.0]: https://github.com/leo26dandy/pageaudit/compare/4cd1ef0...v0.5.0
[0.4.0]: https://github.com/leo26dandy/pageaudit/compare/3632fb8...4cd1ef0
[0.3.0]: https://github.com/leo26dandy/pageaudit/compare/402f769...3632fb8
[0.2.0]: https://github.com/leo26dandy/pageaudit/compare/f392fe8...402f769
[0.1.0]: https://github.com/leo26dandy/pageaudit/commit/f392fe8
