# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-09-22

### Added

- **Findings panel.** Top 5 issues, ranked high / med / low, tagged with the Core Web Vital they hurt (LCP, FCP, CLS, TBT), with byte or ms savings and a one-line detail. Pure synthesis over the audits below, no new browser probing.
- **Oversized images.** Walks `<img>`, flags any where `naturalWidth / (renderedWidth * devicePixelRatio) > 2`. When bytes are known from Resource Timing, estimates saving as `bytes * (1 - 1 / ratio²)`. Top 10 by savings, then ratio.
- **Render-blocking resources.** Probes `link[rel~="stylesheet"]` (skipping `media="print"`) and `document.head script[src]` (skipping `async`, `defer`, `type="module"`). Duration and bytes come from Resource Timing.
- **Cache TTL.** Reads `Cache-Control` on static assets (script, css, img, font) and flags `missing`, `no-store`, `no-cache`, or `short` (`max-age` under 7 days). Top 15 by bytes.
- **Redirect chain.** Walks `mainResponse.request().redirectedFrom()` backwards and lists each hop with its status. Silent when the page landed on the first hit.
- **DOM stats.** Total elements, max depth (with the deepest element), and max children on a single parent (with the widest element).
- **Images missing `width` / `height`.** Flags visible `<img>` tags without both attributes. Missing dimensions are the usual CLS root cause.
- **HTML report redesign.** MI red (`#c02026`) on white replaces the aubergine and cream from the Slack-inspired v0.6 layout. System font stack drops the Google Fonts dependency. Data-dense tables replace boxed stat cards and pill badges. The report now brands itself, not MI.

Every section here gates on its own emptiness, so a healthy page produces a short report. All output paths (terminal, Markdown, HTML) render the new sections.

### Changed

- HTML footer trimmed to `MIT · <repo link>`.

### Removed

- Unused CSS custom properties and inline what-comments from the previous design pass.

## [0.6.0] — 2026-09-18

### Added

- HTML report: vitals cards colored green / amber / red against Core Web Vitals thresholds (FCP, LCP, CLS, TBT, TTFB).
- HTML report: timeline marker bar (inline SVG) with FCP, LCP, DOM content loaded, onload, and fully-loaded.
- HTML report: waterfall chart (inline SVG) of up to 30 requests by start time, colored by asset type, with lifecycle markers overlaid.
- HTML report: assets-by-type segmented bar (requests and duration) with a color-key legend.
- Per-asset `startTime` (ms since navigation start) drives the waterfall. Terminal and Markdown output unchanged.

## [0.5.0] — 2026-09-18

### Added

- `vitals.lcpElement`: tag, id, class, src, and a truncated HTML snippet of the LCP element.
- `vitals.clsShifts`: top 5 layout shifts, each with score and source-element markup.
- `vitals.nav`: navigation timing split (redirect, DNS, connect, TLS, request, response, `domInteractive`, `domContentLoadedEventEnd`, `loadEventEnd`).
- `vitals.tbt`: Total Blocking Time, summed from long-task blocking portions between FCP and load.
- `vitals.longTasks`: top 5 longest main-thread tasks (start, duration, attribution).
- `vitals.fullyLoaded`: wall-clock ms until network idle after `load`.
- `vitals.onload`: alias of `loadEvent`.
- Per-asset `protocol` column (`h2`, `h3`, `http/1.1`) from `PerformanceResourceTiming.nextHopProtocol`.
- Per-asset `encoding` column (`gz`, `br`, raw value) from `content-encoding`.
- Timing breakdown block, LCP element line, CLS shifts card, and long tasks card in terminal, Markdown, and HTML.

### Notes

- Backward compatible. Only new keys land in the JSON report; `--diff` snapshots from 0.4.x still parse.

## [0.4.0] — 2026-08-03

### Added

