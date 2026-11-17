"""Games rendering checks, including preservation of other authored sections."""
import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import site_renderer as renderer


class GamesRenderingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.content = renderer.load_content(ROOT)
        self.snapshot = {
            'schemaVersion': 1, 'steamId': '76561199195301474',
            'profileUrl': 'https://steamcommunity.com/profiles/76561199195301474/',
            'displayName': 'Test Player', 'avatarUrl': 'https://avatars.steamstatic.com/avatar.jpg',
            'gameCount': 4, 'source': 'public-profile', 'updatedAt': '2026-11-16T00:00:00Z',
            'games': [{'appId': 570, 'name': 'Test game', 'imageUrl': 'https://shared.steamstatic.com/game.jpg', 'playtimeMinutes': 168}],
        }
        for name in ('life.html', 'observatory.html', 'assets/life/scripts/01-content-data.js'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text((ROOT / name).read_text(encoding='utf-8'), encoding='utf-8')
        self.save_snapshot()

    def save_snapshot(self):
        path = self.root / 'assets/life/games/steam-profile.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.snapshot), encoding='utf-8')

    def render(self):
        return renderer.render_life_games(self.content, self.root)

    def test_public_snapshot_scope(self):
        html = self.render()
        self.assertIn('Test Player', html)
        self.assertEqual(html.count('class="game-case"'), len(self.snapshot['games']))
        self.assertIn('data-library-complete="false"', html)
        self.assertNotIn('<iframe', html)
        self.assertNotIn('class="games-library"', html)

    def test_scheduled_render_preserves_other_content(self):
        page = self.root / 'life.html'
        before = page.read_text(encoding='utf-8')
        original_i18n = (self.root / 'assets/life/scripts/01-content-data.js').read_text(encoding='utf-8')
        self.snapshot['displayName'] = 'A new display name'
        self.save_snapshot()
        artifacts = renderer.render_games_updates(self.root, self.content)
        after = artifacts[page]
        pattern = r'<!-- SITEGEN:LIFE_GAMES_START -->.*?<!-- SITEGEN:LIFE_GAMES_END -->'
        self.assertEqual(re.sub(pattern, '', before, flags=re.S), re.sub(pattern, '', after, flags=re.S))
        self.assertEqual(original_i18n, artifacts[self.root / 'assets/life/scripts/01-content-data.js'])
        self.assertEqual(artifacts[self.root / 'observatory.html'], renderer.render_observatory(after))
        self.assertEqual(artifacts, renderer.render_games_updates(self.root, self.content, write=False))

    def test_steam_text_is_escaped_and_image_origins_restricted(self):
        self.snapshot['displayName'] = '<img src=x onerror=alert(1)>'
        self.snapshot['games'][0]['name'] = '<script>alert(1)</script>'
        self.snapshot['games'][0]['imageUrl'] = 'https://evil.example/track.png'
        self.save_snapshot()
        html = self.render()
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('<script>', html)
        self.assertNotIn('evil.example', html)

    def test_wrong_account_rejected(self):
        self.snapshot['steamId'] = '76561190000000000'
        self.save_snapshot()
        with self.assertRaises(ValueError):
            self.render()

    def test_private_and_hidden_playtimes(self):
        self.snapshot['games'][0]['playtimeMinutes'] = None
        self.save_snapshot()
        self.assertIn('Playtime not shared', self.render())
        self.snapshot.update(displayName='Steam', avatarUrl='', gameCount=None, games=[], visibility='private')
        self.snapshot.pop('library', None)
        self.save_snapshot()
        html = self.render()
        self.assertIn('currently private', html)
        self.assertNotIn('Test Player', html)
        self.assertNotIn('class="game-case"', html)

    def test_complete_library_is_not_truncated_and_includes_achievements(self):
        self.snapshot['libraryStatus'] = 'complete'
        self.snapshot['library'] = [dict(self.snapshot['games'][0], appId=1000+i) for i in range(81)]
        self.snapshot['library'][0]['achievements'] = {
            'status':'available','unlocked':1,'total':2,
            'items':[{'name':'First step','description':'An achievement.','unlocked':True},
                     {'name':'Next step','description':'Still locked.','unlocked':False}],
        }
        self.snapshot['profileExtras'] = {'level':12,'badges':[{'name':'A badge','imageUrl':'https://shared.steamstatic.com/badge.png'}],
            'background':{'videoUrl':'https://shared.steamstatic.com/background.mp4','posterUrl':'https://shared.steamstatic.com/background.jpg'}}
        self.save_snapshot()
        html = self.render()
        self.assertEqual(html.count('class="game-case"'), 81)
        self.assertIn('data-library-complete="true"', html)
        self.assertIn('id="gameDetail-1080"', html)
        self.assertIn('is-unlocked', html)
        self.assertIn('is-locked', html)
        self.assertIn('A badge', html)
        self.assertIn('data-games-background muted loop playsinline', html)
        self.assertNotIn('autoplay', html)

    def test_notes_screenshots_and_duplicate_ids(self):
        entry = {'id':'first-note','title':{'en':'First note'},'text':{'en':'A real note.'},'image':'images/games/scene.png'}
        self.content['life']['games']['entries'] = [entry]
        with self.assertRaises(ValueError):
            self.render()
        image = self.root / 'images/games/scene.png'
        image.parent.mkdir(parents=True)
        image.write_bytes(b'fixture')
        self.assertIn('openLightbox(this)', self.render())
        self.content['life']['games']['entries'].append(copy.deepcopy(entry))
        with self.assertRaises(ValueError):
            self.render()


if __name__ == '__main__':
    unittest.main()
