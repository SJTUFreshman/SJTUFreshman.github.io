'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const [sourceDirectory, artistId = 'zhang-qiran', artistName = '张祺然', selectionFile = path.join(__dirname, 'music-selection.json')] = process.argv.slice(2);
if (!sourceDirectory || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artistId)) {
    throw new Error('Usage: node scripts/import-music.cjs <video-folder> [artist-id] [artist-name] [selection.json]');
}
const selection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
const libraryFile = path.join(root, 'assets/music/library.json');
const library = fs.existsSync(libraryFile)
    ? JSON.parse(fs.readFileSync(libraryFile, 'utf8'))
    : { version: 1, artists: [], tracks: [] };
const files = fs.readdirSync(sourceDirectory).filter(filename => /\.(mp4|mov|mkv|webm)$/i.test(filename));
const tracks = [];
const discovered = new Set();

function probe(filename) {
    const result = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,duration',
        '-of', 'json', filename
    ], { encoding: 'utf8', windowsHide: true }));
    if (!result.streams?.length) throw new Error(`No audio stream: ${filename}`);
    return result.streams[0];
}

for (const filename of files) {
    const videoId = filename.match(/\[(BV[A-Za-z0-9]+)\]/)?.[1];
    if (selection.excluded?.[videoId]) continue;
    const metadata = selection.tracks[videoId];
    if (!metadata) throw new Error(`Review this video in the selection file before importing: ${filename}`);
    if (discovered.has(videoId)) throw new Error(`Duplicate video ID: ${videoId}`);
    discovered.add(videoId);
    const source = path.resolve(sourceDirectory, filename);
    const sourceAudio = probe(source);
    const relative = `assets/music/${artistId}/${videoId}.m4a`;
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const codec = sourceAudio.codec_name === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];
    execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn',
        ...codec, '-map_metadata', '-1', '-metadata', `title=${metadata.title}`,
        '-metadata', `artist=${artistName}`, '-movflags', '+faststart', destination
    ], { windowsHide: true });
    const duration = Number(probe(destination).duration);
    if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - Number(sourceAudio.duration)) > 0.15) {
        throw new Error(`Extracted duration does not match: ${filename}`);
    }
    if (fs.statSync(destination).size > 25 * 1024 * 1024) throw new Error(`Track exceeds the hosting limit: ${relative}`);
    tracks.push({
        id: `${artistId}-${videoId}`, artistId, ...metadata,
        date: filename.slice(0, 10), duration: Math.round(duration * 1000) / 1000,
        src: relative, source: `https://www.bilibili.com/video/${videoId}/`, sourceTitle: filename.replace(/_\[BV.*$/, '').slice(20)
    });
    console.log(`${metadata.title}: ${Math.round(duration)}s`);
}
for (const videoId of Object.keys(selection.tracks)) {
    if (!discovered.has(videoId)) throw new Error(`Selected video is missing: ${videoId}`);
}
library.artists = [...library.artists.filter(artist => artist.id !== artistId), { id: artistId, name: artistName }];
library.tracks = [...library.tracks.filter(track => track.artistId !== artistId), ...tracks.sort((left, right) => right.date.localeCompare(left.date))];
fs.writeFileSync(libraryFile, JSON.stringify(library, null, 2) + '\n');
console.log(`Imported ${tracks.length} tracks by ${artistName}. Original videos were not modified.`);
