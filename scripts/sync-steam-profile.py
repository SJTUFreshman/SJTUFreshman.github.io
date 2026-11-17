"""Refresh the public Steam snapshot used by Life. No third-party dependencies."""

import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
STEAM_ID = '76561199195301474'
DEFAULT_OUTPUT = ROOT / 'assets/life/games/steam-profile.json'
PROFILE_URL = f'https://steamcommunity.com/profiles/{STEAM_ID}/'
REQUEST_HOSTS = {'steamcommunity.com', 'api.steampowered.com', 'store.steampowered.com'}
PUBLISHED_SNAPSHOT = 'https://sjtufreshman.pages.dev/assets/life/games/steam-profile.json'
REQUEST_HOSTS.add('sjtufreshman.pages.dev')
IMAGE_HOSTS = {
    'avatars.fastly.steamstatic.com', 'avatars.akamai.steamstatic.com',
    'avatars.steamstatic.com', 'shared.fastly.steamstatic.com',
    'shared.akamai.steamstatic.com', 'shared.steamstatic.com',
    'cdn.fastly.steamstatic.com', 'cdn.akamai.steamstatic.com',
    'cdn.cloudflare.steamstatic.com', 'cdn.steamstatic.com',
    'steamcdn-a.akamaihd.net', 'community.fastly.steamstatic.com',
    'community.akamai.steamstatic.com', 'media.steampowered.com',
}
MAX_RESPONSE = 4 * 1024 * 1024
STORE_CACHE_DAYS = 30
STORE_REFRESH_LIMIT = 12


class SyncError(Exception):
    """A safely printable failure, never containing a URL with a key."""


class PrivacyError(SyncError):
    pass


def valid_url(value, hosts):
    if not isinstance(value, str) or any(ord(char) < 32 for char in value):
        raise SyncError('Invalid URL in Steam response.')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname not in hosts or
            parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise SyncError('Unexpected URL origin in Steam response.')
    return value


def clean_text(value):
    if not isinstance(value, str):
        raise SyncError('Expected a Steam display name.')
    return ' '.join(''.join(char for char in value if ord(char) >= 32).split())[:300]


