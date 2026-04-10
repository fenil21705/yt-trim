import React, { useState, useRef } from 'react';
import './index.css';

const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? '' : 'https://yt-trim-api.onrender.com');

function App() {
  const [url, setUrl] = useState('');
  const [step, setStep] = useState(0); // 0=URL, 1=Trim/Download
  const [videoId, setVideoId] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [duration, setDuration] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState('');
  const [status, setStatus] = useState({ type: '', msg: '' });

  // Separate HH:MM:SS fields for keyboard typing
  const [startHH, setStartHH] = useState('00');
  const [startMM, setStartMM] = useState('00');
  const [startSS, setStartSS] = useState('00');
  const [endHH, setEndHH] = useState('00');
  const [endMM, setEndMM] = useState('01');
  const [endSS, setEndSS] = useState('00');

  const extractVideoId = (inputUrl) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = inputUrl.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const hmsToSeconds = (h, m, s) => {
    return (parseInt(h) || 0) * 3600 + (parseInt(m) || 0) * 60 + (parseInt(s) || 0);
  };

  const secondsToHMS = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return { h, m, s };
  };

  // When user types in a time field, update the seconds state too
  const onStartFieldChange = (field, val) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    let hh = startHH, mm = startMM, ss = startSS;
    if (field === 'h') { hh = cleaned; setStartHH(cleaned); }
    if (field === 'm') { mm = cleaned; setStartMM(cleaned); }
    if (field === 's') { ss = cleaned; setStartSS(cleaned); }
    const secs = Math.min(hmsToSeconds(hh, mm, ss), duration);
    setStartTime(secs);
  };

  const onEndFieldChange = (field, val) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    let hh = endHH, mm = endMM, ss = endSS;
    if (field === 'h') { hh = cleaned; setEndHH(cleaned); }
    if (field === 'm') { mm = cleaned; setEndMM(cleaned); }
    if (field === 's') { ss = cleaned; setEndSS(cleaned); }
    const secs = Math.min(hmsToSeconds(hh, mm, ss), duration);
    setEndTime(secs);
  };

  // When slider changes, sync to the HH/MM/SS fields
  const onSliderChange = ({ start, end }) => {
    setStartTime(start);
    setEndTime(end);
    const s1 = secondsToHMS(start);
    setStartHH(s1.h); setStartMM(s1.m); setStartSS(s1.s);
    const s2 = secondsToHMS(end);
    setEndHH(s2.h); setEndMM(s2.m); setEndSS(s2.s);
  };

  // ---------- API Calls ----------

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    const id = extractVideoId(url);
    if (!id) { setStatus({ type: 'error', msg: 'Invalid YouTube URL' }); return; }

    setIsLoading(true);
    setLoadingAction('info');
    setStatus({ type: 'info', msg: 'Getting video info...' });

    try {
      const baseUrl = API_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) {
        let errStr = await res.text();
        try { const j = JSON.parse(errStr); errStr = j.error || errStr; } catch(e){}
        throw new Error(`API Error: ${res.status} - ${errStr}`);
      }
      const data = await res.json();

      setVideoId(id);
      setVideoTitle(data.title);
      setDuration(data.duration);
      setStartTime(0);
      const defaultEnd = Math.min(data.duration, 60);
      setEndTime(defaultEnd);

      const s1 = secondsToHMS(0);
      setStartHH(s1.h); setStartMM(s1.m); setStartSS(s1.s);
      const s2 = secondsToHMS(defaultEnd);
      setEndHH(s2.h); setEndMM(s2.m); setEndSS(s2.s);

      setStep(1);
      setStatus({ type: '', msg: '' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setIsLoading(false);
      setLoadingAction('');
    }
  };

  const handleTrim = async () => {
    if (endTime <= startTime) {
      setStatus({ type: 'error', msg: 'End time must be after start time!' });
      return;
    }
    setIsLoading(true);
    setLoadingAction('trim');
    setStatus({ type: 'info', msg: 'Trimming clip in 1080p... please wait' });

    try {
      const baseUrl = API_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/trim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, startTime: formatTime(startTime), endTime: formatTime(endTime) })
      });
      if (!res.ok) {
        let errStr = await res.text();
        try { const j = JSON.parse(errStr); errStr = j.error || errStr; } catch(e){}
        throw new Error(`API Error: ${res.status} - ${errStr}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'trimmed_clip_1080p.mp4';
      a.click();
      setStatus({ type: 'success', msg: 'Trimmed clip downloaded!' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setIsLoading(false);
      setLoadingAction('');
    }
  };

  const handleFullDownload = async () => {
    setIsLoading(true);
    setLoadingAction('full');
    setStatus({ type: 'info', msg: 'Downloading full video in 1080p... please wait' });

    try {
      const baseUrl = API_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/download-full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) {
        let errStr = await res.text();
        try { const j = JSON.parse(errStr); errStr = j.error || errStr; } catch(e){}
        throw new Error(`API Error: ${res.status} - ${errStr}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'video_full_1080p.mp4';
      a.click();
      setStatus({ type: 'success', msg: 'Full video downloaded!' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setIsLoading(false);
      setLoadingAction('');
    }
  };

  // ---------- Render ----------

  return (
    <div className="app-container">
      <header className="header">
        <h1>ClipsCutter</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          {step === 1 ? videoTitle : 'Trim & Download YouTube Videos in 1080p'}
        </p>
      </header>

      {step === 0 && (
        <div className="card">
          <form className="url-form" onSubmit={handleUrlSubmit}>
            <div className="url-input-wrapper">
              <input
                type="text"
                placeholder="Paste YouTube link here..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? <span className="loader"></span> : 'Start'}
            </button>
          </form>
          {status.msg && (
            <div className={`status-indicator status-${status.type}`}>{status.msg}</div>
          )}
        </div>
      )}

      {step === 1 && (
        <>
          {/* Video Preview */}
          <div className="player-wrapper">
            <iframe
              width="100%"
              height="100%"
              src={`https://www.youtube.com/embed/${videoId}`}
              title="Preview"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* SECTION 1: Trim */}
          <div className="card">
            <h3 className="section-title">✂️ Trim Video</h3>

            <div className="slider-container">
              <RangeSlider
                min={0}
                max={duration}
                start={startTime}
                end={endTime}
                onChange={onSliderChange}
              />
            </div>

            <div className="time-row">
              <div className="time-box">
                <label>Start (HH:MM:SS)</label>
                <div className="time-fields">
                  <input type="text" value={startHH} onChange={e => onStartFieldChange('h', e.target.value)} maxLength={2} placeholder="HH" />
                  <span>:</span>
                  <input type="text" value={startMM} onChange={e => onStartFieldChange('m', e.target.value)} maxLength={2} placeholder="MM" />
                  <span>:</span>
                  <input type="text" value={startSS} onChange={e => onStartFieldChange('s', e.target.value)} maxLength={2} placeholder="SS" />
                </div>
              </div>
              <div className="time-box">
                <label>End (HH:MM:SS)</label>
                <div className="time-fields">
                  <input type="text" value={endHH} onChange={e => onEndFieldChange('h', e.target.value)} maxLength={2} placeholder="HH" />
                  <span>:</span>
                  <input type="text" value={endMM} onChange={e => onEndFieldChange('m', e.target.value)} maxLength={2} placeholder="MM" />
                  <span>:</span>
                  <input type="text" value={endSS} onChange={e => onEndFieldChange('s', e.target.value)} maxLength={2} placeholder="SS" />
                </div>
              </div>
              <div className="time-box">
                <label>Clip Duration</label>
                <div className="duration-display">{formatTime(Math.max(0, endTime - startTime))}</div>
              </div>
            </div>

            <button className="btn btn-primary btn-full" onClick={handleTrim} disabled={isLoading}>
              {isLoading && loadingAction === 'trim' ? <span className="loader"></span> : '✂️ Trim & Download 1080p Clip'}
            </button>
          </div>

          {/* SECTION 2: Full Download */}
          <div className="card">
            <h3 className="section-title">⬇️ Download Full Video</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Download the complete video in 1080p quality without any trimming.
            </p>
            <button className="btn btn-secondary btn-full" onClick={handleFullDownload} disabled={isLoading}>
              {isLoading && loadingAction === 'full' ? <span className="loader"></span> : '⬇️ Download Full Video (1080p)'}
            </button>
          </div>

          {/* Back Button */}
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              className="btn"
              style={{ background: 'var(--border)', color: 'var(--text)' }}
              onClick={() => { setStep(0); setStatus({ type: '', msg: '' }); }}
            >
              ← Try Another Video
            </button>
          </div>

          {status.msg && (
            <div className={`status-indicator status-${status.type}`} style={{ marginTop: '1.5rem' }}>
              {status.msg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -- Range Slider Component --
function RangeSlider({ min, max, start, end, onChange }) {
  const trackRef = useRef(null);
  const getPercent = (v) => ((v - min) / (max - min)) * 100;

  const handleMouseDown = (type) => (e) => {
    e.preventDefault();
    const move = (ev) => {
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
      const val = Math.round(min + pct * (max - min));
      if (type === 'start') onChange({ start: Math.min(val, end - 1), end });
      else onChange({ start, end: Math.max(val, start + 1) });
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div className="range-slider" ref={trackRef}>
      <div
        className="range-track"
        style={{ left: `${getPercent(start)}%`, width: `${getPercent(end) - getPercent(start)}%` }}
      />
      <div className="thumb" style={{ left: `${getPercent(start)}%` }} onMouseDown={handleMouseDown('start')} />
      <div className="thumb" style={{ left: `${getPercent(end)}%` }} onMouseDown={handleMouseDown('end')} />
    </div>
  );
}

export default App;
