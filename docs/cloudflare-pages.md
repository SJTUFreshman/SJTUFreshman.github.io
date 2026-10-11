# Cloudflare Pages deployment

The Pages deployment contains the complete public website and the
`20261011-climate-autoplay-v1` celestial atlas: 14,088 WebP files, including
all 180 rotation angles, 2K/4K/8K surface tiers, separate rings, and all eight
Earth/Mars cloud times. Each body uses one fixed elevation (0 degrees, or
30 degrees for Saturn/Uranus). The complete seven-elevation archive stays on
the rendering server. Exporting the fixed view does not re-encode images.
Production frames are served from the same origin as the website; the tracked
manifest uses the production Pages hostname so a fresh local checkout can
also preview the hosted release.

The GitHub repository remains the source repository. Its GitHub Pages entry
points now redirect visitors from `sjtufreshman.github.io` to
`https://sjtufreshman.pages.dev`; the redirect is enabled only on a `*.github.io`
hostname, so the same tracked HTML remains safe to stage for Pages. Cloudflare
Direct Upload is the production publisher; pushing GitHub commits does not by
itself create a new Pages deployment.

## Build the public directory

Run from the repository root with Python 3.11+ and the verified autoplay export
in `.render-work/celestial-autoplay/`:

```powershell
python scripts/prepare-cloudflare-pages-tests.py
python scripts/prepare-cloudflare-pages.py --autoplay-root .render-work/celestial-autoplay --version 20261011-climate-autoplay-v1 --output .render-work/cloudflare-pages/site-20261011-climate-autoplay-v1
```

The preparation script copies tracked website files, checks the manifest and
complete selected frame set against `inventory.json`, and verifies every
copied frame/poster SHA256. It writes the selected output directory and a
separate `<output-name>-report.json` containing
file counts, sizes and hashes. A failed build must not be deployed. Existing
nonempty output directories and existing reports are never overwritten; use
`--output .render-work/cloudflare-pages/site-YYYYMMDD` for the next build.

Only the output manifest is rewritten to
`/assets/celestial/releases/20261011-climate-autoplay-v1/`. The original HTML, JavaScript and
source manifests are unchanged. Versioned frames have immutable cache headers;
the manifest revalidates. A real `404.html` prevents missing assets from falling
back to the home page.

Blender sources, render metadata, source archives, credentials, scripts and
working directories are excluded. Never deploy the repository root or the
whole `.render-work` directory. If a later atlas changes frame bytes, use a new
`--version` rather than reusing an immutable release URL. The default mode
without `--autoplay-root` still accepts the legacy ten-body atlas in
`assets/celestial/baked/`; it is intended for recovery of older releases.

To reproduce the autoplay export, place `export-celestial-autoplay.py` beside
`manage-celestial-release.py` on the rendering server, then run:

```sh
python export-celestial-autoplay.py --input /path/to/verified/assembled --output /path/to/new/autoplay-export --version 20261011-climate-autoplay-v1
```

The exporter verifies selected frames against package records and the full
`SHA256SUMS`, creates ten per-body TARs and an inventory, and preserves the
source manifest bytes. Transfer the inventory, manifest and TARs, verify each
archive SHA256, and extract the expected regular files into the autoplay root.
Keep TARs and inventories outside the public upload directory. The current
server export is `climate-v6-production/autoplay-20261011-r1` under the atlas
workspace; the full production release remains under
`climate-v6-production/releases/20261010-climate-v6-r2`.

The existing `site_renderer.py --check` currently fails because `index.html`
does not contain its expected `HOME_GALLERY` replacement region. This predates
the migration; deployment copies the existing published HTML without regenerating it.

## Authenticate and publish

Use the official Wrangler CLI (Node.js 22+):

```powershell
npx --yes wrangler@4.148.0 login --scopes account:read user:read pages:write
npx --yes wrangler@4.148.0 pages project list
```

Authorize the official Cloudflare application in the browser. Wrangler also
requests background access to refresh its login. Credentials stay outside Git.
For the initial setup, create the Direct Upload project once:

```powershell
npx --yes wrangler@4.148.0 pages project create sjtufreshman --production-branch main --force
```

Wrangler 4.148.0 otherwise delegates new project creation to Workers. The
creation-only `--force` option selects Pages directly. Once this Pages project
exists, regular `pages deploy` commands use it without that option.

Publish the successfully prepared directory:

```powershell
npx --yes wrangler@4.148.0 pages deploy .render-work/cloudflare-pages/site-20261011-climate-autoplay-v1 --project-name sjtufreshman --branch main
```

For subsequent builds, pass the exact new output directory to `pages deploy`.
This workflow uploads local verified artifacts; a Git push alone does not
deploy. A fresh clone must first restore the ignored autoplay export before
building a complete deployment. A website-only update can use `--external-atlas`
when the tracked manifest points at a separately retained asset deployment;
do not remove same-origin release files while still referencing them.
Direct Upload projects cannot be converted to Cloudflare's Git integration.

## Verify and recover

Check the URL returned by Wrangler: `/`, `/life`, the root service worker,
Chinese-named images/documents, and
`/assets/celestial/hosted/manifest.json`. The manifest's frames and posters must
resolve on that same Pages hostname. Verify a representative frame from each
body and a nonexistent path returning HTTP 404. The existing runtime HTTP
check also works against the new site's `/life` URL:

```powershell
node scripts/validate-life-http.cjs https://YOUR-PROJECT.pages.dev/life
```

Cloudflare retains prior deployments for rollback. Verify desktop and mobile
autoplay, pause/resume, all three speeds, stable initial angles, and independent
Earth/Mars climate frames before publishing. The focused real-resource check is:

```powershell
node scripts/validate-celestial-autoplay-browser.cjs https://sjtufreshman.pages.dev/life
```

## Capacity and source control

The autoplay atlas contains 14,088 files totaling about 15.85 GiB; its largest
file is about 15.02 MiB. Together with the current website, this stays below
the free Pages limit of 20,000 files and the 25 MiB per-file limit. The build
report records exact totals and both limits are enforced before copying.
Wrangler is required because browser drag-and-drop is limited to 1,000 files.

Pages capacity is separate from GitHub repository storage. Hosting the complete
public website on Pages does not put the ignored frame files or Blender
engineering archives into Git, and it does not merge or remove the existing
asset repositories. Engineering archives are not website assets.

Official references:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
