"""Public Steam profile decoration and cached achievement enrichment.

This module never reads credentials or writes snapshots. The caller supplies its
HTTP client and previous snapshot; only public page fields are retained.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import re
from threading import Event
from urllib.parse import urlsplit


ASSET_BASE = 'https://shared.fastly.steamstatic.com/community_assets/images/'
CACHE_SECONDS = 24 * 60 * 60
MAX_WORKERS = 3


def clean(value):
    return ' '.join(str(value or '').split())[:1000]


def asset_url(value):
    if not isinstance(value, str) or any(ord(char) < 32 for char in value):
        return None
    try:
        url = urlsplit(value)
        host = url.hostname or ''
        safe_host = any(host == item or host.endswith('.' + item)
                        for item in ('steamstatic.com', 'steamusercontent.com'))
        safe_host = safe_host or host in ('steamcdn-a.akamaihd.net', 'media.steampowered.com')
        if url.scheme == 'https' and safe_host and not url.username and not url.password and url.port in (None, 443):
            return value
    except ValueError:
        pass
    return None


class Element:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def nodes(self, cls=None, tag=None):
        result = []
        for child in self.children:
            if isinstance(child, Element):
                if (not cls or cls in child.attrs.get('class', '').split()) and (not tag or tag == child.tag):
                    result.append(child)
                result.extend(child.nodes(cls, tag))
        return result

    def text(self):
        return ''.join(child.text() if isinstance(child, Element) else child for child in self.children)


class Page(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Element()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)


def first_text(node, cls):
    matches = node.nodes(cls)
    return clean(matches[0].text()) if matches else ''


def public_profile_url(value, steam_id):
    try:
        url = urlsplit(value)
        if (url.scheme == 'https' and url.hostname == 'steamcommunity.com'
                and not url.username and not url.password and url.port in (None, 443)
                and url.path.startswith(f'/profiles/{steam_id}/')):
            return value
    except (ValueError, TypeError):
        pass
    return None


def parse_profile(html, steam_id):
    if f'profiles/{steam_id}' not in html:
        raise ValueError('Profile identity not present')
    root = Page(html).root
    result = {'badges': [], 'background': {}}
    headers = root.nodes('profile_header_badgeinfo')
    if headers:
        level = first_text(headers[0], 'friendPlayerLevelNum')
        if level.isdigit():
            result['level'] = int(level)
    for container in root.nodes('profile_badges'):
        count = first_text(container, 'profile_count_link_total').replace(',', '')
        if count.isdigit():
            result['badgeCount'] = int(count)
        for badge in container.nodes('profile_badges_badge'):
            links, images = badge.nodes(tag='a'), badge.nodes(tag='img')
            if not links or not images:
                continue
            href = public_profile_url(links[0].attrs.get('href'), steam_id)
            image = asset_url(images[0].attrs.get('src'))
            tooltip = badge.attrs.get('data-tooltip-html', '')
            name = clean(re.split(r'<br\s*/?>', tooltip, flags=re.I)[0])
            if href and image and name:
                record = {'name': name, 'imageUrl': image, 'href': href}
                level = re.search(r'\bLevel\s+(\d+)', tooltip)
                if level:
                    record['level'] = int(level[1])
                result['badges'].append(record)
    for element in root.nodes('profile_page'):
        match = re.search(r'background-image\s*:\s*url\(\s*[\'"]?([^\'"\)]+)', element.attrs.get('style', ''))
        if match and asset_url(match[1].strip()):
            result['background'] = {'posterUrl': match[1].strip(), 'source': 'profile'}
            break
    videos = root.nodes('profile_animated_background')
    if videos:
        for video in videos[0].nodes(tag='video'):
            poster = asset_url(video.attrs.get('poster'))
            if poster:
                result['background']['posterUrl'] = poster
            for source in video.nodes(tag='source'):
                url = asset_url(source.attrs.get('src'))
                if url and (source.attrs.get('type') == 'video/mp4' or urlsplit(url).path.endswith('.mp4')):
                    result['background'].update(videoUrl=url, source='profile')
    return result


def parse_badges(html, steam_id):
    root = Page(html).root
    records = []
    for row in root.nodes('badge_row'):
        links, images = row.nodes('badge_row_overlay'), row.nodes('badge_icon')
        name = first_text(row, 'badge_info_title')
        if not name or not links or not images:
            continue
        href = public_profile_url(links[0].attrs.get('href'), steam_id)
        image = asset_url(images[0].attrs.get('data-delayed-image') or images[0].attrs.get('src'))
        if not href or not image:
            continue
        record = {'name': name, 'imageUrl': image, 'href': href}
        description = first_text(row, 'badge_info_description')
        level = re.search(r'\bLevel\s+(\d+)', description)
        xp = re.search(r'([\d,]+)\s+XP\b', description)
        if level:
            record['level'] = int(level[1])
        if xp:
            record['xp'] = int(xp[1].replace(',', ''))
        records.append(record)
    return records


def ssr_queries(html):
    scripts = [node for node in Page(html).root.nodes(tag='script')
               if node.attrs.get('id') == 'valve-ssr-data']
    if not scripts:
        raise ValueError('Public achievement page has no structured data')
    data = json.loads(scripts[0].text())
    if data.get('route') != '/profiles/:steamid/achievements/:appid':
        raise ValueError('Unexpected achievement page route')
    queries = data.get('renderContext', {}).get('queryData', {})
    for _ in range(2):
        if isinstance(queries, str):
            queries = json.loads(queries)
    return queries.get('queries', [])


def equipped_background(queries, steam_id):
    """Prefer the actual animated mini profile if the full profile is static."""
    query = next((item for item in queries if item.get('queryKey') == ['ProfileItemsEquipped', steam_id]), None)
    if not query:
        return None
    equipped = query.get('state', {}).get('data', {})
    for field, origin in (('profile_background', 'profile'), ('mini_profile_background', 'mini-profile')):
        item = equipped.get(field, {})
        video = item.get('movie_mp4') or item.get('movie_webm')
        if not video or not isinstance(video, str) or not video.startswith('items/'):
            continue
        video_url = asset_url(ASSET_BASE + video)
        poster = item.get('image_large')
        poster_url = asset_url(ASSET_BASE + poster) if isinstance(poster, str) and poster.startswith('items/') else None
        if video_url:
            result = {'videoUrl': video_url, 'source': origin, 'name': clean(item.get('item_title') or item.get('name'))}
            if poster_url:
                result['posterUrl'] = poster_url
            return result
    return None


def unavailable():
    return {'status': 'unavailable', 'items': []}


def retryable_unavailable():
    return {'status': 'unavailable', 'items': [], '_preservePrevious': True}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def cache_valid(record):
    if not isinstance(record, dict) or record.get('status') not in ('available', 'none'):
        return False
    items, total, unlocked = record.get('items'), record.get('total'), record.get('unlocked')
    if not isinstance(items, list) or not isinstance(total, int) or not isinstance(unlocked, int):
        return False
    if isinstance(total, bool) or isinstance(unlocked, bool) or not 0 <= unlocked <= total or total != len(items):
        return False
    if record['status'] == 'none' and total != 0:
        return False
    try:
        stamp = datetime.fromisoformat(record['updatedAt'].replace('Z', '+00:00'))
        return stamp.tzinfo is not None and stamp <= datetime.now(timezone.utc)
    except (ValueError, KeyError, TypeError):
        return False


def cache_fresh(record):
    if not cache_valid(record):
        return False
    stamp = datetime.fromisoformat(record['updatedAt'].replace('Z', '+00:00'))
    return (datetime.now(timezone.utc) - stamp).total_seconds() < CACHE_SECONDS


def from_api(schema_response, player_response, app_id, steam_id):
    game = schema_response.get('game', {})
    schema = game.get('availableGameStats', {}).get('achievements')
    if not isinstance(schema, list):
        return unavailable()
    if not schema:
        return {'status': 'none', 'unlocked': 0, 'total': 0, 'items': [], 'updatedAt': utc_now()}
    player = player_response.get('playerstats', {})
    if not player.get('success') or str(player.get('steamID')) != steam_id:
        return unavailable()
    states = {item.get('apiname'): item for item in player.get('achievements', []) if isinstance(item, dict)}
    items = []
    for definition in schema:
        key = definition.get('name')
        if not isinstance(key, str) or not key:
            continue
        state = states.get(key, {})
        unlocked = state.get('achieved') == 1
        item = {'id': key, 'name': clean(definition.get('displayName') or key),
                'description': clean(definition.get('description')), 'unlocked': unlocked}
        icon = asset_url(definition.get('icon') if unlocked else definition.get('icongray') or definition.get('icon'))
        if icon:
            item['iconUrl'] = icon
        stamp = state.get('unlocktime')
        if unlocked and isinstance(stamp, int) and not isinstance(stamp, bool) and stamp > 0:
            item['unlockedAt'] = stamp
        items.append(item)
    if not items:
        return unavailable()
    return {'status': 'available', 'unlocked': sum(item['unlocked'] for item in items),
            'total': len(items), 'items': items, 'updatedAt': utc_now(), 'source': 'steam-api'}


def from_public_queries(queries, app_id, steam_id):
    def value(key):
        item = next((query for query in queries if query.get('queryKey') == key), {})
        return item.get('state', {}).get('data', {})
    schema = value(['achievements', app_id, 'schema_v2'])
    player = value(['achievements', app_id, 'user_achievements', steam_id])
    if schema.get('appid') != app_id or player.get('appid') != app_id or player.get('steamid') != steam_id:
        return unavailable()
    if not isinstance(schema.get('groups'), list) or not isinstance(player.get('achievements'), dict):
        return unavailable()
    items = []
    for group in schema['groups']:
        if group.get('archived') or group.get('developeronly') or group.get('ispublic') is False:
            continue
        for definition in group.get('achievements', []):
            if definition.get('archived'):
                continue
            key = definition.get('internal_key')
            state = player['achievements'].get(str(key), {})
            unlocked = state.get('unlocked') is True
            item = {'id': str(definition.get('api_name') or key), 'name': clean(definition.get('name')),
                    'description': clean(definition.get('description')), 'unlocked': unlocked}
            icon = definition.get('icon_achieved' if unlocked else 'icon_unachieved')
            if isinstance(icon, str) and re.fullmatch(r'[a-zA-Z0-9_.-]+', icon):
                item['iconUrl'] = ASSET_BASE + f'apps/{app_id}/{icon}'
            stamp = state.get('unlock_time')
            if unlocked and isinstance(stamp, int) and not isinstance(stamp, bool) and stamp > 0:
                item['unlockedAt'] = stamp
            items.append(item)
    return {'status': 'available' if items else 'none', 'unlocked': sum(item['unlocked'] for item in items),
            'total': len(items), 'items': items, 'updatedAt': utc_now(), 'source': 'public-achievement-page'}


def enrich_profile(snapshot, client, warn, previous=None):
    """Enrich in place. No keys, private page fields, or raw errors are emitted."""
    if snapshot.get('visibility') == 'private':
        snapshot.pop('profileExtras', None)
        return snapshot
    steam_id = str(snapshot.get('steamId', ''))
    if not re.fullmatch(r'\d{17}', steam_id):
        return snapshot
    previous = previous if isinstance(previous, dict) and previous.get('steamId') == steam_id else {}
    profile_url = f'https://steamcommunity.com/profiles/{steam_id}/'
    old_extras = previous.get('profileExtras', {})
    extras = deepcopy(old_extras) if isinstance(old_extras, dict) and old_extras else {'badges': [], 'background': {}}
    if old_extras:
        extras['stale'] = True
    try:
        extras = parse_profile(client.get(profile_url + '?l=english'), steam_id)
        extras['updatedAt'] = utc_now()
    except Exception:
        warn('Public Steam profile decorations could not be refreshed; any cached decoration date was retained.')
    try:
        badges = parse_badges(client.get(profile_url + 'badges/?l=english'), steam_id)
        if badges:
            extras['badges'] = badges
            extras['badgeCount'] = len(badges)
    except Exception:
        if isinstance(old_extras, dict) and old_extras.get('badges'):
            extras['badges'] = deepcopy(old_extras['badges'])
            extras['badgeCount'] = old_extras.get('badgeCount', len(old_extras['badges']))
            extras['badgesStale'] = True
        warn('Public Steam badges could not be refreshed.')
    # A public achievements page also embeds the equipped profile decorations.
    public_cache = {}
    for game in snapshot.get('games', [])[:1]:
        app_id = game.get('appId')
        if not isinstance(app_id, int) or isinstance(app_id, bool) or app_id <= 0:
            continue
        try:
            queries = ssr_queries(client.get(profile_url + f'achievements/{app_id}/?l=english'))
            public_cache[app_id] = from_public_queries(queries, app_id, steam_id)
            background = equipped_background(queries, steam_id)
            if background:
                extras['background'] = background
        except Exception:
            pass
    extras['sourceUrl'] = profile_url
    snapshot['profileExtras'] = extras
    previous_games = {game.get('appId'): game.get('achievements', {})
                      for field in ('games', 'library') for game in previous.get(field, []) if isinstance(game, dict)}
    games = {}
    for field in ('games', 'library'):
        for game in snapshot.get(field, []):
            app_id = game.get('appId')
            if isinstance(app_id, int) and not isinstance(app_id, bool) and app_id > 0:
                games.setdefault(app_id, []).append(game)
    results, pending = {}, []
    for app_id in games:
        cached = previous_games.get(app_id, {})
        if cache_fresh(cached):
            results[app_id] = deepcopy(cached)
        else:
            pending.append(app_id)
    stopped = Event()

    def fetch(app_id):
        if stopped.is_set():
            return app_id, retryable_unavailable()
        try:
            if client.key:
                schema = client.api('ISteamUserStats', 'GetSchemaForGame', version=2, appid=app_id, l='english')
                definitions = schema.get('game', {}).get('availableGameStats', {}).get('achievements')
                if not isinstance(definitions, list):
                    # Older/non-achievement games often return an empty API schema.
                    # The public SSR schema supplies explicit empty groups as proof.
                    queries = ssr_queries(client.get(profile_url + f'achievements/{app_id}/?l=english'))
                    return app_id, from_public_queries(queries, app_id, steam_id)
                player = client.api('ISteamUserStats', 'GetPlayerAchievements', steamid=steam_id, appid=app_id, l='english') if definitions else {}
                return app_id, from_api(schema, player, app_id, steam_id)
            if app_id in public_cache:
                return app_id, public_cache[app_id]
            if app_id not in {game.get('appId') for game in snapshot.get('games', [])[:3]}:
                return app_id, retryable_unavailable()
            queries = ssr_queries(client.get(profile_url + f'achievements/{app_id}/?l=english'))
            return app_id, from_public_queries(queries, app_id, steam_id)
        except Exception as error:
            if '429' in str(error):
                stopped.set()
            # Access-denied responses must not resurrect data made private.
            return app_id, unavailable() if '403' in str(error) else retryable_unavailable()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for future in as_completed([pool.submit(fetch, app_id) for app_id in pending]):
            app_id, result = future.result()
            results[app_id] = result
    missing = retained = 0
    for app_id, rows in games.items():
        result = results.get(app_id, unavailable())
        preserve = result.pop('_preservePrevious', False)
        if preserve and cache_valid(previous_games.get(app_id)):
            result = deepcopy(previous_games[app_id])
            result['stale'] = True
            retained += 1
        if result['status'] == 'unavailable':
            missing += 1
        for game in rows:
            game['achievements'] = deepcopy(result)
    if missing:
        warn(f'Achievements are unavailable for {missing} Steam games; their library entries were retained.')
    if retained:
        warn(f'Kept cached achievements for {retained} Steam games after a refresh failure; their original dates were retained.')
    return snapshot
