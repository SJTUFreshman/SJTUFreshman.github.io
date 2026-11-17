"""Offline regression checks for Steam parsing, privacy, and failure behavior."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('steam_sync', Path(__file__).with_name('sync-steam-profile.py'))
steam = importlib.util.module_from_spec(spec)
spec.loader.exec_module(steam)

XML = f'''<?xml version="1.0"?><profile>
<steamID64>{steam.STEAM_ID}</steamID64><steamID><![CDATA[A & B]]></steamID>
<privacyState>public</privacyState>
<avatarFull>https://avatars.fastly.steamstatic.com/abc_full.jpg</avatarFull></profile>'''
HTML = f'''<html><script>g_rgProfileData = {{"steamid":"{steam.STEAM_ID}"}};</script>
<span class="actual_persona_name">A &amp; B</span>
<div><picture><source srcset="avatar.webp"></source><img src="avatar.jpg"></picture></div>
<a href="{steam.PROFILE_URL}games/?tab=all"><span class="profile_count_link_total">1,234</span></a>
<div class="recent_games"><div class="recent_game">
<div class="game_info_cap"><a href="https://steamcommunity.com/app/123">
<img class="game_capsule" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/123/header.jpg"></a></div>
<div class="game_info_details">2.8 hrs on record<br>last played on 15 Nov</div>
<div class="game_name"><a href="https://steamcommunity.com/app/123">A &amp; B: Game</a></div>
</div></div></html>'''


class FakeClient:
    key = None

    def __init__(self, xml=XML, html=HTML, fail=False):
        self.xml, self.html, self.fail = xml, html, fail

    def get(self, url):
        if self.fail:
            raise steam.SyncError('Network unavailable')
        return self.xml if '?xml=1' in url else self.html


class ApiClient(FakeClient):
    key = 'test-secret-never-print'

    def __init__(self, library=None, visibility=3):
        super().__init__()
        self.library, self.visibility = library, visibility

    def get(self, url):
        if 'games/' in url:
            return self.library or '<title>Sign In</title>'
        return super().get(url)

    def api(self, interface, method, **params):
        if method == 'GetPlayerSummaries':
            return {'response': {'players': [{'steamid': steam.STEAM_ID, 'communityvisibilitystate': self.visibility}]}}
        games = [{'appid': 123, 'name': 'Public game', 'playtime_forever': 9999},
                 {'appid': 456, 'name': 'Hidden game', 'playtime_forever': 9999}]
        return {'response': {'game_count': 2, 'games': games}}


class SteamTests(unittest.TestCase):
    def snapshot(self):
        return steam.parse_profile(HTML, steam.parse_identity(XML))

    def run_sync(self, client, path, **kwargs):
        output = StringIO()
        with redirect_stderr(output), redirect_stdout(output):
            status = steam.sync(client, path, **kwargs)
        self.assertNotIn('test-secret-never-print', output.getvalue())
        return status, output.getvalue()

    def test_recent_game_and_public_count(self):
        data = self.snapshot()
        self.assertEqual(data['displayName'], 'A & B')
        self.assertEqual(data['gameCount'], 1234)
        self.assertEqual(data['games'][0]['playtimeMinutes'], 168)
        self.assertEqual(data['games'][0]['name'], 'A & B: Game')
        self.assertNotIn('library', data)
        steam.validate_snapshot(data)

    def test_private_playtime_is_unknown_not_zero(self):
        data = steam.parse_profile(HTML.replace('2.8 hrs on record', ''), steam.parse_identity(XML))
        self.assertIsNone(data['games'][0]['playtimeMinutes'])

    def test_changed_detail_privacy_clears_recent_games(self):
        html = HTML[:HTML.index('<div class="recent_games">')] + '</html>'
        data = steam.parse_profile(html, steam.parse_identity(XML))
        self.assertEqual(data['games'], [])

    def test_untrusted_images_and_wrong_account_are_rejected(self):
        for html in (HTML.replace('shared.fastly.steamstatic.com', 'evil.example'),
                     HTML.replace(steam.STEAM_ID, '76561190000000000')):
            with self.assertRaises(steam.SyncError):
                steam.parse_profile(html, steam.parse_identity(XML))
        for url in ('javascript:alert(1)', 'https://shared.fastly.steamstatic.com.evil.example/a',
                    'https://user:pass@shared.fastly.steamstatic.com/a', 'http://steamcommunity.com/'):
            with self.assertRaises(steam.SyncError):
                steam.valid_url(url, steam.IMAGE_HOSTS)

    def test_xml_entities_and_wrong_account_are_rejected(self):
        for xml in (XML.replace(steam.STEAM_ID, '76561190000000000'),
                    '<!DOCTYPE x [<!ENTITY x "unsafe">]>' + XML):
            with self.assertRaises(steam.SyncError):
                steam.parse_identity(xml)

    def test_network_failure_preserves_bytes_and_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            steam.atomic_write(path, self.snapshot())
            original = path.read_bytes()
            result, log = self.run_sync(FakeClient(fail=True), path)
            self.assertEqual(result, 0)
            self.assertIn('warning', log.lower())
            self.assertEqual(path.read_bytes(), original)
            result, _ = self.run_sync(FakeClient(fail=True), path, require_refresh=True)
            self.assertEqual(result, 1)
            self.assertEqual(path.read_bytes(), original)

    def test_network_failure_without_snapshot_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            self.assertEqual(self.run_sync(FakeClient(fail=True), path)[0], 1)
            self.assertFalse(path.exists())

    def test_confirmed_private_profile_redacts_saved_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            steam.atomic_write(path, self.snapshot())
            self.assertEqual(self.run_sync(FakeClient(xml=XML.replace('public', 'private')), path)[0], 0)
            data = json.loads(path.read_text())
            self.assertEqual(data['visibility'], 'private')
            self.assertEqual(data['games'], [])
            self.assertEqual(data['avatarUrl'], '')
            self.assertIsNone(data['gameCount'])
            self.assertNotIn('library', data)
            steam.validate_snapshot(data)

    def test_authorized_owner_library_does_not_depend_on_login_only_webpage(self):
        logs = []
        data = steam.enrich_api(self.snapshot(), ApiClient(), logs.append)
        self.assertEqual(data['source'], 'steam-api')
        self.assertEqual(data['libraryStatus'], 'complete')
        self.assertEqual(len(data['library']), 2)
        self.assertEqual(data['libraryUpdatedAt'], data['updatedAt'])
        self.assertEqual(data['gameCount'], 2)

    def test_incomplete_library_response_is_not_marked_complete(self):
        class PartialClient(ApiClient):
            def api(self, interface, method, **params):
                data = super().api(interface, method, **params)
                if method == 'GetOwnedGames':
                    data['response']['game_count'] = 5
                return data
        with self.assertRaises(steam.SyncError):
            steam.enrich_api(self.snapshot(), PartialClient(), lambda _: None)

    def test_full_inventory_is_not_limited_to_three_and_exports_only_game_fields(self):
        class FullClient(ApiClient):
            def api(self, interface, method, **params):
                if method == 'GetOwnedGames':
                    return {'response': {'game_count': 81, 'games': [
                        {'appid': index + 1, 'name': f'Fixture game {index + 1}',
                         'playtime_forever': index, 'unrelated_private_field': 'must-not-export'}
                        for index in range(81)]}}
                return super().api(interface, method, **params)
        data = steam.enrich_api(self.snapshot(), FullClient(), lambda _: None)
        self.assertEqual(len(data['library']), 81)
        self.assertEqual(data['gameCount'], 81)
        self.assertNotIn('must-not-export', json.dumps(data))

    def test_store_metadata_uses_verified_cover_and_reuses_cache(self):
        class StoreClient:
            calls = 0
            def store_details(self, app):
                self.calls += 1
                return {'name': '测试游戏', 'header_image': 'https://shared.fastly.steamstatic.com/header.jpg'}
            def image_exists(self, url):
                return False
        client = StoreClient()
        data = self.snapshot()
        steam.enrich_store(data, {}, client)
        self.assertEqual(client.calls, 1)
        self.assertEqual(data['games'][0]['names']['zh-CN'], '测试游戏')
        self.assertNotIn('coverUrl', data['games'][0])
        newer = self.snapshot()
        steam.enrich_store(newer, data, client)
        self.assertEqual(client.calls, 1)
        self.assertEqual(newer['games'][0]['storeDetailsUpdatedAt'], data['games'][0]['storeDetailsUpdatedAt'])

    def test_complete_library_survives_missing_key_with_original_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            previous = steam.enrich_api(self.snapshot(), ApiClient(), lambda _: None)
            previous['libraryUpdatedAt'] = '2025-01-01T00:00:00Z'
            steam.atomic_write(path, previous)
            self.assertEqual(self.run_sync(FakeClient(), path)[0], 0)
            data = json.loads(path.read_text())
            for actual, expected in zip(data['library'], previous['library']):
                self.assertEqual({key: actual[key] for key in expected}, expected)
            self.assertEqual(len(data['library']), len(previous['library']))
            self.assertEqual(data['libraryUpdatedAt'], '2025-01-01T00:00:00Z')
            self.assertEqual(data['libraryStatus'], 'complete')

    def test_local_key_file_is_strict_and_environment_takes_priority(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.steam.local'
            path.write_text('STEAM_API_KEY=' + 'a' * 32)
            self.assertEqual(steam.read_key({}, path), 'a' * 32)
            self.assertEqual(steam.read_key({'STEAM_API_KEY': 'b' * 32}, path), 'b' * 32)
            self.assertIsNone(steam.read_key({'GITHUB_ACTIONS': 'true'}, path))
            path.write_text('STEAM_API_KEY=' + 'a' * 32 + '\nEXTRA=not-allowed')
            with self.assertRaises(steam.SyncError):
                steam.read_key({}, path)

    def test_published_cache_only_replaces_older_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            current = self.snapshot()
            current['updatedAt'] = '2025-01-01T00:00:00Z'
            steam.atomic_write(path, current)
            class PublishedClient:
                payload = dict(current, updatedAt='2025-01-02T00:00:00Z')
                def get(self, url):
                    self.requested_url = url
                    return json.dumps(self.payload)
            client = PublishedClient()
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertTrue(steam.restore_published(client, path))
                self.assertEqual(client.requested_url, steam.PUBLISHED_SNAPSHOT)
                restored = path.read_bytes()
                client.payload['updatedAt'] = '2024-01-01T00:00:00Z'
                self.assertFalse(steam.restore_published(client, path))
                self.assertEqual(path.read_bytes(), restored)
                client.payload = dict(current, steamId='76561190000000000')
                self.assertFalse(steam.restore_published(client, path))
                self.assertEqual(path.read_bytes(), restored)

    def test_successful_strict_refresh_writes_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            self.assertEqual(self.run_sync(FakeClient(), path, require_refresh=True)[0], 0)
            steam.validate_snapshot(json.loads(path.read_text()))


if __name__ == '__main__':
    unittest.main()
