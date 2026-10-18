import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, Sparkles, Copy, Check, Film, Music, Sliders, Download,
  ChevronRight, Clapperboard, Video, RefreshCw, Scissors, Zap, X,
  MonitorPlay, FastForward, DownloadCloud, Cpu, CheckCircle, Upload,
  Key, Mic, Clock, AlertTriangle, Loader2, Trash2, Eye, Plus, Wand2, FileAudio,
} from 'lucide-react';

/* ============================== FAL.AI CONFIG ============================== */
// Kling v1.5 pro image-to-video and v1.6 pro text-to-video: 5s or 10s clips, 9:16.
// Whisper: timestamped transcription (chunk_level=segment) so lyrics map onto scenes.
// NOTE: the fal.ai key is typed into the app by the user and lives ONLY in this
// browser's localStorage. It is never committed to the repo or sent anywhere but fal.ai.
const FAL_KLING_I2V = 'fal-ai/kling-video/v1.5/pro/image-to-video';
const FAL_KLING_T2V = 'fal-ai/kling-video/v1.6/pro/text-to-video';
const FAL_WHISPER = 'fal-ai/whisper';
const FAL_STORAGE_INITIATE = 'https://rest.alpha.fal.ai/storage/upload/initiate';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CORE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.js`;
const FFMPEG_WASM_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.wasm`;

const LS_KEY = 'ddc_studio_fal_key';
const LS_PROJECT = 'ddc_studio_project_v1';

/* ============================== FAL.AI HELPERS ============================== */
async function falPost(endpoint, key, body) {
  const url = endpoint.startsWith('http') ? endpoint : `https://fal.run/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    const detail = data?.detail || data?.error || `HTTP ${res.status}`;
    throw new Error(`fal.ai error: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data || {};
}

async function falGet(url, key) {
  const res = await fetch(url, { headers: { 'Authorization': `Key ${key}` } });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    const detail = data?.detail || data?.error || `HTTP ${res.status}`;
    throw new Error(`fal.ai error: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data || {};
}

async function pollFalQueue(statusUrl, responseUrl, key, { intervalMs, maxPolls, onTick, isCancelled }) {
  for (let i = 0; i < maxPolls; i++) {
    if (isCancelled && isCancelled()) return { cancelled: true };
    await new Promise((r) => setTimeout(r, intervalMs));
    if (isCancelled && isCancelled()) return { cancelled: true };
    const s = await falGet(statusUrl, key);
    if (onTick) onTick(s, i);
    if (s.status === 'COMPLETED') {
      let result = s;
      if (responseUrl && !s.video && !s.text) {
        try { result = await falGet(responseUrl, key); } catch (e) { /* keep status payload */ }
      }
      return { completed: true, data: result };
    }
    if (s.status === 'FAILED') throw new Error('fal.ai failed this job. Try tweaking the prompt or input and run it again.');
  }
  throw new Error('Timed out waiting on fal.ai — check your fal.ai dashboard, the job may still finish there.');
}

// Real image-to-video / text-to-video via Kling on fal.ai. Billed to the user's fal.ai account.
async function klingGenerate(key, { mode, prompt, imageUrl, duration, onTick, isCancelled }) {
  const endpoint = mode === 'text' ? FAL_KLING_T2V : FAL_KLING_I2V;
  const dur = duration === '10' ? '10' : '5';
  const body = mode === 'text'
    ? { prompt, duration: dur, aspect_ratio: '9:16' }
    : { prompt, image_url: imageUrl, duration: dur, aspect_ratio: '9:16' };
  const started = await falPost(endpoint, key, body);
  if (!started.status_url) throw new Error('fal.ai did not return a status URL. Try again.');
  const out = await pollFalQueue(started.status_url, started.response_url, key, {
    intervalMs: 8000, maxPolls: 40, onTick, isCancelled,
  });
  if (out.cancelled) return { cancelled: true };
  const url = out.data?.video?.url;
  if (!url) throw new Error('Render finished but no video URL came back.');
  return { url };
}

// Real audio -> timestamped lyrics via fal-ai/whisper.
// Flow: initiate fal storage upload -> browser PUTs bytes direct -> submit whisper -> poll.
async function whisperTranscribe(key, file, onStatus, isCancelled) {
  if (!file) throw new Error('No audio file to transcribe.');
  if (file.size > 100 * 1024 * 1024) throw new Error('That file is over 100MB — try a smaller MP3.');
  if (onStatus) onStatus('Starting upload to fal.ai…');
  const init = await falPost(FAL_STORAGE_INITIATE, key, {
    file_name: file.name || 'audio.mp3',
    content_type: file.type || 'audio/mpeg',
  });
  if (!init.upload_url || !init.file_url) throw new Error('fal.ai storage did not return an upload URL.');
  if (onStatus) onStatus('Uploading audio…');
  let putRes;
  try {
    putRes = await fetch(init.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'audio/mpeg' },
      body: file,
    });
  } catch (e) {
    throw new Error('Upload to fal.ai was interrupted. Check your connection and try again.');
  }
  if (!putRes.ok) throw new Error('Audio upload to fal.ai failed. Try again.');
  if (onStatus) onStatus('Transcribing with Whisper… (a full song takes a few minutes)');
  const sub = await falPost(FAL_WHISPER, key, {
    audio_url: init.file_url, task: 'transcribe', chunk_level: 'segment',
  });
  if (!sub.status_url) throw new Error('fal.ai did not start the transcription job.');
  const out = await pollFalQueue(sub.status_url, sub.response_url, key, {
    intervalMs: 5000, maxPolls: 72,
    onTick: (s) => { if (onStatus) onStatus(`Transcribing… (${s.status === 'IN_QUEUE' ? 'queued' : 'working'})`); },
    isCancelled,
  });
  if (out.cancelled) return { cancelled: true };
  const data = out.data || {};
  const chunks = Array.isArray(data.chunks) ? data.chunks : [];
  const segments = [];
  for (const c of chunks) {
    let start = null, end = null;
    if (Array.isArray(c.timestamp)) { start = Number(c.timestamp[0]); end = Number(c.timestamp[1]); }
    else if (typeof c.start === 'number') { start = c.start; end = c.end; }
    const text = String(c?.text || '').trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) segments.push({ start, end, text });
  }
  const text = String(data.text || '').trim();
  if (!text && !segments.length) {
    throw new Error('fal.ai returned an empty transcript — the vocals may be buried in the mix. Paste the lyrics by hand instead.');
  }
  return { text, segments };
}

/* ============================== AUDIO HELPERS ============================== */
async function decodeAudioFile(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('This browser cannot decode audio. Try Chrome on your phone.');
  const ctx = new AC();
  try {
    const buf = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf);
    const peaks = computePeaks(audioBuffer, 160);
    return { duration: audioBuffer.duration, peaks };
  } catch (e) {
    throw new Error('Could not read that audio file. Try an MP3 or WAV.');
  } finally {
    try { ctx.close(); } catch (e) { /* ignore */ }
  }
}

function computePeaks(audioBuffer, count) {
  const ch = audioBuffer.getChannelData(0);
  const block = Math.max(1, Math.floor(ch.length / count));
  const peaks = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    let max = 0;
    const s = i * block;
    for (let j = s; j < s + block && j < ch.length; j += 11) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

/* ============================== FORMAT + PROMPTS ============================== */
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}
function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/* ============================== DEFAULT ASSETS ============================== */
const DEFAULT_PALETTES = [
  { id: 'pal-1', name: 'Neon Cyber Amber & Slate', hexes: ['#0f172a', '#f59e0b', '#06b6d4', '#475569'], mood: 'Gritty, high-contrast reflections, amber key light' },
  { id: 'pal-2', name: 'Tokyo Rain Synthwave', hexes: ['#1e1b4b', '#d946ef', '#06b6d4', '#10b981'], mood: 'Wet asphalt, magenta rim lights, electric cyan glow' },
  { id: 'pal-3', name: 'Warm 35mm Kodak Gold', hexes: ['#451a03', '#d97706', '#fbbf24', '#78350f'], mood: 'Nostalgic golden hour, organic film grain, warm skin tones' }
];
const DEFAULT_STYLES = [
  { id: 'sty-1', name: 'Hyper-Realistic 35mm Cinema', descriptor: 'Shot on Arri Alexa LF, Panavision Anamorphic lenses, natural lens flare, 8k resolution, cinematic color grade' },
  { id: 'sty-2', name: 'Neo-Tokyo Anime Realism', descriptor: 'Makoto Shinkai aesthetic blended with cinematic photorealism, volumetric rain and neon glow' },
  { id: 'sty-3', name: 'Vintage 16mm Indie Grain', descriptor: 'Heavy film grain, nostalgic bloom, slight motion blur, raw documentary music video feel' }
];
const DEFAULT_CHARACTERS = [
  {
    id: 'char-1', name: 'Kaelen (Lead)',
    face: '24-year-old androgynous artist with sharp cheekbones, piercing hazel eyes',
    hair: 'Textured jet-black wavy fringe undercut',
    outfit: 'Oversized distressed charcoal bomber jacket with neon orange lining',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'
  }
];
const DEFAULT_THEMES = [
  { id: 'thm-1', name: 'Subterranean Neon Club & Rain Alley', notes: 'Bioluminescent low-ceiling concrete corridors, rain-drenched neon alleys with water reflections' }
];

const SECTION_ORDER = ['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2', 'Chorus', 'Bridge', 'Final Chorus'];
function defaultTitle(i, n) {
  if (i === 0) return 'Intro';
  if (i === n - 1 && n > 1) return 'Outro';
  return SECTION_ORDER[i] || `Section ${i + 1}`;
}
function defaultEnergy(title) {
  if (title.includes('Chorus')) return 9;
  if (title.includes('Pre-Chorus')) return 7;
  if (title.includes('Bridge')) return 8;
  if (title.includes('Intro')) return 3;
  if (title.includes('Outro')) return 4;
  return 5;
}

/* ============================== MAIN COMPONENT ============================== */
const SectionBadge = ({ title }) => {
  const lowerTitle = (title || '').toLowerCase();
  let colorClass = 'bg-slate-800 text-slate-300 border-slate-700';
  if (lowerTitle.includes('intro') || lowerTitle.includes('outro')) colorClass = 'bg-blue-950 text-blue-400 border-blue-800';
  else if (lowerTitle.includes('verse')) colorClass = 'bg-emerald-950 text-emerald-400 border-emerald-800';
  else if (lowerTitle.includes('chorus')) colorClass = 'bg-purple-950 text-purple-400 border-purple-800';
  else if (lowerTitle.includes('pre-chorus') || lowerTitle.includes('build')) colorClass = 'bg-fuchsia-950 text-fuchsia-400 border-fuchsia-800';
  else if (lowerTitle.includes('bridge') || lowerTitle.includes('solo')) colorClass = 'bg-amber-950 text-amber-400 border-amber-800';
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${colorClass}`}>
      {title}
    </span>
  );
};

