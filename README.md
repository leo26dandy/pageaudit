# pageaudit

Local one-shot page audit CLI. See what's slow, who's tracking, what's under the hood - without waiting on PageSpeed Insights.

## What it shows

- **Heavy assets** - top 15 by real load duration (with byte size where available).
- **Third-party services** - grouped by host, labeled by category (analytics / ads / cdn / tag-manager / social / …), sorted by total duration.
- **Tech stack** - WordPress, Elementor, WooCommerce, Next.js, Nuxt, React, Vue, Shopify, Cloudflare, etc.
- **Core Web Vitals** - TTFB, FCP, LCP, CLS. (INP omitted - requires user interaction.)
- **Diff vs previous run** - instant regression check for the same URL.

Powered by real Chromium (Playwright), reading directly from the browser's `PerformanceResourceTiming` and `PerformanceObserver` APIs - the same source Chrome DevTools uses.

## Requirements

- Node.js 20+
- Playwright Chromium (auto-installs on `npm install`)

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
| `--timeout <ms>` | Page load timeout (default `30000`) |
| `-h`, `--help` | Show help |

Snapshots stored at `~/.pageaudit/snapshots.json` for `--diff`.

## Known limitations

- **Cross-origin size = `-`.** Resources without `Timing-Allow-Origin: *` report `transferSize = 0` - browser-level CORS restriction, not fixable client-side.
- **No INP.** INP requires real user interaction; synthetic audits can't measure it.
- **Tech detection ≈ 30 patterns.** Hand-picked to cover most WP/Woo/modern stacks. Narrower than Wappalyzer's 2000+ set; swap to `wappalyzer-core` if false-negatives sting.
- **Naive eTLD+1 grouping.** Third-party grouping uses `hostname.split('.').slice(-2)` - misgroups `.co.uk`, `.com.au`, etc. Swap to `tldts` if false positives hurt.
- **Single URL per run.** No crawl / multi-page mode yet.

## License

[MIT](LICENSE) © Leo Dandy
