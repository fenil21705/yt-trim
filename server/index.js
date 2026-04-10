const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

const ffmpegStatic = require('ffmpeg-static');
const isWin = process.platform === 'win32';
const ytdlpPath = isWin
    ? path.join(__dirname, '..', 'bin', 'yt-dlp.exe')
    : path.join(__dirname, '..', 'bin', 'yt-dlp');

// Ensure Linux binary is executable (for Render)
if (!isWin) {
    try { require('fs').chmodSync(ytdlpPath, '755'); } catch(e) {}
}

// Helper: find output file (yt-dlp may add suffixes)
function findOutputFile(basePath) {
    const dir = path.dirname(basePath);
    const baseName = path.basename(basePath, '.mp4');
    const files = fs.readdirSync(dir);
    // Look for exact match first
    if (fs.existsSync(basePath)) return basePath;
    // Look for files starting with the base name
    const match = files.find(f => f.startsWith(baseName) && f.endsWith('.mp4'));
    if (match) return path.join(dir, match);
    return null;
}

// 1. Fetch Video Info
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    execFile(ytdlpPath, [
        url, '--print', 'duration', '--print', 'title', '--no-playlist', '--no-warnings'
    ], { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('Info Error:', error.message);
            return res.status(500).json({ error: 'Could not fetch video info' });
        }
        const lines = stdout.trim().split('\n').map(l => l.trim());
        const duration = parseInt(lines[0]) || 300;
        const title = lines[1] || 'Unknown Video';
        console.log(`Video Info: "${title}" - ${duration}s`);
        res.json({ duration, title });
    });
});

// 2. Download Full Video (1080p)
app.post('/api/download-full', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const ts = Date.now();
    const outputTemplate = path.join(downloadsDir, `full_${ts}.mp4`);

    const args = [
        url,
        '-f', 'bv*[height<=1080]+ba/b',
        '--merge-output-format', 'mp4',
        '-o', outputTemplate,
        '--force-overwrites',
        '--no-mtime',
        '--no-playlist',
        '--no-warnings',
        '--concurrent-fragments', '10',
        '--buffer-size', '64K',
        '--http-chunk-size', '10M',
        '--retries', '3',
        '--socket-timeout', '10',
        '--extractor-args', 'youtube:player_client=android',
        '--ffmpeg-location', ffmpegStatic
    ];

    console.log('Downloading Full Video:', url);
    const proc = spawn(ytdlpPath, args);

    proc.stdout.on('data', d => process.stdout.write(`[full] ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`[full] ${d}`));

    proc.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ error: 'Full download failed' });
        }
        const outputFile = findOutputFile(outputTemplate);
        if (!outputFile) {
            return res.status(500).json({ error: 'Output file not found' });
        }
        console.log('Full download complete:', outputFile);
        res.download(outputFile, 'video_full_1080p.mp4');
    });
});

// 3. Trim Video — FAST METHOD: yt-dlp extracts URLs only, ffmpeg does direct stream+cut
app.post('/api/trim', async (req, res) => {
    const { url, startTime, endTime } = req.body;
    if (!url || !startTime || !endTime) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const ts = Date.now();
    const outputPath = path.join(downloadsDir, `trim_${ts}.mp4`);

    // Calculate duration in seconds
    const toSec = (t) => { const p = t.split(':').map(Number); return p[0]*3600 + p[1]*60 + p[2]; };
    const durationSec = toSec(endTime) - toSec(startTime);
    if (durationSec <= 0) {
        return res.status(400).json({ error: 'End time must be after start time' });
    }

    console.log(`FAST TRIM: ${startTime} -> ${endTime} (${durationSec}s)`);

    // Step 1: Get direct video+audio URLs from yt-dlp (NO download, just URL extraction)
    execFile(ytdlpPath, [
        url, '-f', 'bestvideo[height<=1080]+bestaudio', '-g', '--no-playlist', '--no-warnings'
    ], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('URL extraction failed:', stderr);
            return res.status(500).json({ error: 'Could not get video URLs' });
        }

        const urls = stdout.trim().replace(/\r/g, '').split('\n').filter(Boolean);
        console.log(`Extracted ${urls.length} stream URLs`);
        if (urls.length < 2) {
            return res.status(500).json({ error: 'Could not extract separate video/audio streams' });
        }

        const videoUrl = urls[0];
        const audioUrl = urls[1];

        // Step 2: FFmpeg direct stream + trim (keyframe seek = FAST)
        // -ss BEFORE -i = input seeking (server-side, skips bytes, near instant)
        // -c copy = no re-encoding (instant muxing)
        const ffArgs = [
            '-ss', startTime,
            '-i', videoUrl,
            '-ss', startTime,
            '-i', audioUrl,
            '-t', String(durationSec),
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c', 'copy',
            '-movflags', '+faststart',
            '-y',
            outputPath
        ];

        console.log('FFmpeg direct trim starting...');
        const ffProc = spawn(ffmpegStatic, ffArgs);

        ffProc.stderr.on('data', d => process.stderr.write(`[ffmpeg] ${d}`));

        ffProc.on('close', (code) => {
            if (code !== 0 || !fs.existsSync(outputPath)) {
                console.error('FFmpeg trim failed, code:', code);
                return res.status(500).json({ error: 'FFmpeg trim failed' });
            }
            console.log('FAST TRIM complete:', outputPath);
            res.download(outputPath, 'trimmed_clip_1080p.mp4');
        });
    });
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`yt-dlp: ${ytdlpPath}`);
    console.log(`ffmpeg: ${ffmpegStatic}`);
});
