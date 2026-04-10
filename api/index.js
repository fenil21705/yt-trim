const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const ffmpegStatic = require('ffmpeg-static');

const isWin = process.platform === 'win32';
const tmpDir = isWin ? path.join(__dirname, '../server/downloads') : '/tmp';

if (isWin && !fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Determine yt-dlp path
const ytdlpFileName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const ytdlpPath = path.join(process.cwd(), 'bin', ytdlpFileName);

// Ensure Linux binary is executable (Vercel)
if (!isWin && fs.existsSync(ytdlpPath)) {
    try {
        fs.chmodSync(ytdlpPath, '755');
    } catch (e) {
        console.error('Failed to set executable permissions:', e);
    }
}

function findOutputFile(basePath) {
    const dir = path.dirname(basePath);
    const baseName = path.basename(basePath, '.mp4');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    if (fs.existsSync(basePath)) return basePath;
    const match = files.find(f => f.startsWith(baseName) && f.endsWith('.mp4'));
    if (match) return path.join(dir, match);
    return null;
}

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
        res.json({ duration, title });
    });
});

app.post('/api/download-full', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const ts = Date.now();
    const outputTemplate = path.join(tmpDir, `full_${ts}.mp4`);

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
        '--ffmpeg-location', ffmpegStatic
    ];

    const proc = spawn(ytdlpPath, args);
    proc.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: 'Full download failed' });
        const outputFile = findOutputFile(outputTemplate);
        if (!outputFile) return res.status(500).json({ error: 'Output file not found' });
        res.download(outputFile, 'video_full.mp4');
    });
});

app.post('/api/trim', async (req, res) => {
    const { url, startTime, endTime } = req.body;
    if (!url || !startTime || !endTime) return res.status(400).json({ error: 'Missing parameters' });

    const ts = Date.now();
    const outputPath = path.join(tmpDir, `trim_${ts}.mp4`);

    const toSec = (t) => { 
        const p = t.split(':').map(Number); 
        if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
        if (p.length === 2) return p[0]*60 + p[1];
        return p[0];
    };
    const durationSec = toSec(endTime) - toSec(startTime);

    execFile(ytdlpPath, [
        url, '-f', 'bestvideo[height<=1080]+bestaudio', '-g', '--no-playlist', '--no-warnings'
    ], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return res.status(500).json({ error: 'Could not get video URLs' });
        const urls = stdout.trim().replace(/\r/g, '').split('\n').filter(Boolean);
        if (urls.length < 2) return res.status(500).json({ error: 'Could not extract separate streams' });

        const ffArgs = [
            '-ss', startTime, '-i', urls[0],
            '-ss', startTime, '-i', urls[1],
            '-t', String(durationSec),
            '-map', '0:v:0', '-map', '1:a:0',
            '-c', 'copy', '-movflags', '+faststart', '-y', outputPath
        ];

        const ffProc = spawn(ffmpegStatic, ffArgs);
        ffProc.on('close', (code) => {
            if (code !== 0 || !fs.existsSync(outputPath)) return res.status(500).json({ error: 'Trim failed' });
            res.download(outputPath, 'trimmed_clip.mp4');
        });
    });
});

module.exports = app;
if (require.main === module) {
    app.listen(3001, () => console.log('Server running on http://localhost:3001'));
}
