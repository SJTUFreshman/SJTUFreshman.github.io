# Production snapshot, 29 October 2026

This checkout includes the public pages and runtime assets recovered from
https://sjtufreshman.pages.dev/ on 29 October 2026. Production was newer than
GitHub main (`73d3a8402487b77f57b826a3e621cdc2baeaee1f`). The recovery preserves
the handwritten sky, personal profile, gallery additions, friend photo viewer,
review excerpts, site identity and progressive footprint maps.

The older `site_content.json` and content-generation routines were not available
in the published site. Do not regenerate the recovered content with those older
sources: doing so would restore the October 22 content. Reconcile the original
authoring sources before using a full `site_renderer.py` regeneration.
`render_observatory` still derives the observatory page from the current Life HTML.

The Life card update moves constellation meanings after section content, uses
localized constellation subtitles, removes the archive and Escape captions, and
shows catalogue information in star tooltips. The solar glow is projected from
its fixed position independently of label visibility. Handwriting images remain
in an inert template used by the existing sky animation.

Validate these changes with `node scripts/validate-life-card-updates.cjs <base-url>`
and `node scripts/validate-solar-destination.cjs <base-url>`. The older broad
validation scripts contain assumptions about the October 22 production content.

Published to Cloudflare Pages on 29 October 2026 as release
`20261029-life-cards`: https://98535790.sjtufreshman.pages.dev/.
The production alias https://sjtufreshman.pages.dev/ serves this deployment.
The homepage, Life and observatory HTML match the prepared build. Live desktop,
mobile and three-language card checks passed, along with the HTTP validation of
all 39 versioned Life resources. This Direct Upload did not update GitHub main.
