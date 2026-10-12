# Cloudflare Pages deployment

Production is served at `https://sjtufreshman.pages.dev`. GitHub remains the
source repository; the GitHub Pages entry points redirect visitors to Pages.
This is a Direct Upload project, so pushing commits does not deploy the site.

The Solar System is a noninteractive marker on the Life star map. Its interior,
planet close-ups, playback runtime, textures and frame atlas are retired. The
public build excludes the entire `assets/celestial/` tree, including any old
files left in a local checkout. Rendering archives are not needed to build.

## Build and publish

Run from the repository root with Python 3.11+ and Node.js 22+:

```powershell
python scripts/prepare-cloudflare-pages-tests.py
node scripts/validate-star-map.cjs --serve
git add -A -- life.html assets scripts docs
python scripts/prepare-cloudflare-pages.py --output .render-work/cloudflare-pages/site-YYYYMMDD
npx --yes wrangler@4.148.0 pages deploy .render-work/cloudflare-pages/site-YYYYMMDD --project-name sjtufreshman --branch main
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
npx --yes wrangler@4.148.0 login --scopes account:read user:read pages:write
```

## Verify

```powershell
node scripts/validate-life-http.cjs https://sjtufreshman.pages.dev/life
node scripts/validate-star-map.cjs https://sjtufreshman.pages.dev/
```

Check `/`, `/life`, the pet service worker, and Chinese-named public assets.
The old `/assets/celestial/hosted/manifest.json` and frame URLs must return
HTTP 404 on the new production deployment. The browser suite checks that mouse,
touch, Enter and Space activation of the Solar System marker leaves the camera
and page unchanged and makes no solar resource requests. It also checks
constellation content, gallery, index, deep-sky views, map gestures, mobile,
WebGL fallback and reduced motion.

Cloudflare retains previous deployments for rollback; their archived contents
are separate from the current production website.

References:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
