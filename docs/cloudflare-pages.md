# Cloudflare Pages deployment

Production is served at `https://sjtufreshman.pages.dev`. GitHub remains the
source repository; the GitHub Pages entry points redirect visitors to Pages.
This is a Direct Upload project, so pushing commits does not deploy the site.

The Solar System marker opens a blurred full-screen destination choice. The left
half opens `/observatory`, the restored sky viewed from the Solar System; the right
half returns to the homepage. `observatory.html` is generated from `life.html`
by `site_renderer.py` and shares its content, styles and common runtimes, while
loading the two observer modules under `assets/life/observatory/`. The old planetary
interior, planet close-ups, playback runtime, textures and frame atlas are retired. The
public build excludes the entire `assets/celestial/` tree, including any old
files left in a local checkout. Rendering archives are not needed to build.

## Build and publish

Run from the repository root with Python 3.11+ and Node.js 22+:

```powershell
python scripts/prepare-cloudflare-pages-tests.py
node scripts/validate-star-map.cjs --serve
python site_renderer.py --check --life-only
git add -A -- life.html observatory.html site_renderer.py assets scripts docs
python scripts/prepare-cloudflare-pages.py --output .render-work/cloudflare-pages/site-YYYYMMDD
npx --yes wrangler@4.149.0 pages deploy .render-work/cloudflare-pages/site-YYYYMMDD --project-name sjtufreshman --branch main
```

Stage intended new files and deletions before building because the builder uses
`git ls-files`. Commit and push the reviewed changes before deploying. Set
`PLAYWRIGHT_MODULE_PATH` to an existing Playwright installation if needed for
the browser check; Chrome must be installed.

The builder copies only tracked public website files, enforces the 20,000-file
and 25 MiB per-file limits, and records sizes and SHA256 hashes in the adjacent
`<output-name>-report.json`. Scripts, source archives, private metadata,
credentials and working directories are excluded. A real `404.html` prevents
missing assets from falling back to the homepage. The pet service worker uses
`Cache-Control: no-cache`.

Always use a new output directory. Existing nonempty directories and reports
are never overwritten. Do not deploy after a failed build, the repository root,
an old atlas deployment, or the whole `.render-work` directory.

If authentication has expired, run:

```powershell
npx --yes wrangler@4.149.0 login --scopes account:read user:read pages:write
```

## Verify

```powershell
node scripts/validate-life-http.cjs https://sjtufreshman.pages.dev/life
node scripts/validate-star-map.cjs https://sjtufreshman.pages.dev/
```

Check `/`, `/life`, `/observatory`, the pet service worker, and Chinese-named public assets.
The old `/assets/celestial/hosted/manifest.json` and frame URLs must return
HTTP 404 on the new production deployment. The browser suite checks that mouse,
touch, Enter and Space activation opens the solar destination choice, and the
right-hand option returns home without retired solar resource requests.
`validate-solar-destination.cjs <base-url>` checks both routes, cancellation,
focus, history, languages and mobile layout. `validate-observed-sky.cjs <base-url>`
checks restored photographic sky rendering, angular geometry, content targets,
texture failures and WebGL/Canvas recovery. The main star-map suite also checks
constellation content, gallery, index, deep-sky views, map gestures, mobile,
WebGL fallback and reduced motion. The footprints group checks the native white
material maps, shared blue-grey ocean, and hard zoom caps (China 300%; East Asia and
Europe/USA 200%) through inline and modal controls on desktop and mobile.

Cloudflare retains previous deployments for rollback; their archived contents
are separate from the current production website.

References:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
