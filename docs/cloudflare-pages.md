# Cloudflare Pages deployment

The Pages deployment contains the complete public website and the existing
`20261002-4k-v1` celestial atlas: 12,600 frames and 10 posters. The atlas is served
from the same origin as the website. Tencent's existing asset service remains
available, and the tracked hosted manifest still supports the GitHub Pages site.

The GitHub repository remains the source repository. Its GitHub Pages entry
points now redirect visitors from `sjtufreshman.github.io` to
`https://sjtufreshman.pages.dev`; the redirect is enabled only on a `*.github.io`
hostname, so the same tracked HTML remains safe to stage for Pages. Cloudflare
Direct Upload is the production publisher; pushing GitHub commits does not by
itself create a new Pages deployment.

## Build the public directory

Run from the repository root with Python 3.10+ and the complete local atlas in
`assets/celestial/baked/`:

```powershell
python scripts/prepare-cloudflare-pages-tests.py
python scripts/prepare-cloudflare-pages.py
```

The preparation script copies tracked website files and verifies every atlas
frame/poster against its package SHA256. It writes
`.render-work/cloudflare-pages/site` and a separate `site-report.json` containing
file counts, sizes and hashes. A failed build must not be deployed. Existing
nonempty output directories and existing reports are never overwritten; use
`--output .render-work/cloudflare-pages/site-YYYYMMDD` for the next build.

Only the output manifest is rewritten to
`/assets/celestial/releases/20261002-4k-v1/`. The original HTML, JavaScript and
source manifests are unchanged. Versioned frames have immutable cache headers;
the manifest revalidates. A real `404.html` prevents missing assets from falling
back to the home page.

Blender sources, render metadata, source archives, credentials, scripts and
working directories are excluded. Never deploy the repository root or the
whole `.render-work` directory. If a later atlas changes frame bytes, use a new
`--version` rather than reusing an immutable release URL. This builder accepts
the current legacy ten-body atlas; later multilayer/multiresolution atlases
need their own validation and a new file-count assessment.

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
npx --yes wrangler@4.148.0 pages deploy .render-work/cloudflare-pages/site --project-name sjtufreshman --branch main
```

For subsequent builds, pass the exact new output directory to `pages deploy`.
This workflow uploads local verified artifacts; a Git push alone does not
deploy. A fresh clone must first restore the ignored atlas, including its
manifest and per-body package records, from the existing private release
archives (`SJTUFreshman/life-celestial-assets`, release `20261002-4k-v1`).
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

Cloudflare retains prior deployments for rollback. To deliberately publish a
small website build using the existing Tencent CDN instead, prepare a fresh
directory with `--external-atlas` and deploy that directory. Confirm the
current tunnel URL is still available before using this fallback.

## Capacity and source control

At migration time, the prepared website has 16,527 files (including Pages
configuration files), below the free Pages limit of 20,000. Each file is below
the 25 MiB limit. Wrangler is required because browser drag-and-drop is limited
to 1,000 files. A larger future atlas must be checked again before publication.

Pages capacity is separate from GitHub repository storage. Hosting the complete
public website on Pages does not put the ignored frame files or Blender
engineering archives into Git, and it does not merge or remove the existing
asset repositories. Engineering archives are not website assets.

Official references:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
