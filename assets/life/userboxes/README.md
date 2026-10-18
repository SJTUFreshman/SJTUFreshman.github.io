# Wikipedia userboxes

The 29 selected userboxes are adapted from the Chinese Wikipedia templates and
the user subpage listed in [sources.json](sources.json). Their authors are the
Wikipedia contributors credited in each linked page history. Template text and
markup are available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/);
these adapted template snapshots are distributed under the same license.

The image entries in `sources.json` identify every local thumbnail, its original
Commons description page, original author, license and source URL. Images retain
their individual licenses. The local thumbnails are unchanged Wikimedia bytes;
their SHA-256 hashes are recorded in the manifest. Images link back to their
description pages in the userboxes. The static snapshots carry their template
source URL in `data-source`, and all original text links remain functional.

Retrieved on 2026-10-18. `templates.json` contains reviewed fragments of the
rendered userboxes only. Documentation, categories, scripts, template styles and
page chrome were excluded. Links are absolute; images are served locally. The
Chinese versions retain Wikipedia's simplified/traditional rendering and
template-specific text. The English version retains the template appearance and
uses the existing profile translation (`{{text}}`, escaped during rendering).

`site_renderer.py` selects a snapshot using `life.profile.userboxes[].wiki_template`
and renders all three language variants; only the active variant is shown.
`05-life-content.css` adapts the outer 240 px boxes to narrow panels while retaining
original cell sizes, border colors, typography, imagery and two/three-cell layouts.
The surrounding profile uses the site's design. No embed or runtime request to
Wikipedia is required.

Snapshots are trusted, reviewed source files, not visitor-editable HTML. When
updating them, extract only `.wikipediauserbox`, retain only presentation markup,
remove scripts/event handlers/page styles, inspect all links, and use local image
paths. Update source histories and image attributions in the manifest together
with any template or asset changes.
