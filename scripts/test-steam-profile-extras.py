"""Offline regression coverage for public Steam extras and achievement caching."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
from threading import Lock
import time
import unittest


SPEC = importlib.util.spec_from_file_location('steam_extras', Path(__file__).with_name('steam-profile-extras.py'))
extras = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extras)
STEAM_ID = '76561199195301474'
PROFILE = f'https://steamcommunity.com/profiles/{STEAM_ID}/'
IMAGE = 'https://community.fastly.steamstatic.com/public/images/badges/test.png'
PROFILE_HTML = f'''<a href="{PROFILE}">Profile</a>
<div class="profile_header_badgeinfo"><span class="friendPlayerLevelNum">12</span></div>
<div class="friendPlayerLevelNum">99</div>
<div class="profile_page" style="background-image: url('https://shared.fastly.steamstatic.com/community_assets/images/items/1/background.jpg')"></div>
<div class="profile_badges"><span class="profile_count_link_total">1</span><div class="profile_badges_badge" data-tooltip-html="Public badge&lt;br&gt;Level 2 Badge"><a href="{PROFILE}badges/2"><img src="{IMAGE}"></a></div></div>'''
BADGES_HTML = f'''<div class="badge_row"><a class="badge_row_overlay" href="{PROFILE}badges/2"></a>
<img class="badge_icon" src="trans.gif" data-delayed-image="{IMAGE}">
<div class="badge_info_description"><div class="badge_info_title">Public badge</div><div>Level 2, 200 XP</div></div></div>
<div class="badge_row"><span class="badge_title">An unearned badge</span></div>'''


def schema():
    return {'game': {'availableGameStats': {'achievements': [
        {'name': 'A', 'displayName': 'First', 'description': 'Complete chapter one.', 'icon': IMAGE, 'icongray': IMAGE},
        {'name': 'B', 'displayName': 'Second', 'description': 'Complete chapter two.', 'icon': 'javascript:alert(1)'},
    ]}}}


def player():
    return {'playerstats': {'success': True, 'steamID': STEAM_ID,
                           'achievements': [{'apiname': 'A', 'achieved': 1, 'unlocktime': 1700000000},
                                            {'apiname': 'B', 'achieved': 0, 'unlocktime': 0}]}}


def queries(app_id=42):
    return [
        {'queryKey': ['achievements', app_id, 'user_achievements', STEAM_ID], 'state': {'data': {
            'appid': app_id, 'steamid': STEAM_ID, 'achievements': {'1': {'unlocked': True, 'unlock_time': 1700000000}}}}},
        {'queryKey': ['achievements', app_id, 'schema_v2'], 'state': {'data': {'appid': app_id, 'groups': [
            {'ispublic': True, 'achievements': [
                {'internal_key': 1, 'api_name': 'FIRST', 'name': 'First', 'description': 'One', 'icon_achieved': 'first.jpg'},
                {'internal_key': 2, 'api_name': 'SECOND', 'name': 'Second', 'description': 'Two', 'icon_unachieved': 'second.jpg'},
            ]}, {'developeronly': True, 'achievements': [{'internal_key': 9, 'name': 'Developer'}]}]}}},
        {'queryKey': ['ProfileItemsEquipped', STEAM_ID], 'state': {'data': {'mini_profile_background': {
            'movie_mp4': 'items/1/universe.mp4', 'image_large': 'items/1/universe.jpg', 'item_title': 'UNIVERSE'}}}},
    ]


def ssr_page():
    return '<script id="valve-ssr-data" type="application/json">' + json.dumps({
        'route': '/profiles/:steamid/achievements/:appid',
        'renderContext': {'queryData': json.dumps({'queries': queries()})}}) + '</script>'


class Client:
    def __init__(self, key=True):
        self.key = key
        self.calls = []
        self.active = self.maximum_active = 0
        self.lock = Lock()

    def get(self, url):
        self.calls.append(('get', url))
        if 'badges/' in url:
            return BADGES_HTML
        if 'achievements/' in url:
            return ssr_page()
        return PROFILE_HTML

    def api(self, interface, method, **params):
        self.calls.append((method, params))
        if method == 'GetSchemaForGame':
            assert params['version'] == 2
            return schema()
        return player()


def snapshot(ids=(42,)):
    return {'steamId': STEAM_ID, 'games': [{'appId': ids[0]}],
            'library': [{'appId': app_id} for app_id in ids]}


class ExtrasTests(unittest.TestCase):
    def test_profile_and_badges_use_own_level_and_delayed_art(self):
        result = extras.parse_profile(PROFILE_HTML, STEAM_ID)
        self.assertEqual(result['level'], 12)
        self.assertEqual(result['badges'][0]['level'], 2)
        self.assertEqual(result['background']['source'], 'profile')
        badges = extras.parse_badges(BADGES_HTML, STEAM_ID)
        self.assertEqual(len(badges), 1)
        self.assertEqual(badges[0]['imageUrl'], IMAGE)
        self.assertEqual(badges[0]['xp'], 200)

    def test_api_unlocks_and_images(self):
        result = extras.from_api(schema(), player(), 42, STEAM_ID)
        self.assertEqual((result['status'], result['unlocked'], result['total']), ('available', 1, 2))
        self.assertEqual(result['items'][0]['unlockedAt'], 1700000000)
        self.assertNotIn('iconUrl', result['items'][1])
        wrong_user = player()
        wrong_user['playerstats']['steamID'] = '76561190000000000'
        self.assertEqual(extras.from_api(schema(), wrong_user, 42, STEAM_ID)['status'], 'unavailable')

    def test_none_needs_explicit_evidence(self):
        self.assertEqual(extras.from_api({}, {}, 42, STEAM_ID)['status'], 'unavailable')
        empty = {'game': {'availableGameStats': {'achievements': []}}}
        self.assertEqual(extras.from_api(empty, {}, 42, STEAM_ID)['status'], 'none')

    def test_public_ssr_uses_expected_user_and_ignores_developer_group(self):
        parsed = extras.ssr_queries(ssr_page())
        result = extras.from_public_queries(parsed, 42, STEAM_ID)
        self.assertEqual((result['unlocked'], result['total']), (1, 2))
        self.assertEqual(extras.from_public_queries(parsed, 43, STEAM_ID)['status'], 'unavailable')
        background = extras.equipped_background(parsed, STEAM_ID)
        self.assertEqual(background['source'], 'mini-profile')
        self.assertTrue(background['videoUrl'].endswith('/universe.mp4'))

    def test_fresh_cache_avoids_api_and_expired_cache_refreshes(self):
        cached = extras.from_api(schema(), player(), 42, STEAM_ID)
        previous = snapshot()
        previous['library'][0]['achievements'] = cached
        client = Client()
        result = extras.enrich_profile(snapshot(), client, lambda _: None, previous)
        self.assertEqual(result['library'][0]['achievements'], cached)
        self.assertFalse(any(call[0].startswith('Get') for call in client.calls))
        previous['library'][0]['achievements']['updatedAt'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        client = Client()
        extras.enrich_profile(snapshot(), client, lambda _: None, previous)
        self.assertTrue(any(call[0] == 'GetPlayerAchievements' for call in client.calls))

    def test_recent_games_work_without_key(self):
        result = extras.enrich_profile(snapshot(), Client(key=False), lambda _: None)
        self.assertEqual(result['games'][0]['achievements']['status'], 'available')
        self.assertEqual(result['profileExtras']['background']['name'], 'UNIVERSE')

    def test_missing_api_schema_uses_explicit_public_empty_groups(self):
        class NoAchievements(Client):
            def api(self, interface, method, **params):
                return {'game': {}}

            def get(self, url):
                if 'achievements/' not in url:
                    return super().get(url)
                data = queries()
                data[0]['state']['data']['achievements'] = {}
                data[1]['state']['data']['groups'] = []
                return '<script id="valve-ssr-data">' + json.dumps({
                    'route': '/profiles/:steamid/achievements/:appid',
                    'renderContext': {'queryData': json.dumps({'queries': data})}}) + '</script>'
        result = extras.enrich_profile(snapshot(), NoAchievements(), lambda _: None)
        self.assertEqual(result['library'][0]['achievements']['status'], 'none')

    def test_expired_cache_survives_transient_failure_without_new_date(self):
        class Failed(Client):
            def get(self, url):
                raise RuntimeError('Could not read Steam over HTTPS.')

            def api(self, interface, method, **params):
                raise RuntimeError('Steam returned HTTP 429.')
        previous = snapshot()
        cached = extras.from_api(schema(), player(), 42, STEAM_ID)
        cached['updatedAt'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        previous['library'][0]['achievements'] = cached
        previous['profileExtras'] = {'level': 12, 'badges': [], 'background': {}, 'updatedAt': cached['updatedAt']}
        result = extras.enrich_profile(snapshot(), Failed(), lambda _: None, previous)
        achievement = result['library'][0]['achievements']
        self.assertEqual(achievement['status'], 'available')
        self.assertEqual(achievement['updatedAt'], cached['updatedAt'])
        self.assertTrue(achievement['stale'])
        self.assertEqual(result['profileExtras']['updatedAt'], cached['updatedAt'])
        self.assertTrue(result['profileExtras']['stale'])

    def test_expired_library_cache_survives_no_key(self):
        previous = snapshot((42, 43))
        cached = extras.from_api(schema(), player(), 43, STEAM_ID)
        cached['updatedAt'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        previous['library'][1]['achievements'] = cached
        result = extras.enrich_profile(snapshot((42, 43)), Client(key=False), lambda _: None, previous)
        self.assertEqual(result['library'][1]['achievements']['items'], cached['items'])
        self.assertTrue(result['library'][1]['achievements']['stale'])

    def test_private_achievement_response_does_not_restore_old_cache(self):
        class Private(Client):
            def api(self, interface, method, **params):
                if method == 'GetSchemaForGame':
                    return schema()
                return {'playerstats': {'success': False, 'error': 'Profile is not public'}}
        previous = snapshot()
        cached = extras.from_api(schema(), player(), 42, STEAM_ID)
        cached['updatedAt'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        previous['library'][0]['achievements'] = cached
        result = extras.enrich_profile(snapshot(), Private(), lambda _: None, previous)
        self.assertEqual(result['library'][0]['achievements']['status'], 'unavailable')
        self.assertEqual(result['library'][0]['achievements']['items'], [])

    def test_429_stops_queue_and_keeps_library(self):
        class Limited(Client):
            def api(self, interface, method, **params):
                with self.lock:
                    self.active += 1
                    self.maximum_active = max(self.maximum_active, self.active)
                time.sleep(0.01)
                with self.lock:
                    self.active -= 1
                self.calls.append((method, params))
                raise RuntimeError('Steam returned HTTP 429.')
        client, warnings = Limited(), []
        result = extras.enrich_profile(snapshot(tuple(range(42, 62))), client, warnings.append)
        self.assertEqual(len(result['library']), 20)
        self.assertLessEqual(client.maximum_active, 3)
        self.assertLessEqual(sum(call[0] == 'GetSchemaForGame' for call in client.calls), 3)
        self.assertTrue(all(game['achievements']['status'] == 'unavailable' for game in result['library']))
        self.assertTrue(warnings)

    def test_private_snapshot_never_requests_extras(self):
        client = Client()
        value = snapshot()
        value.update(visibility='private', profileExtras={'level': 12})
        extras.enrich_profile(value, client, lambda _: None)
        self.assertEqual(client.calls, [])
        self.assertNotIn('profileExtras', value)

    def test_url_origin_and_identity_filters(self):
        self.assertIsNone(extras.asset_url('https://steamstatic.com.evil.invalid/a.png'))
        self.assertIsNone(extras.asset_url('https://user:password@steamstatic.com/a.png'))
        self.assertIsNone(extras.asset_url('https://steamstatic.com:bad/a.png'))
        self.assertIsNone(extras.public_profile_url(PROFILE + '../other', '76561190000000000'))


if __name__ == '__main__':
    unittest.main()
