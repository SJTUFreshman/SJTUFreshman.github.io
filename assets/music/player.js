(() => {
    'use strict';

    const storageKey = 'runde:music:v1';
    const root = window.SiteMusicHost.root;
    const audio = document.getElementById('siteAudio');
    const player = document.getElementById('siteMusic');
    const element = name => document.getElementById(`music${name}`);
    const panel = element('Panel');
    const toggle = element('Toggle');
    const seek = element('Seek');
    const singer = element('Singer');
    const search = element('Search');
    const trackList = element('Tracks');
    const status = element('Status');
    const playButtons = [element('Play'), element('QuickPlay')];
    const modes = ['all', 'one', 'shuffle'];
    const modeLabels = { all: '列表循环', one: '单曲循环', shuffle: '随机播放' };
    let library = { artists: [], tracks: [] };
    let current = null;
    let mode = 'all';
    let pendingSeek = 0;
    let lastSave = 0;
    let playbackRequest = 0;
    let seeking = false;
    let previousTracks = [];
    let saved = null;

    try {
        saved = JSON.parse(sessionStorage.getItem(storageKey));
    } catch (error) {
        saved = null;
    }
    if (!saved || typeof saved !== 'object' || saved.version !== 1) saved = {};
    mode = modes.includes(saved.mode) ? saved.mode : 'all';
    audio.volume = Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.7;
    audio.muted = saved.muted === true;

    function setIcon(container, name) {
        let icon = container.querySelector('svg');
        if (!icon) {
            icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.classList.add('music-glyph');
            icon.setAttribute('aria-hidden', 'true');
            container.replaceChildren(icon);
        }
        if (icon.dataset.icon === name) return;
        const symbol = document.getElementById(`music-icon-${name}`);
        icon.setAttribute('viewBox', symbol.getAttribute('viewBox'));
        icon.replaceChildren(...Array.from(symbol.children, child => child.cloneNode(true)));
        icon.dataset.icon = name;
    }

    function updateRange(input) {
        const maximum = Number(input.max) || 1;
        input.style.setProperty('--music-fill', `${Math.max(0, Math.min(100, Number(input.value) / maximum * 100))}%`);
    }

    function timeLabel(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    function artistName(track) {
        return library.artists.find(artist => artist.id === track.artistId)?.name || '';
    }

    function duration() {
        return Number.isFinite(audio.duration) ? audio.duration : current?.duration || 0;
    }

    function message(text) {
        status.textContent = text;
        status.hidden = !text;
    }

    function save() {
        if (!current) return;
        try {
            sessionStorage.setItem(storageKey, JSON.stringify({
                version: 1, trackId: current.id, time: pendingSeek || audio.currentTime,
                playing: !audio.paused, volume: audio.volume, muted: audio.muted, mode
            }));
        } catch (error) {
            return;
        }
    }

    function updatePosition() {
        const length = duration();
        const position = pendingSeek || audio.currentTime;
        if (!seeking) {
            seek.max = length;
            seek.value = Math.min(position, length);
            updateRange(seek);
            element('Time').textContent = timeLabel(position);
            seek.setAttribute('aria-valuetext', `${timeLabel(position)} / ${timeLabel(length)}`);
        }
        element('Duration').textContent = timeLabel(length);
        if (navigator.mediaSession?.setPositionState && length > 0) {
            try {
                navigator.mediaSession.setPositionState({ duration: length, position: Math.min(position, length), playbackRate: 1 });
            } catch (error) {
                return;
            }
        }
    }

    function updatePlayback() {
        const playing = !audio.paused;
        player.dataset.playing = String(playing);
        element('PlaybackStatus').textContent = playing ? '正在播放' : audio.currentTime > 0 || pendingSeek > 0 ? '已暂停' : '等待播放';
        playButtons.forEach(button => {
            setIcon(button, playing ? 'pause' : 'play');
            button.setAttribute('aria-label', playing ? '暂停' : '播放');
            button.title = playing ? '暂停' : '播放';
        });
        trackList.querySelectorAll('button[data-track-id]').forEach(button => {
            const active = button.dataset.trackId === current?.id;
            if (active) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
            const number = button.querySelector('.music-track-number');
            if (active) setIcon(number, playing ? 'pause' : 'play');
            else number.textContent = button.dataset.number;
        });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        save();
    }

    function renderVolume() {
        element('Volume').value = audio.volume;
        updateRange(element('Volume'));
        element('VolumeValue').textContent = audio.muted ? '0%' : `${Math.round(audio.volume * 100)}%`;
        setIcon(element('Mute'), audio.muted ? 'muted' : 'volume');
        element('Mute').setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
        element('Mute').title = audio.muted ? '取消静音' : '静音';
        element('Mute').setAttribute('aria-pressed', String(audio.muted));
    }

    function renderMode() {
        element('Mode').dataset.mode = mode;
        setIcon(element('Mode'), mode === 'shuffle' ? 'shuffle' : 'repeat');
        element('Mode').title = modeLabels[mode];
        element('Mode').setAttribute('aria-label', `播放模式：${modeLabels[mode]}，点击切换`);
    }

    function renderTracks() {
        const query = search.value.trim().toLocaleLowerCase();
        const collection = library.tracks.filter(track => track.artistId === singer.value);
        const matching = collection.filter(track => [track.title, track.originalArtist, track.note, artistName(track)].join(' ').toLocaleLowerCase().includes(query));
        element('Count').textContent = `${collection.length} 首`;
        element('Empty').hidden = matching.length > 0;
        trackList.replaceChildren(...matching.map(track => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'music-track';
            button.dataset.trackId = track.id;
            button.dataset.number = String(collection.indexOf(track) + 1).padStart(2, '0');
            button.setAttribute('aria-label', `播放 ${track.title} · ${artistName(track)}`);
            const number = document.createElement('span');
            number.className = 'music-track-number';
            number.textContent = button.dataset.number;
            number.setAttribute('aria-hidden', 'true');
            const copy = document.createElement('span');
            copy.className = 'music-track-copy';
            const title = document.createElement('span');
            title.className = 'music-track-title';
            title.textContent = track.title;
            const subtitle = document.createElement('span');
            subtitle.className = 'music-track-subtitle';
            subtitle.textContent = [track.date, track.originalArtist ? `cover ${track.originalArtist}` : track.note].filter(Boolean).join(' · ');
            copy.append(title, subtitle);
            const length = document.createElement('span');
            length.className = 'music-track-duration';
            length.textContent = timeLabel(track.duration);
            button.append(number, copy, length);
            item.append(button);
            return item;
        }));
        updatePlayback();
    }

    async function play() {
        if (!current) return;
        const request = ++playbackRequest;
        message('');
        try {
            if (audio.error) {
                pendingSeek = pendingSeek || audio.currentTime;
                audio.load();
            }
            await audio.play();
        } catch (error) {
            if (request !== playbackRequest || error.name === 'AbortError') return;
            message(error.name === 'NotAllowedError' ? '点击播放，继续听上次那首歌。' : '这首歌暂时无法播放，可以重试或切换下一首。');
            updatePlayback();
        }
    }

    function pause() {
        playbackRequest += 1;
        audio.pause();
        updatePlayback();
    }

    function selectTrack(track, shouldPlay = false, position = 0) {
        if (!track) return;
        pause();
        current = track;
        pendingSeek = Math.max(0, Math.min(Number(position) || 0, Math.max(0, track.duration - 0.05)));
        audio.src = new URL(track.src, root).href;
        element('Artist').textContent = artistName(track);
        element('Title').textContent = track.title;
        element('Note').textContent = [track.originalArtist ? `cover ${track.originalArtist}` : '', track.note].filter(Boolean).join(' · ') || track.date;
        element('DockTitle').textContent = track.title;
        element('DockArtist').textContent = artistName(track);
        toggle.title = `${track.title} · ${artistName(track)}`;
        element('Source').href = track.source;
        element('Source').hidden = !track.source;
        seek.disabled = false;
        playButtons.forEach(button => { button.disabled = false; });
        message('');
        if ('mediaSession' in navigator && 'MediaMetadata' in window) {
            navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: artistName(track), album: '随身听' });
        }
        updatePosition();
        updatePlayback();
        if (shouldPlay) play();
    }

    function skip(direction, shouldPlay = !audio.paused) {
        if (!current) return;
        const collection = library.tracks.filter(track => track.artistId === current.artistId);
        let nextTrack;
        if (mode === 'shuffle') {
            if (direction < 0 && previousTracks.length) nextTrack = library.tracks.find(track => track.id === previousTracks.pop());
            if (!nextTrack) {
                const candidates = collection.filter(track => track.id !== current.id);
                nextTrack = candidates[Math.floor(Math.random() * candidates.length)] || current;
            }
            if (direction > 0) previousTracks.push(current.id);
        } else {
            nextTrack = collection[(collection.indexOf(current) + direction + collection.length) % collection.length];
        }
        selectTrack(nextTrack, shouldPlay);
    }

    function seekTo(position) {
        if (!current) return;
        const next = Math.max(0, Math.min(position, duration()));
        if (audio.readyState >= 1) {
            pendingSeek = 0;
            audio.currentTime = next;
        } else {
            pendingSeek = next;
        }
        updatePosition();
        save();
    }

    function previous() {
        if (audio.currentTime > 3) seekTo(0);
        else skip(-1);
    }

    function setOpen(open, restoreFocus = false) {
        panel.hidden = !open;
        player.dataset.open = String(open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? '收起音乐播放器' : '打开音乐播放器');
        if (open) element('Close').focus({ preventScroll: true });
        else if (restoreFocus) toggle.focus({ preventScroll: true });
    }

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    element('Close').addEventListener('click', () => setOpen(false, true));
    window.addEventListener('music:outside', () => setOpen(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            setOpen(false, true);
        }
    });
    playButtons.forEach(button => button.addEventListener('click', () => audio.paused ? play() : pause()));
    element('Previous').addEventListener('click', previous);
    element('Next').addEventListener('click', () => skip(1));
    element('Mode').addEventListener('click', () => {
        mode = modes[(modes.indexOf(mode) + 1) % modes.length];
        previousTracks = [];
        renderMode();
        save();
    });
    element('Mute').addEventListener('click', () => { audio.muted = !audio.muted; });
    element('Volume').addEventListener('input', event => {
        audio.volume = Number(event.target.value);
        audio.muted = false;
    });
    seek.addEventListener('input', () => {
        seeking = true;
        updateRange(seek);
        element('Time').textContent = timeLabel(seek.value);
    });
    seek.addEventListener('change', () => {
        seeking = false;
        seekTo(Number(seek.value));
    });
    singer.addEventListener('change', renderTracks);
    search.addEventListener('input', renderTracks);
    trackList.addEventListener('click', event => {
        const button = event.target.closest('button[data-track-id]');
        if (!button) return;
        const track = library.tracks.find(entry => entry.id === button.dataset.trackId);
        if (track === current) audio.paused ? play() : pause();
        else selectTrack(track, true);
    });
    audio.addEventListener('loadedmetadata', () => {
        if (pendingSeek) {
            audio.currentTime = Math.min(pendingSeek, duration());
            pendingSeek = 0;
        }
        updatePosition();
    });
    audio.addEventListener('timeupdate', () => {
        updatePosition();
        if (Date.now() - lastSave > 1000) {
            save();
            lastSave = Date.now();
        }
    });
    audio.addEventListener('play', updatePlayback);
    audio.addEventListener('pause', updatePlayback);
    audio.addEventListener('playing', () => { message(''); updatePlayback(); });
    audio.addEventListener('waiting', () => { if (!audio.paused) message('正在缓冲…'); });
    audio.addEventListener('error', () => {
        message('音频暂时无法载入，请重试或切换下一首。');
        updatePlayback();
    });
    audio.addEventListener('volumechange', () => { renderVolume(); save(); });
    audio.addEventListener('ended', () => {
        if (mode === 'one') { seekTo(0); play(); }
        else skip(1, true);
    });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

    if ('mediaSession' in navigator) {
        const actions = {
            play, pause, previoustrack: previous, nexttrack: () => skip(1, true),
            seekto: details => seekTo(details.seekTime),
            seekbackward: details => seekTo(audio.currentTime - (details.seekOffset || 10)),
            seekforward: details => seekTo(audio.currentTime + (details.seekOffset || 10))
        };
        Object.entries(actions).forEach(([action, handler]) => {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch (error) { return; }
        });
    }

    document.querySelectorAll('.music-glyph use').forEach(reference => {
        setIcon(reference.parentElement.parentElement, reference.getAttribute('href').replace('#music-icon-', ''));
    });
    renderMode();
    renderVolume();
    fetch(new URL('assets/music/library.json', root))
        .then(response => {
            if (!response.ok) throw new Error(`Music library: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.version !== 1 || !data.artists?.length || !data.tracks?.length) throw new Error('Music library is empty');
            library = data;
            const initial = library.tracks.find(track => track.id === saved.trackId) || library.tracks[0];
            singer.replaceChildren(...library.artists.map(artist => new Option(artist.name, artist.id)));
            singer.value = initial.artistId;
            renderTracks();
            selectTrack(initial, false, saved.trackId === initial.id ? saved.time : 0);
            if (saved.playing) play();
        })
        .catch(() => {
            element('Title').textContent = '歌单暂时无法载入';
            message('请刷新页面后重试。');
        });
})();
