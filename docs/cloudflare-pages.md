# Cloudflare Pages deployment

Production is served at `https://sjtufreshman.pages.dev`. GitHub remains the
source repository; the GitHub Pages entry points redirect visitors to Pages.
This is a Direct Upload project. `.github/workflows/cloudflare-pages.yml` uses
GitHub Actions to publish pushes to `main` to the existing `sjtufreshman` project.
The workflow can also be started manually from the Actions tab on `main`.

## Automatic deployment

Configure these repository settings under **Settings > Secrets and variables > Actions**:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with **Account > Cloudflare Pages > Edit**
  permission restricted to the account that owns `sjtufreshman`.
- Variable `CLOUDFLARE_ACCOUNT_ID`: `747a3c88e73a9d823b0c362f25d9df93`.

Create a dedicated API token at https://dash.cloudflare.com/profile/api-tokens.
Store its value only in the GitHub Actions secret. A local Wrangler OAuth login
does not authenticate GitHub-hosted runners.

The workflow checks credentials, runs the upload-builder tests, prepares only
public website files, validates the prepared Life resources, deploys with
Wrangler 4.149.0, and verifies the live resources against the same checkout.
Production deployments run one at a time. Feature branches do not publish.
The workflow pins checkout 7.0.1, setup-node 7.1.0 and setup-python 7.1.0 to
their release commit hashes and only grants `contents: read` to its GitHub token.
Sparse checkout skips authoring archives, and the builder still enforces the
public-file allowlist and Cloudflare limits.

Commit the recovered October 29 pages and their new assets together with the
workflow before its first run. See `docs/production-snapshot-20261029.md`.
CI publishes the checked-in HTML and assets without running `site_renderer.py`:
the older authoring data would otherwise overwrite the newer published content.
After setup, commit and push website changes to `main`; the Actions run reports
whether the new version passed verification at https://sjtufreshman.pages.dev/.

The Solar System marker opens a blurred full-screen destination choice. The left
half opens `/observatory`, the restored sky viewed from the Solar System; the right
half returns to the homepage. `observatory.html` is generated from `life.html`
by `site_renderer.py` and shares its content, styles and common runtimes, while
loading the two observer modules under `assets/life/observatory/`. The old planetary
interior, planet close-ups, playback runtime, textures and frame atlas are retired. The
public build excludes the entire `assets/celestial/` tree, including any old
files left in a local checkout. Rendering archives are not needed to build.

## Manual fallback

Run from the repository root with Python 3.11+ and Node.js 22+:

```powershell
python scripts/prepare-cloudflare-pages-tests.py
git add -- index.html life.html observatory.html assets documents fonts images
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
node scripts/validate-life-card-updates.cjs https://sjtufreshman.pages.dev/
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