- `--fail`: exit 1 when LCP or total asset duration regresses by more than 10% against the previous snapshot.
- `tldts` for eTLD+1-aware third-party grouping. Real handling of `.co.uk`, `.com.au`, `.github.io`, and friends.
- `wappalyzer-core` and `simple-wappalyzer` for Apache-2.0 tech-stack detection.
- Cookie extraction from `set-cookie` response headers, fed to the detector.
- DOM script and meta collection via `page.evaluate`, so the detector sees the same evidence the browser does.
- `helpers.js`: `inferType`, `resourceSize`, `isSizeUnavailable`, `hasRegression`, `NO_TAO`.
- `format.js`: `toTable`, `toMarkdown`, `toHTML`, formatters.
- `helpers.test.js`: `node --test` suite covering type inference, TAO origin matrix, regression checks, and renderer marker injection. No test framework dependency.

### Changed

- Size and CORS classification rewritten. Same-origin and matching-TAO cross-origin empty bodies keep `size = 0`. Only genuinely cross-origin responses without a matching `Timing-Allow-Origin` get flagged unavailable. Uses `mainResponse.url()` as the origin, so post-redirect origins compare correctly.
- Marker unified to `[size unavailable: no matching TAO]` across terminal, Markdown, and HTML. The wording no longer suggests the request was CORS-blocked. It only says the browser hid byte accounting.
- README: dropped the stale "~30 hand-picked patterns" line. Detection uses the bundled `technologies.json` dataset. Corrected `--fail` threshold to strict `>10%`. Made `npx playwright install chromium` an explicit required install step.

### Removed

- `wappalyzer` package. Its registry metadata carried no license field, the package was deprecated upstream, and `wappalyzer-core` plus `simple-wappalyzer` (both Apache-2.0) cover the same ground.

### Fixed

- Duplicate `import Wappalyzer` in `pageaudit.js` that caused `SyntaxError: Identifier 'Wappalyzer' has already been declared`.
- `hasRegression` is strict `>10%`. A run exactly on the boundary no longer trips `--fail`.

## [0.3.0] — 2026-07-31

### Added

- HTML report with the earlier brand system: aubergine hero and footer, cream vitals band, Inter via Google Fonts, pill-style tech badges, plain-English section labels ("Assets by type", "Slowest N assets", "Third parties", "Tech stack").

## [0.2.0] — 2026-07-31

### Added

- `--top <n>` to size the heavy-assets and third-party sections.
- `--filter <types>` (comma-separated) to narrow output to `img`, `font`, `script`, `css`, `video`, `audio`, `data`, or `doc`.
- BY TYPE section: counts, total size, average and total duration per asset class.
- Local human-readable timestamps in output. ISO kept in JSON for machine parsing.
- Full URLs in the assets table, no truncation.
- Type column derived from the URL extension (what the asset is), not `initiatorType` (who fetched it).

### Changed

- Tighter tech-stack regex, before the switch to `wappalyzer-core` in 0.4.0.

## [0.1.0] — 2026-07-31

### Added

- Initial local one-shot page audit CLI.
- Heavy assets, third-party grouping (per host and entity via `third-party-web`), and tech-stack detection.
- Core Web Vitals via `PerformanceObserver`: TTFB, FCP, LCP, CLS.
- `--diff` against a snapshot at `~/.pageaudit/snapshots.json`.
- Output formats: terminal table (default), `--json`, `--html`, `--md`, `--share` (uploads HTML as a GitHub Gist via `gh`).
- `--timeout <ms>` for slow origins.

[0.7.0]: https://github.com/leo26dandy/pageaudit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/leo26dandy/pageaudit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/leo26dandy/pageaudit/compare/4cd1ef0...v0.5.0
[0.4.0]: https://github.com/leo26dandy/pageaudit/compare/3632fb8...4cd1ef0
[0.3.0]: https://github.com/leo26dandy/pageaudit/compare/402f769...3632fb8
[0.2.0]: https://github.com/leo26dandy/pageaudit/compare/f392fe8...402f769
[0.1.0]: https://github.com/leo26dandy/pageaudit/commit/f392fe8
