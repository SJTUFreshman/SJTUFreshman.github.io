# Games · Complete Steam library

The Life games constellation reads `steam-profile.json` for the public profile
`https://steamcommunity.com/profiles/76561199195301474/`. It supplies the complete
game shelf, public profile card, covers and game achievements. Generated content
is shared by `life.html` and `observatory.html`.

The first complete API import on 2026-11-16 returned **81 games**. The public
profile displayed **79**; these are separate Steam counts. `gameCount` matches
the imported library, while `profileGameCount` preserves the profile's figure.
The import includes played free games (`include_played_free_games=1`).

## Refresh

```sh
python scripts/sync-steam-profile.py
python site_renderer.py --games-only
```

The script uses only Python's standard library. On a machine that already uses
a local network proxy, pass it explicitly, for example
`--proxy http://127.0.0.1:7897`; this does not change system settings.

The checked-in snapshot lets the page work without a visitor login. `games`
contains recent entries; `library` contains the complete inventory returned by
Steam only after a successful API sync. `libraryStatus` explicitly distinguishes
`complete` from `unavailable`; recent entries are never presented as a full library.
`libraryUpdatedAt` records the library's own refresh time, independently of the
profile's `updatedAt`. Public HTML playtimes are rounded by Steam; unknown durations
remain `null`.

The existing Cloudflare Pages GitHub workflow refreshes this snapshot every six
hours (00:17, 06:17, 12:17 and 18:17 UTC), and on website pushes/manual runs. It
regenerates only the games block, builds the website, and deploys it through the
existing Cloudflare project. It does not commit generated changes back to Git.
The workflow passes `--restore-published` to reuse the newer validated snapshot
from the existing published website before refreshing. This preserves metadata
and achievement caches across fresh CI checkouts. An older or invalid remote
snapshot never replaces the local one.
Scheduling becomes active after this workflow reaches the repository's default
branch; GitHub may delay scheduled runs. GitHub may also disable schedules in
public repositories after extended inactivity.

## Complete Steam library

Configure a repository Actions secret named `STEAM_API_KEY` to enable the official
Steam Web API path. Never put the key in this JSON, the HTML, `site_content.json`,
or a committed file. For local use, provide the same environment variable or put
exactly one `STEAM_API_KEY=` line in the ignored repository-root `.env.steam.local`
file. The value must be a 32-character hexadecimal Steam key. Environment values
take priority; CI reads only its environment and never the local file.
Requests use the `x-webapi-key` header; logs never print the key or raw errors.

The owner has explicitly requested displaying their full game library. The script
verifies the account and public profile, then calls `GetOwnedGames` directly; it
does not depend on Steam's browser games page, which currently redirects anonymous
visitors to sign-in. It validates the returned game count before marking a library
complete. Steam can naturally omit games unavailable to the API. It never logs in,
consumes browser session cookies, or exports friends/location data.

When the key is absent or the API fails, an existing complete library remains in
place with its original `libraryUpdatedAt`. If no complete snapshot exists,
`libraryStatus` stays `unavailable`; the script does not invent games to fill it.

Optional public store metadata adds `names` (`en`, `zh-CN`), `coverUrl` for a verified
vertical library image, and a working `imageUrl` from the store response. Missing
vertical artwork falls back to the horizontal image. Metadata is cached for 30
days, and at most 12 games are enriched per refresh, with four concurrent requests.
This keeps repeated six-hour updates small while gradually filling large libraries.
The initial complete snapshot has store metadata for all 81 games and verified
vertical images for 78; the remaining three use their Steam store header images.

## Achievements, badges and background

`scripts/steam-profile-extras.py` is loaded by the sync script. It enriches
`profileExtras` with the public Steam level, badges and equipped background,
and adds an `achievements` record to each game. Backgrounds keep their actual
source (`profile` or `mini-profile`) instead of labelling a mini-profile animation
as the full-profile background.

Achievement records distinguish `available`, `none` and `unavailable`. Available
records include the unlocked count, total, names, descriptions and icons. Missing
data never removes a game from the complete library. The official API path uses
`GetSchemaForGame` plus `GetPlayerAchievements`; a public achievement-page fallback
can enrich recent games without a key. Requests are limited to three concurrent
games and cached for 24 hours. No passwords, session cookies or private account
fields are saved in the snapshot.

The initial complete import has 60 games with 4,186 achievement records and 21
games confirmed to have no Steam achievements. An empty legacy API schema is
checked against the account's public achievement page before being labelled
`none`. Temporary network/rate-limit failures preserve valid old achievement
data with its original timestamp and a `stale` flag; explicit privacy denial
removes those details. The cabinet displays the equipped UNIVERSE mini-profile
animation and respects reduced-motion preferences and the pause control.

An explicitly private profile replaces the snapshot with a redacted record so
the next deployment removes previously displayed personal data. A network or
format failure keeps the existing file and its original `updatedAt`, with a
warning. Scheduled runs use `--require-refresh` to stop deployment on that failure,
preserving the last deployed snapshot rather than reverting it to the repository
copy. Pushes can still deploy unrelated website changes using the checked-in
snapshot. If no valid snapshot exists, a failed refresh exits nonzero.

The snapshot is public website content. Only add this file and its intended public
assets to Git; `prepare-cloudflare-pages.py` packages tracked files under `assets/`.

## Game notes

Add notes in `site_content.json` → `life.games.entries`, in display order. Each
entry has a unique `id`, multilingual `title` and `text`, and an optional local
`image` under `images/games/` (`.jpg`, `.png`, or `.webp`). The image opens in the
existing keyboard-accessible lightbox. Omit `image` for a text-only note.

```json
{
  "id": "first-journey",
  "title": { "en": "A first journey", "zh-CN": "第一次旅程", "zh-TW": "第一次旅程" },
  "text": { "en": "Your own notes.", "zh-CN": "写下你的感想。", "zh-TW": "寫下你的感想。" }
}
```

Use `python site_renderer.py --games-only` after editing. This narrow update
preserves other manually maintained Life content and mirrors Games into the
observatory page. Steam refreshes never modify these notes.

## Checks

```sh
python scripts/test-sync-steam-profile.py
python scripts/test-steam-profile-extras.py
python scripts/test-life-games.py
python site_renderer.py --check --games-only
```

The offline checks cover parsing, hidden playtime, account/origin validation,
atomic failure recovery, explicit privacy changes, complete-inventory validation,
library retention, and strict local key loading.

Official references:
- [Steam Web API overview](https://partner.steamgames.com/doc/webapi_overview)
- [User summaries](https://partner.steamgames.com/doc/webapi/ISteamUser#GetPlayerSummaries)
- [Player games](https://partner.steamgames.com/doc/webapi/IPlayerService)