def number(value):
    if isinstance(value, bool):
        raise SyncError('Invalid numeric Steam data.')
    try:
        result = int(value)
    except (ValueError, TypeError, OverflowError):
        raise SyncError('Invalid numeric Steam data.') from None
    if result < 0 or result > 10**12:
        raise SyncError('Out-of-range Steam data.')
    return result


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        valid_url(newurl, REQUEST_HOSTS | IMAGE_HOSTS)
        # A key-bearing request must never be redirected at all.
        if req.has_header('X-webapi-key'):
            raise SyncError('Steam API unexpectedly redirected a protected request.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Client:
    def __init__(self, proxy=None, key=None):
        handlers = [SafeRedirect()]
        if proxy:
            parsed = urlsplit(proxy)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                raise SyncError('Invalid proxy URL.')
            handlers.append(ProxyHandler({'https': proxy}))
        self.opener = build_opener(*handlers)
        self.key = key

    def get(self, url, api=False):
        valid_url(url, REQUEST_HOSTS)
        headers = {'User-Agent': 'RundeLifeSteamSync/1.0', 'Accept-Language': 'en-US,en;q=0.9'}
        if api:
            if urlsplit(url).hostname != 'api.steampowered.com' or not self.key:
                raise SyncError('Invalid API request.')
            headers['x-webapi-key'] = self.key
        try:
            with self.opener.open(Request(url, headers=headers), timeout=25) as response:
                valid_url(response.url, REQUEST_HOSTS)
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise SyncError('Steam response exceeds the size limit.')
                return raw.decode('utf-8')
        except HTTPError as error:
            raise SyncError(f'Steam returned HTTP {error.code}.') from None
        except (URLError, OSError, UnicodeError, ValueError):
            raise SyncError('Could not read Steam over HTTPS.') from None

    def api(self, interface, method, version=None, **params):
        version = version or (2 if method == 'GetPlayerSummaries' else 1)
        url = f'https://api.steampowered.com/{interface}/{method}/v{number(version)}/?{urlencode(params)}'
        try:
            return json.loads(self.get(url, api=True))
        except json.JSONDecodeError:
            raise SyncError('Steam API returned invalid JSON.') from None

    def store_details(self, app):
        try:
            response = json.loads(self.get('https://store.steampowered.com/api/appdetails?' +
                                           urlencode({'appids': app, 'l': 'schinese'})))
            entry = response.get(str(app), {})
            return entry.get('data', {}) if entry.get('success') else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def image_exists(self, url):
        valid_url(url, IMAGE_HOSTS)
        try:
            with self.opener.open(Request(url, method='HEAD'), timeout=10) as response:
                valid_url(response.url, IMAGE_HOSTS)
                return response.status == 200 and response.headers.get('Content-Type', '').startswith('image/')
        except (URLError, OSError, ValueError, SyncError):
            return False


class Node:
    def __init__(self, tag='', attrs=None, parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs or []), parent
        self.children = []

    def text(self):
        return ''.join(child if isinstance(child, str) else child.text() for child in self.children)

    def nodes(self, cls=None, tag=None):
        result = []
        for child in self.children:
            if isinstance(child, Node):
                if ((not cls or cls in child.attrs.get('class', '').split()) and
                        (not tag or child.tag == tag)):
                    result.append(child)
                result.extend(child.nodes(cls, tag))
        return result


class ProfileParser(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)


def parse_identity(xml):
    if '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
        raise SyncError('Unexpected document in Steam XML response.')
    try:
        profile = ET.fromstring(xml)
    except ET.ParseError:
        raise SyncError('Steam returned invalid profile XML.') from None
    if profile.tag != 'profile' or profile.findtext('steamID64') != STEAM_ID:
        raise SyncError('The Steam response does not match the configured SteamID.')
    if profile.findtext('privacyState') != 'public':
        raise PrivacyError('Steam profile is no longer public.')
    name = clean_text(profile.findtext('steamID'))
    if not name:
        raise SyncError('Missing public Steam name.')
    return name, valid_url(profile.findtext('avatarFull'), IMAGE_HOSTS)


def parse_profile(html, identity):
    root = ProfileParser(html).root
    if root.nodes('profile_private_info'):
        raise PrivacyError('Steam profile is no longer public.')
    names = root.nodes('actual_persona_name')
    if not names or clean_text(names[0].text()) != identity[0]:
        raise SyncError('Steam profile HTML could not be verified.')
    # Verify the account independently of its mutable display name.
    match = re.search(r'g_rgProfileData\s*=\s*({[^\n]+?});', html)
    try:
        details = json.loads(match.group(1)) if match else {}
    except json.JSONDecodeError:
        details = {}
    if details.get('steamid') != STEAM_ID:
        raise SyncError('Steam HTML belongs to an unexpected account.')
    count = None
    for link in root.nodes(tag='a'):
        if link.attrs.get('href', '').startswith(PROFILE_URL + 'games/'):
            counts = link.nodes('profile_count_link_total')
            if counts:
                count = number(clean_text(counts[0].text()).replace(',', ''))
                break
    games = []
    for item in root.nodes('recent_game'):
        names = item.nodes('game_name')
        details = item.nodes('game_info_details')
        images = item.nodes('game_capsule', 'img')
        if not names or not details or not images:
            raise SyncError('Steam recent-game layout changed.')
        links = names[0].nodes(tag='a')
        href = links[0].attrs.get('href', '') if links else ''
        valid_url(href, {'steamcommunity.com'})
        app = re.fullmatch(r'https://steamcommunity\.com/app/(\d+)/?', href)
        if not app:
            raise SyncError('Unexpected recent-game link.')
        hours = re.search(r'([\d,.]+)\s+hrs? on record', details[0].text())
        # A missing duration can mean playtime privacy. Never fill it from an owner API key.
        minutes = None
        if hours:
            try:
                minutes = number(round(Decimal(hours[1].replace(',', '')) * 60))
            except InvalidOperation:
                raise SyncError('Invalid playtime in Steam profile.') from None
        games.append({'appId': number(app[1]), 'name': clean_text(names[0].text()),
                      'imageUrl': valid_url(images[0].attrs.get('src'), IMAGE_HOSTS),
                      'storeUrl': f'https://store.steampowered.com/app/{app[1]}/',
                      'playtimeMinutes': minutes})
    # Missing recent games on an otherwise verified account may indicate changed
    # game-detail privacy. Clear them rather than retaining old public activity.
    return {'schemaVersion': 1, 'steamId': STEAM_ID, 'profileUrl': PROFILE_URL,
            'displayName': identity[0], 'avatarUrl': identity[1], 'gameCount': count,
            'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'source': 'public-profile', 'libraryStatus': 'unavailable', 'games': games[:3]}


def api_game(game):
    app = number(game['appid'])
    result = {'appId': app, 'name': clean_text(game.get('name') or f'Steam app {app}'),
              'imageUrl': f'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app}/header.jpg',
              'storeUrl': f'https://store.steampowered.com/app/{app}/',
              'playtimeMinutes': number(game['playtime_forever']) if 'playtime_forever' in game else None}
    if game.get('rtime_last_played'):
        result['lastPlayedAt'] = datetime.fromtimestamp(number(game['rtime_last_played']), timezone.utc).isoformat().replace('+00:00', 'Z')
    return result


def enrich_api(snapshot, client, warn):
    players = client.api('ISteamUser', 'GetPlayerSummaries', steamids=STEAM_ID).get('response', {}).get('players', [])
    if len(players) != 1 or players[0].get('steamid') != STEAM_ID:
        raise SyncError('Steam API returned a different account.')
    if players[0].get('communityvisibilitystate') != 3:
        raise PrivacyError('Steam API reports a private profile.')
    # The owner explicitly requested publishing their complete library. Use the
    # official API response rather than depending on the login-only games webpage.
    owned = client.api('IPlayerService', 'GetOwnedGames', steamid=STEAM_ID, include_appinfo=1,
                       include_played_free_games=1).get('response', {})
    if not isinstance(owned.get('games', []), list) or 'game_count' not in owned:
        raise SyncError('Steam did not return an accessible game library.')
    library = [api_game(game) for game in owned.get('games', [])]
    if len(library) != number(owned['game_count']) or len({game['appId'] for game in library}) != len(library):
        raise SyncError('Steam returned an incomplete or duplicate game library.')
    snapshot.update(source='steam-api', libraryStatus='complete', libraryUpdatedAt=snapshot['updatedAt'],
                    profileGameCount=snapshot['gameCount'], gameCount=len(library),
                    library=sorted(library, key=lambda game: -(game['playtimeMinutes'] or 0)))
    try:
        recent = client.api('IPlayerService', 'GetRecentlyPlayedGames', steamid=STEAM_ID,
                            count=3).get('response', {})
        if 'total_count' in recent or isinstance(recent.get('games'), list):
            snapshot['games'] = [api_game(game) for game in recent.get('games', [])]
    except (SyncError, KeyError, TypeError, ValueError):
        warn('Recent activity could not be refreshed; the complete library was retrieved successfully.')
    return snapshot


def metadata_cache(previous):
    result = {}
    for game in previous.get('games', []) + previous.get('library', []):
        result[game['appId']] = {field: game[field] for field in (
            'imageUrl', 'coverUrl', 'names', 'storeDetailsUpdatedAt', 'achievements') if field in game}
    return result


def enrich_store(snapshot, previous, client):
    """Cache optional public cover/name metadata; never block the game inventory."""
    cached = metadata_cache(previous)
    by_app = {}
    for game in snapshot.get('games', []) + snapshot.get('library', []):
        by_app.setdefault(game['appId'], []).append(game)
        game.update(cached.get(game['appId'], {}))
    if not hasattr(client, 'store_details'):
        return
    now = datetime.now(timezone.utc)
    pending = []
    for app, games in by_app.items():
        timestamp = games[0].get('storeDetailsUpdatedAt')
        try:
            fresh = timestamp and (now - datetime.fromisoformat(timestamp.replace('Z', '+00:00'))).days < STORE_CACHE_DAYS
        except (ValueError, TypeError):
            fresh = False
        if not fresh:
            pending.append(app)
    def fetch(app):
        try:
            data = client.store_details(app)
            if not data:
                return app, {}
            details = {'storeDetailsUpdatedAt': now.isoformat(timespec='seconds').replace('+00:00', 'Z')}
            if data.get('header_image'):
                details['imageUrl'] = valid_url(data['header_image'], IMAGE_HOSTS)
            details['names'] = {'en': by_app[app][0]['name'], 'zh-CN': clean_text(data.get('name') or by_app[app][0]['name'])}
            cover = f'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app}/library_600x900.jpg'
            if client.image_exists(cover):
                details['coverUrl'] = cover
            return app, details
        except (SyncError, ValueError, KeyError, TypeError):
            return app, {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for app, details in pool.map(fetch, pending[:STORE_REFRESH_LIMIT]):
            for game in by_app[app]:
                game.update(details)


def keep_previous_library(snapshot, previous):
    if snapshot.get('libraryStatus') != 'complete' and previous.get('libraryStatus') == 'complete':
        snapshot['library'] = previous['library']
        snapshot['libraryStatus'] = 'complete'
        snapshot['libraryUpdatedAt'] = previous['libraryUpdatedAt']
        snapshot['profileGameCount'] = snapshot['gameCount']
        snapshot['gameCount'] = len(previous['library'])
        warning('Complete library refresh unavailable; preserving its earlier libraryUpdatedAt timestamp.')


def read_key(env=None, path=None):
    env = os.environ if env is None else env
    value = env.get('STEAM_API_KEY', '').strip()
    if not value and not env.get('GITHUB_ACTIONS'):
        path = ROOT / '.env.steam.local' if path is None else path
        if path.exists():
            try:
                raw = path.read_text(encoding='utf-8-sig').strip()
            except (OSError, UnicodeError):
                raise SyncError('Could not read the specified local Steam key file.') from None
            match = re.fullmatch(r'STEAM_API_KEY=([a-fA-F0-9]{32})', raw)
            if not match:
                raise SyncError('The local Steam key file must contain one STEAM_API_KEY= line with a valid key.')
            value = match[1]
    if value and not re.fullmatch(r'[a-fA-F0-9]{32}', value):
        raise SyncError('STEAM_API_KEY has an invalid format.')
    return value or None


def restore_published(client, output):
    """Reuse the last deployment's validated cache on fresh CI checkouts."""
    try:
        published = validate_snapshot(json.loads(client.get(PUBLISHED_SNAPSHOT)))
        current = None
        try:
            current = validate_snapshot(json.loads(output.read_text(encoding='utf-8')))
        except (OSError, ValueError, KeyError, TypeError, SyncError):
            pass
        timestamp = lambda data: datetime.fromisoformat(data['updatedAt'].replace('Z', '+00:00'))
        if current and timestamp(published) <= timestamp(current):
            return False
        atomic_write(output, published)
        print('Restored the newer published Steam snapshot as the refresh cache.')
        return True
    except (SyncError, OSError, ValueError, KeyError, TypeError):
        warning('Published Steam cache unavailable or invalid; using the existing local snapshot.')
        return False


def enrich_extras(snapshot, previous, client):
    module_path = Path(__file__).with_name('steam-profile-extras.py')
    if not module_path.is_file():
        return
    try:
        spec = importlib.util.spec_from_file_location('steam_profile_extras', module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        module.enrich_profile(snapshot, client, warning, previous=previous)
    except PrivacyError:
        raise
    except (SyncError, KeyError, TypeError, ValueError, OSError):
        warning('Steam profile extras could not be refreshed; the game inventory is still available.')


def validate_snapshot(data):
    if (not isinstance(data, dict) or data.get('schemaVersion') != 1 or
            data.get('steamId') != STEAM_ID or data.get('profileUrl') != PROFILE_URL or
            data.get('source') not in ('public-profile', 'steam-api')):
        raise SyncError('Invalid Steam snapshot identity.')
    if not clean_text(data.get('displayName')):
        raise SyncError('Missing Steam name.')
    if data.get('avatarUrl') or data.get('visibility') != 'private':
        valid_url(data.get('avatarUrl'), IMAGE_HOSTS)
    datetime.fromisoformat(data['updatedAt'].replace('Z', '+00:00'))
    if data.get('libraryStatus', 'unavailable') not in ('complete', 'unavailable'):
        raise SyncError('Invalid library status.')
    if data.get('libraryStatus') == 'complete':
        if not isinstance(data.get('library'), list):
            raise SyncError('Complete library is missing.')
        datetime.fromisoformat(data['libraryUpdatedAt'].replace('Z', '+00:00'))
        app_ids = [number(game['appId']) for game in data['library']]
        if len(set(app_ids)) != len(app_ids) or number(data.get('gameCount')) != len(app_ids):
            raise SyncError('Complete library count does not match its unique game entries.')
    if data.get('gameCount') is not None:
        number(data['gameCount'])
    for field in ('games', 'library'):
        if field not in data and field == 'library':
            continue
        if not isinstance(data.get(field), list):
            raise SyncError('Invalid Steam games list.')
        for game in data[field]:
            app = number(game['appId'])
            if not app or not clean_text(game.get('name')):
                raise SyncError('Invalid Steam game.')
            valid_url(game.get('imageUrl'), IMAGE_HOSTS)
            if game.get('coverUrl'):
                valid_url(game['coverUrl'], IMAGE_HOSTS)
            if game.get('storeUrl') != f'https://store.steampowered.com/app/{app}/':
                raise SyncError('Unexpected Steam game URL.')
            if game.get('playtimeMinutes') is not None:
                number(game['playtimeMinutes'])
    return data


def warning(message):
    prefix = '::warning::' if os.environ.get('GITHUB_ACTIONS') else 'WARNING: '
    print(prefix + message, file=sys.stderr)


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=path.parent,
                                         prefix='.steam-', suffix='.tmp', delete=False) as handle:
            tmp = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.replace(tmp, path)
    finally:
        if tmp and tmp.exists():
            tmp.unlink()


def sync(client, output, require_refresh=False):
    previous = {}
    try:
        previous = validate_snapshot(json.loads(output.read_text(encoding='utf-8')))
    except (OSError, ValueError, KeyError, TypeError, SyncError):
        pass
    try:
        identity = parse_identity(client.get(PROFILE_URL + '?xml=1'))
        snapshot = parse_profile(client.get(PROFILE_URL + '?l=english'), identity)
        if client.key:
            try:
                snapshot = enrich_api(snapshot, client, warning)
            except PrivacyError:
                raise
            except (SyncError, KeyError, TypeError, ValueError):
                warning('Steam API sync was unavailable; using the verified public profile instead.')
        elif previous.get('libraryStatus') != 'complete':
            warning('Full Steam library unavailable: configure STEAM_API_KEY to retrieve the owned-game inventory.')
        keep_previous_library(snapshot, previous)
        enrich_store(snapshot, previous, client)
        enrich_extras(snapshot, previous, client)
        validate_snapshot(snapshot)
        atomic_write(output, snapshot)
        print(f'Steam snapshot refreshed ({snapshot["source"]}, {len(snapshot["games"])} recent games, '
              f'library {snapshot["libraryStatus"]}).')
        return 0
    except PrivacyError:
        redacted = {'schemaVersion': 1, 'steamId': STEAM_ID, 'profileUrl': PROFILE_URL,
                    'displayName': 'Steam', 'avatarUrl': '', 'gameCount': None,
                    'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
                    'source': 'public-profile', 'visibility': 'private', 'libraryStatus': 'unavailable', 'games': []}
        atomic_write(output, redacted)
        warning('Steam profile is private. Replaced the snapshot with a redacted record for the next deployment.')
        return 0
    except (SyncError, OSError, ValueError, KeyError, TypeError):
        try:
            validate_snapshot(json.loads(output.read_text(encoding='utf-8')))
        except (OSError, ValueError, KeyError, TypeError, SyncError):
            print('ERROR: Steam refresh failed and no valid existing snapshot is available.', file=sys.stderr)
            return 1
        warning('Steam refresh failed. Keeping the existing snapshot and its original update time.')
        return 1 if require_refresh else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--proxy', help='Optional HTTPS request proxy, e.g. http://127.0.0.1:7897')
    parser.add_argument('--require-refresh', action='store_true', help='Fail on a stale snapshot, preserving the currently deployed site.')
    parser.add_argument('--restore-published', action='store_true', help='Restore a newer validated snapshot from the existing public website before refreshing.')
    args = parser.parse_args(argv)
    try:
        client = Client(args.proxy, read_key())
        if args.restore_published:
            restore_published(client, args.output)
        return sync(client, args.output, args.require_refresh)
    except SyncError as error:
        parser.exit(1, f'ERROR: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