function loadSavedProject() {
  try {
    const raw = localStorage.getItem(LS_PROJECT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

export default function DDCDirectorStudio() {
  const [activeTab, setActiveTab] = useState('timeline');

  // Fal.ai key: user-typed, localStorage only, never in the repo.
  const [falKey, setFalKey] = useState(() => { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } });
  const [showKey, setShowKey] = useState(false);
  const [keySavedTick, setKeySavedTick] = useState(false);

  const saved = useRef(loadSavedProject()).current;

  const [project, setProject] = useState({
    title: (saved && saved.title) || 'Untitled Single',
    artist: (saved && saved.artist) || '',
    intervalSeconds: (saved && saved.intervalSeconds) || 15,
    customSeconds: (saved && saved.customSeconds) || 20,
  });
  const [lyricsText, setLyricsText] = useState((saved && saved.lyricsText) || '');

  // Real audio state
  const [audio, setAudio] = useState(null); // { name, url, duration, peaks }
  const [isDecoding, setIsDecoding] = useState(false);
  const [audioError, setAudioError] = useState('');
  const audioFileRef = useRef(null);
  const audioRef = useRef(null);
  const playRangeRef = useRef(null);

  const [characters, setCharacters] = useState(DEFAULT_CHARACTERS);
  const [palettes] = useState(DEFAULT_PALETTES);
  const [styles] = useState(DEFAULT_STYLES);
  const [themes] = useState(DEFAULT_THEMES);
  const [lockedAssets] = useState({ characterId: 'char-1', paletteId: 'pal-1', styleId: 'sty-1', themeId: 'thm-1' });

  const [segments, setSegments] = useState((saved && Array.isArray(saved.scenes)) ? saved.scenes : []);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [sortByEnergy, setSortByEnergy] = useState(false);

  const [generatingImageId, setGeneratingImageId] = useState(null);
  const [generatingPortraitId, setGeneratingPortraitId] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [loopEnabled, setLoopEnabled] = useState(true);

  // Playback state (driven by the real <audio> element)
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [transcribeError, setTranscribeError] = useState('');
  const transcribeCancelRef = useRef(false);

  // Per-scene Kling cancel flags
  const klingCancelRef = useRef({});

  // Master Assembly Modal + Export Engine
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const ffmpegRef = useRef(null);
  const canvasRef = useRef(null);
  const copyTimerRef = useRef(null);

  const lockedChar = characters.find(c => c.id === lockedAssets.characterId) || characters[0];
  const lockedPalette = palettes.find(p => p.id === lockedAssets.paletteId) || palettes[0];
  const lockedStyle = styles.find(s => s.id === lockedAssets.styleId) || styles[0];
  const lockedTheme = themes.find(t => t.id === lockedAssets.themeId) || themes[0];
  const locked = { char: lockedChar, palette: lockedPalette, style: lockedStyle, theme: lockedTheme };

  /* ------------------------- persistence ------------------------- */
  const persist = (nextProject, nextLyrics, nextSegments) => {
    try {
      const scenes = (nextSegments || segments).map(s => ({
        id: s.id, sceneNumber: s.sceneNumber, title: s.title,
        startTime: s.startTime, endTime: s.endTime, duration: s.duration,
        energyLevel: s.energyLevel, lyrics: s.lyrics,
        shotType: s.shotType, lipSyncEnabled: s.lipSyncEnabled,
        characterAction: s.characterAction, cameraAngle: s.cameraAngle,
        cameraMovement: s.cameraMovement, setting: s.setting, lightingMood: s.lightingMood,
        approvedPrompt: s.approvedPrompt, keyframeImageUrl: s.keyframeImageUrl,
        brollPrompt: s.brollPrompt, lipsyncPrompt: s.lipsyncPrompt, videoPrompt: s.videoPrompt,
        klingMode: s.klingMode, klingDuration: s.klingDuration,
        videoGen: s.videoGen && s.videoGen.status === 'done' ? { status: 'done', url: s.videoGen.url } : { status: 'idle' },
        trimStart: s.trimStart, trimEnd: s.trimEnd,
      }));
      localStorage.setItem(LS_PROJECT, JSON.stringify({
        title: nextProject.title, artist: nextProject.artist,
        intervalSeconds: nextProject.intervalSeconds, customSeconds: nextProject.customSeconds,
        lyricsText: nextLyrics, scenes,
      }));
    } catch (e) { /* storage full or unavailable — non-fatal */ }
  };

  /* ------------------------- prompt compilers ------------------------- */
  const compilePromptForScene = (scene) => {
    return `Cinematic music video, ${lockedStyle.descriptor}. Character: ${lockedChar.name}, wearing ${lockedChar.outfit}. Setting: ${scene.setting || lockedTheme.notes}. Action: ${scene.characterAction}. Camera: ${scene.cameraAngle}, ${scene.cameraMovement}. Lighting: ${scene.lightingMood}. Colors: [${lockedPalette.hexes.join(', ')}]. 9:16 vertical.`;
  };
  const compileBrollPrompt = (scene) => {
    return `B-roll cutaway, cinematic music video, ${lockedStyle.descriptor}. No lip sync — pure atmosphere and texture. Setting: ${scene.setting || lockedTheme.notes}. Action: ${scene.characterAction}. Camera: ${scene.cameraAngle}, slow ${scene.cameraMovement.toLowerCase()}. Lighting: ${scene.lightingMood}. Colors: [${lockedPalette.hexes.join(', ')}]. Photorealistic, 9:16 vertical.`;
  };
  const compileLipSyncPrompt = (scene) => {
    return `Extreme close-up lip sync shot, cinematic music video. Character: ${lockedChar.name}, ${lockedChar.face}, wearing ${lockedChar.outfit}, singing directly into the lens, emotive, mouth forming the lyric "${scene.lyrics}". Camera: intimate close-up, subtle slow dolly in. Lighting: ${scene.lightingMood}. Colors: [${lockedPalette.hexes.join(', ')}]. Photorealistic, shallow depth of field, 9:16 vertical.`;
  };
  const compileVideoPrompt = (scene) => {
    return `${scene.characterAction}, ${scene.cameraMovement.toLowerCase()} camera move, ${scene.cameraAngle.toLowerCase()}. Setting: ${scene.setting || lockedTheme.notes}. Lighting: ${scene.lightingMood}. Character: ${lockedChar.name} wearing ${lockedChar.outfit}. Colors: [${lockedPalette.hexes.join(', ')}]. Cinematic photorealistic motion, smooth natural movement, 9:16 vertical video.`;
  };

  /* ------------------------- segment builder ------------------------- */
  const buildSegments = (duration, intervalSec, lyricLines, prev) => {
    const iv = Math.max(1, intervalSec || 15);
    const n = Math.max(1, Math.ceil(duration / iv));
    const per = Math.max(1, Math.ceil(lyricLines.length / n));
    const segs = [];
    for (let i = 0; i < n; i++) {
      const start = i * iv;
      const end = Math.min((i + 1) * iv, duration);
      const title = defaultTitle(i, n);
      const lines = lyricLines.slice(i * per, (i + 1) * per).join(' ').replace(/\[\d{2}:\d{2}(?:\.\d)?\]/g, '').trim();
      const p = prev && prev[i];
      segs.push({
        id: `scene-${i + 1}`,
        sceneNumber: i + 1,
        title: (p && p.title) || title,
        startTime: start,
        endTime: end,
        duration: end - start,
        energyLevel: (p && typeof p.energyLevel === 'number') ? p.energyLevel : defaultEnergy(title),
        lyrics: lines || (p && p.lyrics) || '(Instrumental / Beat)',
        shotType: (p && p.shotType) || (i % 2 === 0 ? 'Lip sync' : 'Motion clip'),
        lipSyncEnabled: (p && typeof p.lipSyncEnabled === 'boolean') ? p.lipSyncEnabled : (i % 2 === 0),
        characterAction: (p && p.characterAction) || (i % 2 === 0 ? 'Stands looking into lens' : 'Runs through dark alleyway'),
        cameraAngle: (p && p.cameraAngle) || (i % 2 === 0 ? 'Close-up' : 'Tracking shot'),
        cameraMovement: (p && p.cameraMovement) || (i % 2 === 0 ? 'Dolly in' : 'Handheld'),
        setting: (p && p.setting) || 'Subterranean rain alley',
        lightingMood: (p && p.lightingMood) || 'High-contrast cyan rim lights',
        approvedPrompt: (p && p.approvedPrompt) || '',
        keyframeImageUrl: (p && p.keyframeImageUrl) || null,
        brollPrompt: (p && p.brollPrompt) || '',
        lipsyncPrompt: (p && p.lipsyncPrompt) || '',
        videoPrompt: (p && p.videoPrompt) || '',
        klingMode: (p && p.klingMode) || 'image',
        klingDuration: (p && p.klingDuration) || '10',
        videoGen: (p && p.videoGen) || { status: 'idle' },
        clipUrl: (p && p.clipUrl) || null,
        clipName: (p && p.clipName) || '',
        trimStart: (p && typeof p.trimStart === 'number') ? p.trimStart : 0,
        trimEnd: (p && typeof p.trimEnd === 'number') ? p.trimEnd : (end - start),
      });
    }
    return segs;
  };

  const lyricLinesOf = (txt) => txt.split('\n').map(l => l.trim()).filter(Boolean);
  const currentInterval = () => project.intervalSeconds === 'custom' ? (parseFloat(project.customSeconds) || 15) : project.intervalSeconds;

  const reslice = (dur, iv, lyrics, prev) => {
    const segs = buildSegments(dur, iv, lyricLinesOf(lyrics), prev);
    setSegments(segs);
    setSelectedSceneIndex(0);
    persist(project, lyrics, segs);
    return segs;
  };

  /* ------------------------- audio upload + decode ------------------------- */
  const handleAudioFile = async (file) => {
    if (!file) return;
    setAudioError('');
    setIsDecoding(true);
    pauseAudio();
    try {
      const { duration, peaks } = await decodeAudioFile(file);
      const url = URL.createObjectURL(file);
      if (audio && audio.url) { try { URL.revokeObjectURL(audio.url); } catch (e) {} }
      audioFileRef.current = file;
      setAudio({ name: file.name, url, duration, peaks });
      setCurrentTime(0);
      reslice(duration, currentInterval(), lyricsText, segments);
    } catch (e) {
      setAudioError(e.message || 'Could not read that audio file.');
    } finally {
      setIsDecoding(false);
    }
  };

  /* ------------------------- real playback ------------------------- */
  const pauseAudio = () => {
    const a = audioRef.current;
    if (a) a.pause();
    playRangeRef.current = null;
    setIsPlaying(false);
  };

  const playScene = (i) => {
    const a = audioRef.current;
    if (!a || !audio) return;
    const s = segments[i];
    if (!s) return;
    setActiveSceneIndex(i);
    playRangeRef.current = { start: s.startTime, end: s.endTime, loop: loopEnabled };
    a.currentTime = Math.min(s.startTime + 0.01, Math.max(0, audio.duration - 0.1));
    a.play().catch(() => {});
    setIsPlaying(true);
  };

  const playAll = () => {
    const a = audioRef.current;
    if (!a || !audio) return;
    const t = currentTime >= audio.duration - 0.2 ? 0 : currentTime;
    playRangeRef.current = { start: 0, end: audio.duration, loop: false };
    a.currentTime = t;
    a.play().catch(() => {});
    setIsPlaying(true);
  };

  const seekTo = (t) => {
    const a = audioRef.current;
    if (!a || !audio) return;
    a.currentTime = Math.max(0, Math.min(t, audio.duration - 0.05));
    setCurrentTime(a.currentTime);
  };

  // Wire the <audio> element once its src exists
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onT = () => {
      const t = a.currentTime;
      setCurrentTime(t);
      const r = playRangeRef.current;
      if (r && !a.paused) {
        if (t >= r.end - 0.08) {
          if (r.loop) { a.currentTime = r.start + 0.01; }
          else { a.pause(); playRangeRef.current = null; setIsPlaying(false); }
        }
      }
    };
    const onEnd = () => { setIsPlaying(false); playRangeRef.current = null; };
    a.addEventListener('timeupdate', onT);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', () => setIsPlaying(false));
    return () => {
      a.removeEventListener('timeupdate', onT);
      a.removeEventListener('ended', onEnd);
    };
  }, [audio && audio.url]);

  // Keep the highlighted scene in sync with playback
  useEffect(() => {
    if (!segments.length || !audio) return;
    const idx = segments.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);
    if (idx >= 0) setActiveSceneIndex(idx);
  }, [currentTime, segments.length, audio]);

  /* ------------------------- waveform ------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width, height = canvas.height;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);
    const peaks = (audio && audio.peaks) || [];
    const bars = peaks.length || 80;
    const barW = width / bars;
    const ratio = audio && audio.duration ? currentTime / audio.duration : 0;
    for (let i = 0; i < bars; i++) {
      const p = peaks[i] || (Math.sin(i * 0.3) * 0.3 + 0.4);
      const barH = Math.max(2, p * (height - 8));
      const x = i * barW;
      const y = (height - barH) / 2;
      ctx.fillStyle = (i / bars <= ratio) ? '#06b6d4' : '#334155';
      ctx.fillRect(x, y, Math.max(1, barW - 1.5), barH);
    }
    // scene boundary ticks
    if (audio && audio.duration && segments.length) {
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      segments.forEach(s => {
        const x = (s.startTime / audio.duration) * width;
        ctx.fillRect(x, 0, 1, height);
      });
    }
  }, [audio, currentTime, segments]);

  /* ------------------------- copy helper ------------------------- */
  const copyText = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
    }
    setCopyFeedback(label);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyFeedback(null), 1600);
  };

  const updateScene = (index, patch) => {
    setSegments(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      persist(project, lyricsText, next);
      return next;
    });
  };

  /* ------------------------- fal.ai key ------------------------- */
  const saveFalKey = () => {
    try { localStorage.setItem(LS_KEY, falKey.trim()); } catch (e) {}
    setKeySavedTick(true);
    setTimeout(() => setKeySavedTick(false), 1600);
  };
  const clearFalKey = () => {
    setFalKey('');
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  };
  const needKey = () => {
    if (!falKey.trim()) {
      setTranscribeError('');
      return false;
    }
    return true;
  };

  /* ------------------------- Pollinations keyframes (free) ------------------------- */
  const handleGenerateFreeKeyframe = (index) => {
    const scene = segments[index];
    if (!scene) return;
    const promptToUse = scene.approvedPrompt || compilePromptForScene(scene);
    setGeneratingImageId(scene.id);
    const seed = Math.floor(Math.random() * 999999);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptToUse)}?width=720&height=1280&model=flux&seed=${seed}&nologo=true`;
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      updateScene(index, { keyframeImageUrl: imageUrl, approvedPrompt: promptToUse });
      setGeneratingImageId(null);
    };
    img.onerror = () => { setGeneratingImageId(null); };
  };

  const handleGenerateCharacterPortrait = (charId, charPrompt) => {
    setGeneratingPortraitId(charId);
    const seed = Math.floor(Math.random() * 100000);
    const portraitUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      `cinematic character portrait, ${charPrompt}, highly detailed, sharp focus, 8k, masterpiece`
    )}?width=512&height=768&model=flux&seed=${seed}&nologo=true`;
    const img = new Image();
    img.src = portraitUrl;
    img.onload = () => {
      setCharacters(prev => prev.map(c => c.id === charId ? { ...c, imageUrl: portraitUrl } : c));
      setGeneratingPortraitId(null);
    };
    img.onerror = () => { setGeneratingPortraitId(null); };
  };

  /* ------------------------- Whisper transcription ------------------------- */
  const handleTranscribe = async () => {
    if (!falKey.trim()) { setTranscribeError('Paste your fal.ai key above first — transcription runs on your fal.ai account.'); return; }
    if (!audioFileRef.current) { setTranscribeError('Upload your song first.'); return; }
    transcribeCancelRef.current = false;
    setIsTranscribing(true);
    setTranscribeError('');
    setTranscribeStatus('Starting…');
    try {
      const out = await whisperTranscribe(falKey.trim(), audioFileRef.current,
        (s) => setTranscribeStatus(s),
        () => transcribeCancelRef.current);
      if (out.cancelled) { setTranscribeStatus('Cancelled.'); return; }
      // Lyrics text with timestamps
      const lines = out.segments.length
        ? out.segments.map(s => `[${fmtClock(s.start)}] ${s.text}`)
        : [out.text];
      const newLyrics = lines.join('\n');
      setLyricsText(newLyrics);
      // Map timestamped chunks onto the scenes by time
      setSegments(prev => {
        const next = prev.map(scene => {
          const hits = out.segments.filter(s => s.start < scene.endTime && s.end > scene.startTime);
          if (hits.length) return { ...scene, lyrics: hits.map(h => h.text).join(' ').trim() };
          return scene;
        });
        persist(project, newLyrics, next);
        return next;
      });
      setTranscribeStatus('Done — lyrics mapped onto your scenes.');
    } catch (e) {
      setTranscribeError(e.message || 'Transcription failed.');
      setTranscribeStatus('');
    } finally {
      setIsTranscribing(false);
    }
  };

  const distributeLyrics = () => {
    if (!audio) return;
    reslice(audio.duration, currentInterval(), lyricsText, segments);
  };

  /* ------------------------- Kling video generation ------------------------- */
  const handleKlingGenerate = async (index) => {
    const scene = segments[index];
    if (!scene) return;
    if (!falKey.trim()) {
      updateScene(index, { videoGen: { status: 'error', error: 'Paste your fal.ai key in the Timeline tab first.' } });
      setActiveTab('timeline');
      return;
    }
    const mode = scene.klingMode || 'image';
    if (mode === 'image' && !scene.keyframeImageUrl) {
      updateScene(index, { videoGen: { status: 'error', error: 'Generate the keyframe still first — Kling animates from it.' } });
      return;
    }
    const prompt = (scene.videoPrompt || '').trim() || compileVideoPrompt(scene);
    if (!scene.videoPrompt) updateScene(index, { videoPrompt: prompt });
    klingCancelRef.current[scene.id] = false;
    updateScene(index, { videoGen: { status: 'working', note: 'Queued on fal.ai…' } });
    try {
      const out = await klingGenerate(falKey.trim(), {
        mode,
        prompt,
        imageUrl: scene.keyframeImageUrl,
        duration: scene.klingDuration || '10',
        onTick: (s) => {
          updateScene(index, { videoGen: { status: 'working', note: s.status === 'IN_QUEUE' ? 'In queue…' : 'Rendering…' } });
        },
        isCancelled: () => klingCancelRef.current[scene.id],
      });
      if (out.cancelled) { updateScene(index, { videoGen: { status: 'idle' } }); return; }
      updateScene(index, { videoGen: { status: 'done', url: out.url } });
    } catch (e) {
      updateScene(index, { videoGen: { status: 'error', error: e.message || 'Generation failed.' } });
    }
  };

  const cancelKling = (index) => {
    const scene = segments[index];
    if (scene) klingCancelRef.current[scene.id] = true;
  };

  /* ------------------------- own clip upload ------------------------- */
  const handleClipUpload = (index, file) => {
    if (!file) return;
    const scene = segments[index];
    if (scene && scene.clipUrl && scene.clipUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(scene.clipUrl); } catch (e) {}
    }
    updateScene(index, { clipUrl: URL.createObjectURL(file), clipName: file.name });
  };
  const removeClip = (index) => {
    const scene = segments[index];
    if (scene && scene.clipUrl && scene.clipUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(scene.clipUrl); } catch (e) {}
    }
    updateScene(index, { clipUrl: null, clipName: '' });
  };

  /* ------------------------- REAL EXPORT (ffmpeg.wasm in-browser) ------------------------- */
  // Every scene becomes a 720x1280 h264 segment: motion clip if you have one
  // (Kling render or your own upload, looped/trimmed to fill the scene), otherwise
  // the keyframe still held for the scene's full length, otherwise a palette color
  // card. Segments are concatenated, then your actual uploaded song is muxed
  // underneath. The MP4 that downloads is the real finished video.
  const loadFfmpeg = async (onStatus) => {
    if (ffmpegRef.current) return ffmpegRef.current;
    onStatus('Loading video engine (one-time download, ~30MB)…');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();
    const coreURL = await toBlobURL(FFMPEG_CORE_URL, 'text/javascript');
    const wasmURL = await toBlobURL(FFMPEG_WASM_URL, 'application/wasm');
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const fetchImageBytesWithFallback = async (url) => {
    const { fetchFile } = await import('@ffmpeg/util');
    try {
      return await fetchFile(url);
    } catch (e) {
      // Rasterize through an <img> if programmatic fetch is blocked
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = 720; c.height = 1280;
            c.getContext('2d').drawImage(img, 0, 0, 720, 1280);
            c.toBlob((b) => { if (b) resolve(b); else reject(new Error('canvas capture failed')); }, 'image/jpeg', 0.92);
          } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('image fetch failed'));
        img.src = url;
      });
      return new Uint8Array(await blob.arrayBuffer());
    }
  };

  const handleExportMP4 = async () => {
    if (!audio || !audioFileRef.current) { setExportStatus('Upload your song first.'); setIsExporting(true); return; }
    if (!segments.length) { setExportStatus('No scenes to export yet.'); setIsExporting(true); return; }
    pauseAudio();
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Starting…');
    try {
      const setP = (p, s) => { setExportProgress(p); setExportStatus(s); };
      const ffmpeg = await loadFfmpeg(setExportStatus);
      const { fetchFile } = await import('@ffmpeg/util');

      setP(6, 'Preparing your audio track…');
      await ffmpeg.writeFile('audio_in', await fetchFile(audioFileRef.current));

      const VF = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30';
      const total = segments.length;
      for (let i = 0; i < total; i++) {
        const scene = segments[i];
        const trimS = Math.max(0, scene.trimStart || 0);
        const segDur = Math.max(0.5, (scene.trimEnd != null ? scene.trimEnd : scene.duration) - trimS);
        const src = scene.clipUrl || (scene.videoGen && scene.videoGen.url);
        setP(6 + Math.round((i / total) * 62), `Building scene ${scene.sceneNumber}/${total}…`);
        if (src) {
          let bytes;
          try { bytes = await fetchFile(src); }
          catch (e) { throw new Error(`Could not pull in the video for scene ${scene.sceneNumber}. Re-attach the clip and try again.`); }
          await ffmpeg.writeFile(`src${i}.mp4`, bytes);
          await ffmpeg.exec([
            '-stream_loop', '-1',
            '-i', `src${i}.mp4`,
            '-ss', String(trimS), '-t', String(segDur),
            '-vf', VF,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-an', `seg${i}.mp4`,
          ]);
          try { await ffmpeg.deleteFile(`src${i}.mp4`); } catch (e) {}
        } else if (scene.keyframeImageUrl) {
          const bytes = await fetchImageBytesWithFallback(scene.keyframeImageUrl);
          await ffmpeg.writeFile(`img${i}.jpg`, bytes);
          await ffmpeg.exec([
            '-loop', '1', '-framerate', '30',
            '-t', String(segDur),
            '-i', `img${i}.jpg`,
            '-vf', VF,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            `seg${i}.mp4`,
          ]);
          try { await ffmpeg.deleteFile(`img${i}.jpg`); } catch (e) {}
        } else {
          const hex = (lockedPalette.hexes[0] || '#0f172a').replace('#', '0x');
          await ffmpeg.exec([
            '-f', 'lavfi', '-i', `color=c=${hex}:s=720x1280:d=${segDur}:r=30`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            `seg${i}.mp4`,
          ]);
        }
      }

      setP(72, 'Stitching scenes together…');
      const list = segments.map((_, i) => `file 'seg${i}.mp4'`).join('\n');
      await ffmpeg.writeFile('list.txt', new TextEncoder().encode(list));
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'concat.mp4']);

      setP(84, 'Mixing your song under the video…');
      await ffmpeg.exec([
        '-i', 'concat.mp4', '-i', 'audio_in',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-map', '0:v:0', '-map', '1:a:0',
        '-shortest', '-movflags', '+faststart',
        'final.mp4',
      ]);

      setP(94, 'Packaging your MP4…');
      const data = await ffmpeg.readFile('final.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const aEl = document.createElement('a');
      aEl.href = url;
      const safeTitle = (project.title || 'DDC_Music_Video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'DDC_Music_Video';
      aEl.download = `${safeTitle}_Master.mp4`;
      document.body.appendChild(aEl);
      aEl.click();
      aEl.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 8000);

      for (let i = 0; i < total; i++) { try { await ffmpeg.deleteFile(`seg${i}.mp4`); } catch (e) {} }
      for (const f of ['concat.mp4', 'final.mp4', 'list.txt', 'audio_in']) {
        try { await ffmpeg.deleteFile(f); } catch (e) {}
      }
      setP(100, 'Render complete — your MP4 downloaded.');
      setTimeout(() => setIsExporting(false), 2600);
    } catch (e) {
      setExportProgress(0);
      setExportStatus(`Export failed: ${(e && e.message) || e}`);
    }
  };

  const activeAssemblySegment = segments.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime) || segments[0];

  return (
    <div className="flex flex-col min-h-screen bg-[#07090e] text-slate-100 font-sans pb-24 md:pb-16">
      {/* hidden real audio element — the song you uploaded */}
      {audio && <audio ref={audioRef} src={audio.url} preload="auto" className="hidden" />}

      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-[#0c1017]/95 border-b border-slate-800/80 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-extrabold tracking-wider text-sm bg-gradient-to-r from-cyan-400 to-amber-300 bg-clip-text text-transparent">
              DDC STUDIO
            </span>
            <p className="text-[11px] text-slate-400 truncate max-w-[150px]">{project.title}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span
            title={falKey.trim() ? 'fal.ai key saved in this browser' : 'No fal.ai key — Kling video + transcription need one'}
            className={`w-2.5 h-2.5 rounded-full ${falKey.trim() ? 'bg-emerald-400' : 'bg-slate-600'}`}
          />
          <button
            onClick={() => setShowAssemblyModal(true)}
            className="text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg flex items-center space-x-1 transition shadow-md shadow-indigo-600/20"
          >
            <MonitorPlay className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Preview Assembly</span>
          </button>
        </div>
      </header>

      {/* MAIN BODY */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-5">

        {/* ================= TIMELINE TAB ================= */}
        {activeTab === 'timeline' && (
          <div className="space-y-5 animate-fadeIn">

            {/* Project */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Project title</label>
                  <input
                    type="text" value={project.title}
                    onChange={(e) => { const p = { ...project, title: e.target.value }; setProject(p); persist(p, lyricsText, segments); }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Artist</label>
                  <input
                    type="text" value={project.artist} placeholder="Artist name"
                    onChange={(e) => { const p = { ...project, artist: e.target.value }; setProject(p); persist(p, lyricsText, segments); }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Audio upload — REAL */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
              {!audio ? (
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="audio/*" className="hidden"
                    onChange={(e) => handleAudioFile(e.target.files && e.target.files[0])}
                  />
                  <div className="border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-2xl p-8 text-center transition">
                    {isDecoding ? (
                      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-2" />
                    ) : (
                      <FileAudio className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                    )}
                    <p className="text-sm font-bold text-white">{isDecoding ? 'Reading your audio…' : 'Upload your song'}</p>
                    <p className="text-[11px] text-slate-400 mt-1">MP3, WAV, M4A — the real file becomes the timeline, the waveform, and the final mix.</p>
                  </div>
                </label>
              ) : (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold text-white flex items-center space-x-2 min-w-0">
                      <Music className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      <span className="truncate">{audio.name}</span>
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={isPlaying ? pauseAudio : playAll}
                        className="w-9 h-9 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center transition"
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <label className="cursor-pointer text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Swap song</span>
                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleAudioFile(e.target.files && e.target.files[0])} />
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-cyan-400">
                      {formatTime(currentTime).slice(0, 5)} / {formatTime(audio.duration).slice(0, 5)}
                    </span>
                    <button
                      onClick={() => setLoopEnabled(!loopEnabled)}
                      className={`text-[10px] font-bold px-2 py-1 rounded border transition ${loopEnabled ? 'bg-cyan-950 text-cyan-400 border-cyan-800' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                    >
                      {loopEnabled ? 'Loop: ON' : 'Loop: OFF'}
                    </button>
                  </div>
                  <canvas
                    ref={canvasRef} width={600} height={80}
                    className="w-full h-20 rounded-lg bg-slate-950 cursor-pointer"
                    onClick={(e) => {
                      if (!audio) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      seekTo(((e.clientX - rect.left) / rect.width) * audio.duration);
                    }}
                  />
                  <p className="text-[10px] text-slate-500">Tap the waveform to scrub. Scene boundaries are marked.</p>
                </>
              )}
              {audioError && (
                <p className="text-xs text-red-400 flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>{audioError}</span></p>
              )}
            </div>

            {/* Fal.ai key — browser only */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center space-x-2">
                <Key className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">fal.ai key — Kling video + lyric transcription</h3>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={falKey}
                    onChange={(e) => setFalKey(e.target.value)}
                    placeholder="Paste your fal.ai API key here"
                    autoComplete="off" spellCheck={false}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 pr-10 text-sm text-white font-mono focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveFalKey} className="text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg transition flex items-center space-x-1">
                    {keySavedTick ? <Check className="w-3.5 h-3.5" /> : null}
                    <span>{keySavedTick ? 'Saved' : 'Save key'}</span>
                  </button>
                  {falKey.trim() && (
                    <button onClick={clearFalKey} className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg transition flex items-center space-x-1">
                      <Trash2 className="w-3.5 h-3.5" /><span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Stored <span className="text-slate-300 font-bold">only in this browser</span> — never in the repo, never sent anywhere except fal.ai.
                Get yours at fal.ai → API Keys. Kling renders bill to your fal.ai account.
              </p>
            </div>

            {/* Interval slicer */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Scene interval</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[10, 15, 20, 30].map((sec) => (
                  <button
                    key={sec}
                    onClick={() => { const p = { ...project, intervalSeconds: sec }; setProject(p); if (audio) reslice(audio.duration, sec, lyricsText, segments); else persist(p, lyricsText, segments); }}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${project.intervalSeconds === sec ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                  >
                    {sec}s
                  </button>
                ))}
                <button
                  onClick={() => { const p = { ...project, intervalSeconds: 'custom' }; setProject(p); persist(p, lyricsText, segments); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${project.intervalSeconds === 'custom' ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                >
                  Custom
                </button>
                {project.intervalSeconds === 'custom' && (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number" min="1" max="120" value={project.customSeconds}
                      onChange={(e) => { const p = { ...project, customSeconds: e.target.value }; setProject(p); persist(p, lyricsText, segments); }}
                      className="w-16 bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">sec</span>
                    <button
                      onClick={() => { if (audio) reslice(audio.duration, parseFloat(project.customSeconds) || 15, lyricsText, segments); }}
                      className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg transition"
                    >
                      Slice
                    </button>
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {audio
                  ? `Covers the full ${formatTime(audio.duration).slice(0, 5)} → ${segments.length} scene${segments.length === 1 ? '' : 's'}.`
                  : 'Upload your song and the timeline slices across its full length.'}
              </p>
            </div>

            {/* Lyrics */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Mic className="w-4 h-4 text-fuchsia-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Lyrics</h3>
                </div>
                <button
                  onClick={handleTranscribe}
                  disabled={isTranscribing || !audio || !falKey.trim()}
                  className="text-xs font-bold bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
                >
                  {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  <span>{isTranscribing ? 'Transcribing…' : 'Auto-transcribe (Whisper)'}</span>
                </button>
              </div>
              {(isTranscribing || transcribeStatus) && !transcribeError && (
                <p className="text-[11px] text-fuchsia-300 font-mono">{transcribeStatus}</p>
              )}
              {transcribeError && (
                <p className="text-xs text-red-400 flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>{transcribeError}</span></p>
              )}
              {isTranscribing && (
                <button onClick={() => { transcribeCancelRef.current = true; }} className="text-[11px] text-slate-400 hover:text-slate-200 underline">
                  Cancel transcription
                </button>
              )}
              <textarea
                rows={6}
                value={lyricsText}
                onChange={(e) => { setLyricsText(e.target.value); persist(project, e.target.value, segments); }}
                placeholder={'Paste your lyrics here — one line per line.\n[00:10] Timestamps like this are fine too.'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-fuchsia-500"
              />
              <button
                onClick={distributeLyrics}
                disabled={!audio}
                className="text-xs font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-3 py-1.5 rounded-lg transition"
              >
                Distribute lines across scenes
              </button>
            </div>

            {/* Scene list */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Time Slices ({segments.length} Scenes)</h3>
              </div>
              {!segments.length && (
                <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                  Upload your song above and scenes will appear here, sliced across the whole track.
                </p>
              )}
              {segments.map((seg, idx) => (
                <div key={seg.id} className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition">
                  <div className="flex items-center space-x-3 min-w-0">
                    <button
                      onClick={() => (isPlaying && activeSceneIndex === idx) ? pauseAudio() : playScene(idx)}
                      disabled={!audio}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-cyan-400 flex items-center justify-center transition flex-shrink-0"
                    >
                      {isPlaying && activeSceneIndex === idx ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2 mb-0.5">
                        <SectionBadge title={seg.title} />
                        <span className="text-[11px] font-mono text-cyan-400">{formatTime(seg.startTime).slice(0, 5)}</span>
                        {(seg.clipUrl || (seg.videoGen && seg.videoGen.url)) && (
                          <span className="text-[9px] font-bold bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800 flex items-center">
                            <Video className="w-2.5 h-2.5 mr-0.5" /> CLIP
                          </span>
                        )}
                        {seg.keyframeImageUrl && (
                          <span className="text-[9px] font-bold bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800">STILL</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-1 italic">"{seg.lyrics}"</div>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedSceneIndex(idx); setActiveTab('scenes'); }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center space-x-1 transition flex-shrink-0 ml-2"
                  >
                    <span>Design</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= SCENES TAB ================= */}
        {activeTab === 'scenes' && segments[selectedSceneIndex] && (() => {
          let displayedSegments = [...segments];
          if (sortByEnergy) displayedSegments.sort((a, b) => b.energyLevel - a.energyLevel);

          const scene = segments[selectedSceneIndex];
          const isGeneratingImg = generatingImageId === scene.id;
          const vg = scene.videoGen || { status: 'idle' };
          const sceneVideoUrl = scene.clipUrl || vg.url;

          return (
            <div className="space-y-5 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Shot Deck</h3>
                <button
                  onClick={() => setSortByEnergy(!sortByEnergy)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    sortByEnergy ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Zap className={`w-3.5 h-3.5 ${sortByEnergy ? 'fill-amber-400' : ''}`} />
                  <span>{sortByEnergy ? 'Ordered by Energy' : 'Chronological'}</span>
                </button>
              </div>

              <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-thin">
                {displayedSegments.map((s) => {
                  const originalIndex = segments.findIndex(seg => seg.id === s.id);
                  const isSelected = selectedSceneIndex === originalIndex;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSceneIndex(originalIndex)}
                      className={`px-3 py-2 rounded-xl text-xs flex flex-col items-center flex-shrink-0 border transition-all ${
                        isSelected ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold shadow-md shadow-cyan-500/20' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <span className="mb-1">Scene {s.sceneNumber}</span>
                      {sortByEnergy ? (
                        <span className={`text-[9px] px-1.5 rounded-sm flex items-center font-bold ${isSelected ? 'bg-cyan-900/50 text-cyan-100' : 'bg-slate-800 text-amber-400'}`}>
                          <Zap className="w-2.5 h-2.5 mr-0.5" /> Lvl {s.energyLevel}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono opacity-80">{formatTime(s.startTime).slice(0, 5)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-lg">

                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2 flex-wrap gap-y-1">
                      <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800">
                        {formatTime(scene.startTime).slice(0, 5)} - {formatTime(scene.endTime).slice(0, 5)}
                      </span>
                      <SectionBadge title={scene.title} />
                      <span className="text-[10px] font-bold bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800 flex items-center">
                        <Zap className="w-3 h-3 mr-1 fill-current" /> Energy {scene.energyLevel}/10
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white mt-1">Scene {scene.sceneNumber}: {scene.title}</h2>
                    <p className="text-[11px] text-slate-400 italic mt-1">"{scene.lyrics}"</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleGenerateFreeKeyframe(selectedSceneIndex)}
                    disabled={isGeneratingImg}
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition active:scale-95 shadow-md shadow-emerald-600/30 flex-shrink-0"
                  >
                    {isGeneratingImg ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Generating Image...</span></>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /><span>Free Keyframe Still</span></>
                    )}
                  </button>
                </div>

                {scene.keyframeImageUrl && (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono">9:16 Storyboard Keyframe (Ready)</span>
                      <a href={scene.keyframeImageUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline">View Full Res ↗</a>
                    </div>
                    <div className="relative aspect-[9/16] max-w-[190px] mx-auto rounded-lg overflow-hidden border border-slate-700 shadow-xl">
                      <img src={scene.keyframeImageUrl} alt={`Scene ${scene.sceneNumber} visual`} className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}

                {/* Motion clip: Kling generation OR own upload */}
                <div className="p-4 bg-purple-950/20 border border-purple-900/50 rounded-xl space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <Video className="w-4 h-4 text-purple-400" />
                      <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider">Motion Clip</h3>
                    </div>
                    {sceneVideoUrl && (
                      <button onClick={() => { removeClip(selectedSceneIndex); updateScene(selectedSceneIndex, { videoGen: { status: 'idle' } }); }} className="text-[10px] text-slate-400 hover:text-red-400 flex items-center space-x-1">
                        <Trash2 className="w-3 h-3" /><span>Remove clip</span>
                      </button>
                    )}
                  </div>

                  {sceneVideoUrl ? (
                    <video src={sceneVideoUrl} controls playsInline className="w-full max-w-[240px] mx-auto rounded-lg border border-slate-700 aspect-[9/16] object-cover bg-black" />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px] font-bold">
                          <button
                            onClick={() => updateScene(selectedSceneIndex, { klingMode: 'image' })}
                            className={`px-3 py-1.5 transition ${scene.klingMode !== 'text' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                          >
                            From keyframe
                          </button>
                          <button
                            onClick={() => updateScene(selectedSceneIndex, { klingMode: 'text' })}
                            className={`px-3 py-1.5 transition ${scene.klingMode === 'text' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                          >
                            Text only
                          </button>
                        </div>
                        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px] font-bold">
                          {['5', '10'].map(d => (
                            <button
                              key={d}
                              onClick={() => updateScene(selectedSceneIndex, { klingDuration: d })}
                              className={`px-3 py-1.5 transition ${scene.klingDuration === d ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                            >
                              {d}s
                            </button>
                          ))}
                        </div>
                        {vg.status === 'working' ? (
                          <button onClick={() => cancelKling(selectedSceneIndex)} className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{vg.note || 'Rendering…'} (tap to cancel)</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleKlingGenerate(selectedSceneIndex)}
                            className="text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition shadow-md shadow-purple-600/30"
                          >
                            <Sparkles className="w-3.5 h-3.5" /><span>Generate with Kling</span>
                          </button>
                        )}
                      </div>
                      {vg.status === 'error' && (
                        <p className="text-xs text-red-400 flex items-start space-x-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{vg.error}</span></p>
                      )}
                      <p className="text-[10px] text-slate-500">
                        Kling renders 5s or 10s clips — the export loops the clip to fill this {scene.duration.toFixed(1)}s scene.
                        {scene.klingMode !== 'text' && !scene.keyframeImageUrl && ' Generate the keyframe still first.'}
                        {!falKey.trim() && ' Add your fal.ai key in the Timeline tab.'}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">or upload your own clip</span>
                        <label className="cursor-pointer text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition">
                          <Upload className="w-3.5 h-3.5" /><span>Choose video</span>
                          <input type="file" accept="video/*" className="hidden" onChange={(e) => handleClipUpload(selectedSceneIndex, e.target.files && e.target.files[0])} />
                        </label>
                        {scene.clipName && <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{scene.clipName}</span>}
                      </div>
                    </>
                  )}
                </div>

                {/* Scene prompts: B-roll / lip sync / image-to-video */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">B-roll prompt <span className="text-slate-500 font-normal">(atmosphere cutaway)</span></label>
                      <button onClick={() => copyText('broll', scene.brollPrompt || compileBrollPrompt(scene))} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center space-x-1 transition">
                        {copyFeedback === 'broll' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}<span>{copyFeedback === 'broll' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <textarea rows={3} value={scene.brollPrompt || compileBrollPrompt(scene)}
                      onChange={(e) => updateScene(selectedSceneIndex, { brollPrompt: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Lip sync prompt <span className="text-slate-500 font-normal">(close-up performance)</span></label>
                      <button onClick={() => copyText('lipsync', scene.lipsyncPrompt || compileLipSyncPrompt(scene))} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center space-x-1 transition">
                        {copyFeedback === 'lipsync' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}<span>{copyFeedback === 'lipsync' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <textarea rows={3} value={scene.lipsyncPrompt || compileLipSyncPrompt(scene)}
                      onChange={(e) => updateScene(selectedSceneIndex, { lipsyncPrompt: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Image → video prompt <span className="text-slate-500 font-normal">(what Kling animates)</span></label>
                      <button onClick={() => copyText('videop', scene.videoPrompt || compileVideoPrompt(scene))} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center space-x-1 transition">
                        {copyFeedback === 'videop' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}<span>{copyFeedback === 'videop' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <textarea rows={3} value={scene.videoPrompt || compileVideoPrompt(scene)}
                      onChange={(e) => updateScene(selectedSceneIndex, { videoPrompt: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500" />
                  </div>
                </div>

                {/* Trim */}
                <div className="p-4 bg-indigo-950/20 border border-indigo-900/50 rounded-xl space-y-3">
                  <div className="flex items-center space-x-2">
                    <Scissors className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Clip Trim & Assembly Offsets</h3>
                  </div>
                  <p className="text-[10px] text-slate-400">Trims the scene's clip inside this {scene.duration.toFixed(1)}s block — applied in the preview and the final export.</p>
                  <div className="grid grid-cols-2 gap-6 pt-2">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-300 mb-1">
                        <span>Start Trim</span><span className="font-mono text-cyan-400">{(scene.trimStart || 0).toFixed(1)}s</span>
                      </div>
                      <input type="range" min="0" max={scene.duration} step="0.1" value={scene.trimStart || 0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          updateScene(selectedSceneIndex, { trimStart: v, trimEnd: Math.max(v + 0.1, scene.trimEnd || scene.duration) });
                        }}
                        className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-300 mb-1">
                        <span>End Trim</span><span className="font-mono text-cyan-400">{(scene.trimEnd != null ? scene.trimEnd : scene.duration).toFixed(1)}s</span>
                      </div>
                      <input type="range" min="0" max={scene.duration} step="0.1" value={scene.trimEnd != null ? scene.trimEnd : scene.duration}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          updateScene(selectedSceneIndex, { trimEnd: v, trimStart: Math.min(v - 0.1, scene.trimStart || 0) });
                        }}
                        className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>
                </div>

                {/* Section tag + energy */}
                <div className="grid grid-cols-2 gap-4 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Section Tag</label>
                    <input type="text" value={scene.title}
                      onChange={(e) => updateScene(selectedSceneIndex, { title: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center">
                      <Zap className="w-3 h-3 mr-1" /> Intensity / Energy (1-10)
                    </label>
                    <input type="range" min="1" max="10" value={scene.energyLevel}
                      onChange={(e) => updateScene(selectedSceneIndex, { energyLevel: parseInt(e.target.value, 10) })}
                      className="w-full accent-amber-500 mt-1" />
                  </div>
                </div>

              </div>
            </div>
          );
        })()}

        {/* ================= ASSETS TAB ================= */}
        {activeTab === 'assets' && (
          <div className="space-y-5 animate-fadeIn">
            <h2 className="text-base font-bold text-white">Visual Continuity Engine</h2>
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">1. Characters / Actors</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {characters.map(char => (
                  <div key={char.id} className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl flex gap-3 shadow-lg">
                    <img src={char.imageUrl} alt={char.name} className="w-20 h-24 object-cover rounded-lg border border-slate-700 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">{char.name}</h4>
                      <p className="text-[11px] text-slate-300 line-clamp-2 mt-1">{char.face}</p>
                      <button
                        onClick={() => handleGenerateCharacterPortrait(char.id, `${char.face}, ${char.hair}, wearing ${char.outfit}`)}
                        disabled={generatingPortraitId === char.id}
                        className="mt-2 text-[10px] bg-indigo-600/30 hover:bg-indigo-600/50 disabled:opacity-50 border border-indigo-500/40 text-indigo-300 px-2 py-1 rounded flex items-center space-x-1 transition"
                      >
                        {generatingPortraitId === char.id ? (
                          <><RefreshCw className="w-3 h-3 animate-spin" /><span>Generating...</span></>
                        ) : (
                          <><Sparkles className="w-3 h-3" /><span>Re-Roll Portrait</span></>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">2. Locked Look</h3>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <p className="text-xs text-slate-300"><span className="text-slate-500 font-bold">Palette:</span> {lockedPalette.name}</p>
                <div className="flex gap-1.5">{lockedPalette.hexes.map(h => <span key={h} className="w-8 h-8 rounded-lg border border-slate-700" style={{ backgroundColor: h }} />)}</div>
                <p className="text-xs text-slate-300"><span className="text-slate-500 font-bold">Style:</span> {lockedStyle.name}</p>
                <p className="text-xs text-slate-300"><span className="text-slate-500 font-bold">World:</span> {lockedTheme.name}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Your project auto-saves in this browser. Re-upload your song after a reload — clips you attached need re-attaching too.</p>
          </div>
        )}

      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d14]/95 backdrop-blur-lg border-t border-slate-800 px-3 py-2 flex items-center justify-around">
        <button onClick={() => setActiveTab('timeline')} className={`flex flex-col items-center ${activeTab === 'timeline' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Sliders className="w-4 h-4 mb-0.5" /><span className="text-[10px]">Timeline</span>
        </button>
        <button onClick={() => setActiveTab('scenes')} className={`flex flex-col items-center ${activeTab === 'scenes' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Film className="w-4 h-4 mb-0.5" /><span className="text-[10px]">Scenes</span>
        </button>
        <button onClick={() => setActiveTab('assets')} className={`flex flex-col items-center ${activeTab === 'assets' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Sparkles className="w-4 h-4 mb-0.5" /><span className="text-[10px]">Assets</span>
        </button>
      </nav>

      {/* MASTER ASSEMBLY PREVIEW MODAL */}
      {showAssemblyModal && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full relative">

            {/* Export Render Overlay — REAL */}
            {isExporting && (
              <div className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
                {exportStatus.startsWith('Export failed') ? (
                  <AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
                ) : exportProgress < 100 ? (
                  <Cpu className="w-12 h-12 text-cyan-400 animate-pulse mb-4" />
                ) : (
                  <CheckCircle className="w-12 h-12 text-emerald-400 mb-4" />
                )}
                <h2 className="text-lg font-bold text-white mb-2">
                  {exportStatus.startsWith('Export failed') ? 'Export hit a snag' : 'Rendering Assembly...'}
                </h2>
                <p className="text-xs text-cyan-400 font-mono mb-6 break-words max-w-full">{exportStatus}</p>
                {!exportStatus.startsWith('Export failed') && (
                  <>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300 ease-out" style={{ width: `${exportProgress}%` }} />
                    </div>
                    <div className="text-xs text-slate-400 font-bold">{exportProgress}% Complete</div>
                  </>
                )}
                {exportStatus.startsWith('Export failed') && (
                  <button onClick={() => setIsExporting(false)} className="mt-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition">
                    Dismiss
                  </button>
                )}
              </div>
            )}

            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/50">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <MonitorPlay className="w-4 h-4 text-indigo-400" /><span>Master Assembly Preview</span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Your real song, scenes in order, trim offsets applied</p>
              </div>
              <button onClick={() => { pauseAudio(); setShowAssemblyModal(false); }} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 9:16 Preview */}
            <div className="relative w-full aspect-[9/16] bg-black overflow-hidden flex items-center justify-center">
              {activeAssemblySegment && (activeAssemblySegment.clipUrl || (activeAssemblySegment.videoGen && activeAssemblySegment.videoGen.url)) ? (
                <video
                  key={activeAssemblySegment.clipUrl || activeAssemblySegment.videoGen.url}
                  src={activeAssemblySegment.clipUrl || activeAssemblySegment.videoGen.url}
                  className="w-full h-full object-cover" muted playsInline loop autoPlay
                />
              ) : activeAssemblySegment && activeAssemblySegment.keyframeImageUrl ? (
                <img
                  src={activeAssemblySegment.keyframeImageUrl} alt="Clip Frame"
                  className="w-full h-full object-cover transition-transform duration-75"
                  style={{ transform: `scale(${1 + ((currentTime - activeAssemblySegment.startTime) + (activeAssemblySegment.trimStart || 0)) * 0.015})` }}
                />
              ) : (
                <div className="text-center p-6">
                  <Video className="w-12 h-12 text-slate-700 mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">No visual yet</p>
                  <p className="text-[10px] text-slate-600 mt-1">{activeAssemblySegment ? `Scene ${activeAssemblySegment.sceneNumber}` : ''}</p>
                </div>
              )}

              <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none drop-shadow-md">
                <div>
                  <div className="bg-black/60 backdrop-blur-sm text-white text-[10px] font-mono px-2 py-1 rounded border border-white/10 inline-block mb-1">
                    REC <span className="text-red-500 ml-1">●</span>
                  </div>
                  <br />
                  <div className="bg-black/60 backdrop-blur-sm text-amber-400 text-[11px] font-mono px-2 py-1 rounded border border-amber-500/20 inline-block">
                    {formatTime(currentTime)} / {audio ? formatTime(audio.duration).slice(0, 5) : '--:--'}
                  </div>
                </div>
                <div className="text-right flex flex-col items-end space-y-1">
                  <div className="bg-black/60 backdrop-blur-sm text-cyan-300 text-[10px] font-mono px-2 py-1 rounded border border-cyan-500/20 inline-block">
                    SCENE {activeAssemblySegment ? activeAssemblySegment.sceneNumber : '–'}
                  </div>
                  <div className="bg-black/60 backdrop-blur-sm text-slate-300 text-[9px] font-mono px-2 py-1 rounded border border-white/10 inline-block">
                    TRIM IN: {activeAssemblySegment ? (activeAssemblySegment.trimStart || 0).toFixed(1) : '0.0'}s
                  </div>
                </div>
              </div>

              {activeAssemblySegment && activeAssemblySegment.lyrics && (
                <div className="absolute bottom-6 left-4 right-4 text-center">
                  <span className="bg-black/70 backdrop-blur-md text-white text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg shadow-lg inline-block border border-white/10">
                    "{activeAssemblySegment.lyrics}"
                  </span>
                </div>
              )}
            </div>

            {/* Playback Controls & Export */}
            <div className="p-4 bg-slate-900 border-t border-slate-800">
              <div className="mb-4 relative w-full h-2 bg-slate-800 rounded-full cursor-pointer"
                onClick={(e) => {
                  if (!audio) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  seekTo(((e.clientX - rect.left) / rect.width) * audio.duration);
                }}>
                <div className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full" style={{ width: `${audio ? (currentTime / audio.duration) * 100 : 0}%` }} />
                {audio && segments.map(seg => (
                  <div key={seg.id} className="absolute top-0 w-0.5 h-full bg-slate-950" style={{ left: `${(seg.startTime / audio.duration) * 100}%` }} />
                ))}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={handleExportMP4}
                  disabled={!audio}
                  className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-cyan-400 px-3 py-2 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <DownloadCloud className="w-4 h-4" /><span>Export MP4</span>
                </button>
                <div className="flex items-center space-x-3">
                  <button onClick={() => seekTo(0)} className="text-slate-400 hover:text-white transition">
                    <FastForward className="w-4 h-4 rotate-180" />
                  </button>
                  <button
                    onClick={() => {
                      if (!audio) return;
                      if (isPlaying) { pauseAudio(); }
                      else {
                        if (currentTime >= audio.duration - 0.2) seekTo(0);
                        playRangeRef.current = { start: currentTime, end: audio.duration, loop: false };
                        audioRef.current.play().catch(() => {});
                        setIsPlaying(true);
                      }
                    }}
                    disabled={!audio}
                    className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition active:scale-95"
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-3 text-center">
                Export builds every scene for real with ffmpeg.wasm and mixes your uploaded song underneath — the MP4 that downloads is the finished video.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
