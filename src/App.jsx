import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, Sparkles, Copy, Check, Film, Music, Sliders, Download,
  ChevronRight, Clapperboard, Video, Scissors, Zap, X,
  MonitorPlay, FastForward, DownloadCloud, Cpu, CheckCircle, Upload,
  Mic, Clock, AlertTriangle, Loader2, Trash2, Plus, Wand2, FileAudio, BookOpen,
  Layers, Users, AudioLines, Palette,
} from 'lucide-react';

/* ============================== FREE TRANSCRIPTION ============================== */
// Lyric transcription runs free in Google Colab (open-source Whisper on a free GPU).
// The notebook lives in this repo; this link opens it directly in Colab.
const COLAB_TRANSCRIBE_URL = 'https://colab.research.google.com/github/Lkyer92-creator/dream-direct-create-studio/blob/main/song-transcriber.ipynb';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CORE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.js`;
const FFMPEG_WASM_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.wasm`;

const LS_PROJECT = 'ddc_studio_project_v1';
const LS_INDEX = 'ddc_projects_v1';
const LS_PROJECT_PREFIX = 'ddc_project_';
const LS_CHARACTERS = 'ddc_characters_v1';
const LS_LOOKS = 'ddc_looks_v1';

/* ============================== ON-DEVICE TRANSCRIPTION (free) ============================== */
// Whisper runs IN this browser via transformers.js — no API key, no server, no cost.
// First run downloads the tiny model once (~40MB, then cached). On a phone a full song
// takes several minutes; the free Colab notebook is the faster alternative.
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
let _transcriberPromise = null;
function getTranscriber(onStatus) {
  if (!_transcriberPromise) {
    _transcriberPromise = (async () => {
      if (onStatus) onStatus('Downloading speech model (one-time, ~40MB)…');
      const { pipeline } = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
      return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    })().catch((e) => { _transcriberPromise = null; throw e; });
  }
  return _transcriberPromise;
}

async function decodeTo16kMono(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('This browser cannot decode audio. Try Chrome on your phone.');
  const ctx = new AC();
  try {
    const buf = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf);
    const targetRate = 16000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audioBuffer.duration * targetRate)), targetRate);
    const src = offline.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } catch (e) {
    throw new Error('Could not read that audio file. Try an MP3 or WAV.');
  } finally {
    try { ctx.close(); } catch (e) { /* ignore */ }
  }
}

// Transcribe in 30s chunks so progress + cancel work on slow devices.
async function transcribeOnDevice(file, onStatus, isCancelled) {
  if (!file) throw new Error('Upload your song first.');
  const pcm16k = await decodeTo16kMono(file);
  const transcriber = await getTranscriber(onStatus);
  const CHUNK = 30 * 16000;
  const total = Math.max(1, Math.ceil(pcm16k.length / CHUNK));
  const segments = [];
  for (let i = 0; i < total; i++) {
    if (isCancelled && isCancelled()) return { cancelled: true };
    if (onStatus) onStatus(`Transcribing… part ${i + 1} of ${total} (keep this tab open)`);
    const slice = pcm16k.slice(i * CHUNK, (i + 1) * CHUNK);
    const out = await transcriber(slice, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    const offset = i * 30;
    const chunks = (out && out.chunks) || [];
    for (const c of chunks) {
      const t = c.timestamp || [0, 0];
      const text = String(c.text || '').trim();
      if (text) segments.push({ start: offset + t[0], end: offset + t[1], text });
    }
  }
  const text = segments.map((s) => s.text).join(' ').trim();
  if (!text) throw new Error('Could not hear any vocals — try the free Colab notebook instead, it uses the bigger model.');
  return { text, segments };
}

/* ============================== POLLINATIONS TEXT (free) ============================== */
async function pollinationsChat(messages) {
  const res = await fetch('https://text.pollinations.ai/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai', messages }),
  });
  if (!res.ok) throw new Error(`Pollinations text API failed (HTTP ${res.status}). Try again in a moment.`);
  let data = null;
  try { data = await res.json(); } catch (e) { throw new Error('Pollinations returned a bad response. Try again.'); }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('Pollinations returned an empty response. Try again.');
  return content;
}

// Pull {"theme","storyline"} JSON out of the model reply; fall back to raw text.
function parseThemeStoryline(content) {
  const m = String(content).match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && (j.theme || j.storyline)) {
        return { theme: String(j.theme || ''), storyline: String(j.storyline || '') };
      }
    } catch (e) { /* fall through */ }
  }
  return { theme: '', storyline: String(content).trim() };
}

/* ============================== INDEXEDDB AUDIO LIBRARY ============================== */
// Full-length songs persist here as blobs so projects can reuse them without re-uploading.
// localStorage can't hold multi-MB audio — IndexedDB can.
const IDB_DB = 'ddc-studio-audio';
const IDB_STORE = 'songs';
let _idbPromise = null;
function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
    } catch (e) { reject(e); }
  });
  return _idbPromise;
}
function idbStore(mode) {
  return idbOpen().then(db => db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
}
async function idbPutSong(song) {
  const s = await idbStore('readwrite');
  return new Promise((res, rej) => { const r = s.put(song); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
async function idbListSongs() {
  const s = await idbStore('readonly');
  return new Promise((res, rej) => {
    const r = s.getAll();
    r.onsuccess = () => res((r.result || []).map(x => ({ id: x.id, name: x.name, duration: x.duration, addedAt: x.addedAt })));
    r.onerror = () => rej(r.error);
  });
}
async function idbGetSong(id) {
  const s = await idbStore('readonly');
  return new Promise((res, rej) => { const r = s.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
async function idbDeleteSong(id) {
  const s = await idbStore('readwrite');
  return new Promise((res, rej) => { const r = s.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

/* ============================== INDEXEDDB SCENE IMAGES ============================== */
// Per-scene stills she uploads (Fooocus results) persist here as blobs so they survive
// reloads. Keyed `${projectId}:${sceneId}`.
const IDB_IMG_DB = 'ddc-studio-images';
const IDB_IMG_STORE = 'images';
let _idbImgPromise = null;
function idbImgOpen() {
  if (_idbImgPromise) return _idbImgPromise;
  _idbImgPromise = new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(IDB_IMG_DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_IMG_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
    } catch (e) { reject(e); }
  });
  return _idbImgPromise;
}
function idbImgStore(mode) {
  return idbImgOpen().then(db => db.transaction(IDB_IMG_STORE, mode).objectStore(IDB_IMG_STORE));
}
async function idbImgPut(rec) {
  const s = await idbImgStore('readwrite');
  return new Promise((res, rej) => { const r = s.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
async function idbImgGet(id) {
  const s = await idbImgStore('readonly');
  return new Promise((res, rej) => { const r = s.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
async function idbImgDelete(id) {
  const s = await idbImgStore('readwrite');
  return new Promise((res, rej) => { const r = s.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

// Shrink an uploaded portrait to a small JPEG data URL so it fits in localStorage.
function fileToPortraitDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 480;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
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
/* Editable section labels — the auto-guess from defaultTitle is only the starting value;
   she can override every segment from the Sections step. */
const SECTION_LABELS = [
  'Intro', 'Verse 1', 'Verse 1a', 'Verse 1b', 'Verse 2', 'Verse 3',
  'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Bridge', 'Break',
  'Instrumental', 'Interlude', 'Outro',
];
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

/* Director wizard steps: 1 Audio -> 2 Intervals -> 3 Sections -> 4 Theme ->
   5 Image prompts -> 6 Upload images -> 7 Storyboard review -> 8 Bible -> 9 Finished */
const DIRECTOR_STEPS = [
  { key: 'audio', label: 'Audio' },
  { key: 'intervals', label: 'Intervals' },
  { key: 'sections', label: 'Sections' },
  { key: 'theme', label: 'Theme' },
  { key: 'imgprompts', label: 'Img prompts' },
  { key: 'upload', label: 'Upload' },
  { key: 'storyboard', label: 'Storyboard' },
  { key: 'bible', label: 'Bible' },
  { key: 'finished', label: 'Finished' },
];

/* ============================== MAIN COMPONENT ============================== */
const SectionBadge = ({ title }) => {
  const lowerTitle = (title || '').toLowerCase();
  let colorClass = 'bg-slate-800 text-slate-300 border-slate-700';
  if (lowerTitle.includes('intro') || lowerTitle.includes('outro')) colorClass = 'bg-blue-950 text-blue-400 border-blue-800';
  else if (lowerTitle.includes('verse')) colorClass = 'bg-emerald-950 text-emerald-400 border-emerald-800';
  else if (lowerTitle.includes('chorus')) colorClass = 'bg-purple-950 text-purple-400 border-purple-800';
  else if (lowerTitle.includes('pre-chorus') || lowerTitle.includes('build')) colorClass = 'bg-fuchsia-950 text-fuchsia-400 border-fuchsia-800';
  else if (lowerTitle.includes('bridge') || lowerTitle.includes('solo')) colorClass = 'bg-amber-950 text-amber-400 border-amber-800';
  else if (lowerTitle.includes('break')) colorClass = 'bg-rose-950 text-rose-400 border-rose-800';
  else if (lowerTitle.includes('instrumental') || lowerTitle.includes('interlude')) colorClass = 'bg-teal-950 text-teal-400 border-teal-800';
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

/* ============================== PROJECTS (multi-project store) ============================== */
// One project = one complete music video: its own song, cast, scenes, storyboard, Bible.
function loadProjectRecord(id) {
  try {
    const raw = localStorage.getItem(LS_PROJECT_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveProjectRecord(rec) {
  try { localStorage.setItem(LS_PROJECT_PREFIX + rec.id, JSON.stringify(rec)); } catch (e) { /* non-fatal */ }
}
function seedCast() {
  return DEFAULT_CHARACTERS.map(c => ({ ...c }));
}
function defaultLook() {
  return { characterId: 'char-1', paletteId: 'pal-1', styleId: 'sty-1', themeId: 'thm-1' };
}
function blankRecord(id, name) {
  const now = Date.now();
  return {
    id, name, createdAt: now, updatedAt: now,
    project: { title: name, artist: '', intervalSeconds: 15, customSeconds: 20, themeText: '', storylineText: '' },
    lyricsText: '', scenes: [],
    audioSongId: null, audioName: '', audioDuration: 0,
    cast: seedCast(), look: defaultLook(),
  };
}
function writeIndex(index) {
  try { localStorage.setItem(LS_INDEX, JSON.stringify(index)); } catch (e) { /* non-fatal */ }
}
// First load: if no project index exists, migrate the old single saved project into "Project 1".
function initializeProjects() {
  let index = null;
  try { const raw = localStorage.getItem(LS_INDEX); index = raw ? JSON.parse(raw) : null; } catch (e) { index = null; }
  if (Array.isArray(index) && index.length) {
    index.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    let active = loadProjectRecord(index[0].id);
    if (!active) { active = blankRecord(index[0].id, index[0].name || 'Project 1'); saveProjectRecord(active); }
    return { index, activeId: index[0].id, active };
  }
  const old = loadSavedProject();
  const rec = blankRecord('p' + Date.now().toString(36), 'Project 1');
  if (old) {
    rec.project = {
      title: old.title || 'Untitled Single', artist: old.artist || '',
      intervalSeconds: old.intervalSeconds || 15, customSeconds: old.customSeconds || 20,
      themeText: old.themeText || '', storylineText: old.storylineText || '',
    };
    rec.lyricsText = old.lyricsText || '';
    rec.scenes = Array.isArray(old.scenes) ? old.scenes : [];
  }
  saveProjectRecord(rec);
  const idx = [{
    id: rec.id, name: rec.name, songTitle: rec.project.title, sceneCount: rec.scenes.length,
    lastOpened: Date.now(), createdAt: rec.createdAt, updatedAt: rec.updatedAt,
  }];
  writeIndex(idx);
  return { index: idx, activeId: rec.id, active: rec };
}
function loadCharacterPresets() {
  try {
    const raw = localStorage.getItem(LS_CHARACTERS);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (e) { /* fall through */ }
  return seedCast();
}
function loadLooks() {
  try {
    const raw = localStorage.getItem(LS_LOOKS);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) return arr;
  } catch (e) { /* fall through */ }
  return [];
}

export default function DDCDirectorStudio() {
  const [activeTab, setActiveTab] = useState('timeline');

  const bootRef = useRef(null);
  if (bootRef.current === null) bootRef.current = initializeProjects();
  const boot = bootRef.current;

  const [activeProject, setActiveProject] = useState({ id: boot.activeId, name: boot.active.name, createdAt: boot.active.createdAt });
  const [projectIndex, setProjectIndex] = useState(boot.index);

  const [project, setProject] = useState(boot.active.project);
  const [lyricsText, setLyricsText] = useState(boot.active.lyricsText || '');
  // Per-project cast + locked look — each video gets its own people and aesthetic.
  const [cast, setCast] = useState(Array.isArray(boot.active.cast) && boot.active.cast.length ? boot.active.cast : seedCast());
  const [look, setLook] = useState(boot.active.look || defaultLook());
  const [audioMeta, setAudioMeta] = useState({
    songId: boot.active.audioSongId || null,
    name: boot.active.audioName || '',
    duration: boot.active.audioDuration || 0,
  });

  // Real audio state
  const [audio, setAudio] = useState(null); // { name, url, duration, peaks }
  const [isDecoding, setIsDecoding] = useState(false);
  const [audioError, setAudioError] = useState('');
  const audioFileRef = useRef(null);
  const audioRef = useRef(null);
  const playRangeRef = useRef(null);

  // Global shared libraries (feed every project)
  const [characterPresets, setCharacterPresets] = useState(loadCharacterPresets);
  const [looks, setLooks] = useState(loadLooks);
  const [songLibrary, setSongLibrary] = useState([]);
  const [idbReady, setIdbReady] = useState(false);

  const [palettes] = useState(DEFAULT_PALETTES);
  const [styles] = useState(DEFAULT_STYLES);
  const [themes] = useState(DEFAULT_THEMES);

  const [segments, setSegments] = useState(Array.isArray(boot.active.scenes) ? boot.active.scenes : []);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [sortByEnergy, setSortByEnergy] = useState(false);

  const [copyFeedback, setCopyFeedback] = useState(null);

  // Director wizard state
  const [directorStep, setDirectorStep] = useState(1);
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [themeError, setThemeError] = useState('');
  const [loopEnabled, setLoopEnabled] = useState(true);

  // Playback state (driven by the real <audio> element)
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

  // On-device transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [transcribeError, setTranscribeError] = useState('');
  const transcribeCancelRef = useRef(false);

  // Master Assembly Modal + Export Engine
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const ffmpegRef = useRef(null);
  const canvasRef = useRef(null);
  const copyTimerRef = useRef(null);

  const [showCastPicker, setShowCastPicker] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [charForm, setCharForm] = useState(null); // null | {id?, name, face, hair, outfit, styleNotes, imageUrl}
  const [lookName, setLookName] = useState('');

  const charFallback = { id: 'char-fallback', name: 'Lead', face: 'lead performer', hair: '', outfit: 'stage outfit', imageUrl: '' };
  const lockedChar = cast.find(c => c.id === look.characterId) || cast[0] || charFallback;
  const lockedPalette = palettes.find(p => p.id === look.paletteId) || palettes[0];
  const lockedStyle = styles.find(s => s.id === look.styleId) || styles[0];
  const lockedTheme = themes.find(t => t.id === look.themeId) || themes[0];
  const locked = { char: lockedChar, palette: lockedPalette, style: lockedStyle, theme: lockedTheme };

  /* ------------------------- persistence (per active project) ------------------------- */
  const writeActiveProject = (p, lyrics, segs, castOv, lookOv, audioOv) => {
    const id = activeProject.id;
    if (!id) return;
    const cst = castOv || cast;
    const lk = lookOv || look;
    const am = audioOv || audioMeta;
    try {
      const scenes = (segs || segments).map(s => ({
        id: s.id, sceneNumber: s.sceneNumber, title: s.title,
        startTime: s.startTime, endTime: s.endTime, duration: s.duration,
        energyLevel: s.energyLevel, lyrics: s.lyrics,
        shotType: s.shotType, lipSyncEnabled: s.lipSyncEnabled,
        characterAction: s.characterAction, cameraAngle: s.cameraAngle,
        cameraMovement: s.cameraMovement, setting: s.setting, lightingMood: s.lightingMood,
        approvedPrompt: s.approvedPrompt, keyframeImageUrl: s.keyframeImageUrl,
        imageName: s.imageName || '', reviewStatus: s.reviewStatus || 'pending',
        brollPrompt: s.brollPrompt, lipsyncPrompt: s.lipsyncPrompt, videoPrompt: s.videoPrompt,
        biblePrompt: s.biblePrompt,
        videoGen: s.videoGen && s.videoGen.status === 'done' ? { status: 'done', url: s.videoGen.url } : { status: 'idle' },
        trimStart: s.trimStart, trimEnd: s.trimEnd,
      }));
      saveProjectRecord({
        id, name: activeProject.name, createdAt: activeProject.createdAt, updatedAt: Date.now(),
        project: {
          title: p.title, artist: p.artist,
          intervalSeconds: p.intervalSeconds, customSeconds: p.customSeconds,
          themeText: p.themeText || '', storylineText: p.storylineText || '',
        },
        lyricsText: lyrics, scenes,
        audioSongId: am.songId, audioName: am.name, audioDuration: am.duration,
        cast: cst, look: lk,
      });
      setProjectIndex(prev => {
        const next = prev.map(e => e.id === id
          ? { ...e, songTitle: p.title, sceneCount: (segs || segments).length, updatedAt: Date.now(), lastOpened: Date.now() }
          : e);
        writeIndex(next);
        return next;
      });
    } catch (e) { /* storage full or unavailable — non-fatal */ }
  };
  // Back-compat signature used across the app: persist(project, lyrics, segments)
  const persist = (nextProject, nextLyrics, nextSegments) => {
    writeActiveProject(nextProject, nextLyrics, nextSegments);
  };
  const writeCast = (c) => { setCast(c); writeActiveProject(project, lyricsText, segments, c, null, null); };
  const writeLook = (l) => { setLook(l); writeActiveProject(project, lyricsText, segments, null, l, null); };

  /* ------------------------- projects: open / new / rename / duplicate / delete ------------------------- */
  const openProject = async (id, saveFirst = true) => {
    if (id === activeProject.id) return;
    if (saveFirst) writeActiveProject(project, lyricsText, segments);
    const rec = loadProjectRecord(id);
    if (!rec) return;
    pauseAudio();
    if (audio && audio.url) { try { URL.revokeObjectURL(audio.url); } catch (e) {} }
    audioFileRef.current = null;
    setAudio(null);
    setActiveProject({ id: rec.id, name: rec.name, createdAt: rec.createdAt });
    setProject(rec.project);
    setLyricsText(rec.lyricsText || '');
    setSegments(Array.isArray(rec.scenes) ? rec.scenes : []);
    setCast(Array.isArray(rec.cast) && rec.cast.length ? rec.cast : seedCast());
    setLook(rec.look || defaultLook());
    const am = { songId: rec.audioSongId || null, name: rec.audioName || '', duration: rec.audioDuration || 0 };
    setAudioMeta(am);
    setSelectedSceneIndex(0);
    setDirectorStep(1);
    setCurrentTime(0);
    setShowCastPicker(false);
    setProjectIndex(prev => {
      const next = prev.map(e => e.id === id ? { ...e, lastOpened: Date.now() } : e);
      next.sort((a, b) => b.lastOpened - a.lastOpened);
      writeIndex(next);
      return next;
    });
    // Re-attach the project's song from the audio library if it's there.
    // Scenes already match it — no reslice, just restore playback.
    if (rec.audioSongId && idbReady) {
      try {
        const song = await idbGetSong(rec.audioSongId);
        if (song && song.blob) {
          const file = new File([song.blob], song.name, { type: song.blob.type || 'audio/mpeg' });
          loadAudioIntoSession(file, { songId: song.id, name: song.name, duration: song.duration, peaks: song.peaks }, false);
        }
      } catch (e) { /* song not in library — user can re-upload */ }
    }
    // Re-attach persisted scene stills.
    try {
      const hydrated = await hydrateSceneImages(rec.id, Array.isArray(rec.scenes) ? rec.scenes : []);
      if (hydrated !== rec.scenes) setSegments(hydrated);
    } catch (e) { /* non-fatal */ }
  };

  const createProject = (name) => {
    writeActiveProject(project, lyricsText, segments);
    const id = 'p' + Date.now().toString(36);
    const rec = blankRecord(id, (name || '').trim() || `Project ${projectIndex.length + 1}`);
    saveProjectRecord(rec);
    const entry = {
      id: rec.id, name: rec.name, songTitle: rec.project.title, sceneCount: 0,
      lastOpened: Date.now(), createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    };
    setProjectIndex(prev => { const next = [entry, ...prev]; writeIndex(next); return next; });
    pauseAudio();
    if (audio && audio.url) { try { URL.revokeObjectURL(audio.url); } catch (e) {} }
    audioFileRef.current = null;
    setAudio(null);
    setActiveProject({ id: rec.id, name: rec.name, createdAt: rec.createdAt });
    setProject(rec.project);
    setLyricsText('');
    setSegments([]);
    setCast(seedCast());
    setLook(defaultLook());
    setAudioMeta({ songId: null, name: '', duration: 0 });
    setSelectedSceneIndex(0);
    setDirectorStep(1);
    setCurrentTime(0);
    setShowCastPicker(false);
    setActiveTab('director');
  };

  const renameProject = (id, name) => {
    const clean = (name || '').trim() || 'Untitled project';
    if (id === activeProject.id) setActiveProject(prev => ({ ...prev, name: clean }));
    const rec = loadProjectRecord(id);
    if (rec) { rec.name = clean; rec.updatedAt = Date.now(); saveProjectRecord(rec); }
    setProjectIndex(prev => {
      const next = prev.map(e => e.id === id ? { ...e, name: clean, updatedAt: Date.now() } : e);
      writeIndex(next);
      return next;
    });
  };

  const duplicateProject = (id) => {
    writeActiveProject(project, lyricsText, segments);
    const rec = loadProjectRecord(id);
    if (!rec) return;
    const nid = 'p' + Date.now().toString(36);
    const copy = JSON.parse(JSON.stringify(rec));
    copy.id = nid;
    copy.name = rec.name + ' (copy)';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    saveProjectRecord(copy);
    const entry = {
      id: nid, name: copy.name, songTitle: copy.project.title, sceneCount: copy.scenes.length,
      lastOpened: Date.now(), createdAt: copy.createdAt, updatedAt: copy.updatedAt,
    };
    setProjectIndex(prev => { const next = [entry, ...prev]; writeIndex(next); return next; });
  };

  const deleteProject = (id) => {
    if (projectIndex.length <= 1) { window.alert('Keep at least one project — make a new one first if you want to delete this.'); return; }
    if (!window.confirm('Delete this project for good? This cannot be undone.')) return;
    const next = projectIndex.filter(e => e.id !== id);
    try { localStorage.removeItem(LS_PROJECT_PREFIX + id); } catch (e) {}
    writeIndex(next);
    setProjectIndex(next);
    if (id === activeProject.id) openProject(next[0].id, false);
  };

  /* ------------------------- audio library (IndexedDB) ------------------------- */
  const refreshSongLibrary = async () => {
    if (!idbReady) return;
    try {
      const list = await idbListSongs();
      list.sort((a, b) => b.addedAt - a.addedAt);
      setSongLibrary(list);
    } catch (e) { /* non-fatal */ }
  };

  const loadAudioIntoSession = (file, meta, doReslice = true) => {
    const url = URL.createObjectURL(file);
    if (audio && audio.url) { try { URL.revokeObjectURL(audio.url); } catch (e) {} }
    audioFileRef.current = file;
    setAudio({ name: meta.name, url, duration: meta.duration, peaks: meta.peaks });
    const am = { songId: meta.songId || null, name: meta.name, duration: meta.duration };
    setAudioMeta(am);
    setCurrentTime(0);
    // When re-attaching a project's own song (project switch / reload), the saved
    // scenes already match it — don't reslice, just restore playback.
    if (doReslice) reslice(meta.duration, currentInterval(), lyricsText, segments);
    return am;
  };

  const loadLibrarySong = async (id) => {
    try {
      const song = await idbGetSong(id);
      if (!song || !song.blob) { setAudioError('Could not load that song from the library.'); return; }
      pauseAudio();
      const file = new File([song.blob], song.name, { type: song.blob.type || 'audio/mpeg' });
      const am = loadAudioIntoSession(file, { songId: song.id, name: song.name, duration: song.duration, peaks: song.peaks });
      writeActiveProject(project, lyricsText, segments, null, null, am);
    } catch (e) { setAudioError('Could not load that song from the library.'); }
  };

  const addSongToLibrary = async (file) => {
    if (!file || !idbReady) return;
    try {
      const { duration, peaks } = await decodeAudioFile(file);
      await idbPutSong({ id: 's' + Date.now().toString(36), name: file.name, duration, peaks, addedAt: Date.now(), blob: file });
      refreshSongLibrary();
    } catch (e) { setAudioError(e.message || 'Could not add that song.'); }
  };

  const deleteLibrarySong = async (id) => {
    if (!window.confirm('Delete this song from your library? Projects using it will need it re-uploaded.')) return;
    try { await idbDeleteSong(id); } catch (e) {}
    refreshSongLibrary();
    if (audioMeta.songId === id) {
      const am = { songId: null, name: audioMeta.name, duration: audioMeta.duration };
      setAudioMeta(am);
      writeActiveProject(project, lyricsText, segments, null, null, am);
    }
  };

  // Boot the audio library; auto-load this project's song if it's stored.
  useEffect(() => {
    let cancelled = false;
    idbOpen().then(async () => {
      if (cancelled) return;
      setIdbReady(true);
      try {
        const list = await idbListSongs();
        if (!cancelled) { list.sort((a, b) => b.addedAt - a.addedAt); setSongLibrary(list); }
      } catch (e) { /* non-fatal */ }
      const sid = boot.active.audioSongId;
      if (sid && !cancelled) {
        try {
          const song = await idbGetSong(sid);
          if (song && song.blob && !cancelled) {
            const file = new File([song.blob], song.name, { type: song.blob.type || 'audio/mpeg' });
            loadAudioIntoSession(file, { songId: song.id, name: song.name, duration: song.duration, peaks: song.peaks }, false);
          }
        } catch (e) { /* song not in library — user can re-upload */ }
      }
      // Re-attach this project's persisted scene stills on boot.
      if (!cancelled) {
        try {
          const bootScenes = Array.isArray(boot.active.scenes) ? boot.active.scenes : [];
          const hydrated = await hydrateSceneImages(boot.active.id, bootScenes);
          if (!cancelled && hydrated !== bootScenes) setSegments(hydrated);
        } catch (e) { /* non-fatal */ }
      }
    }).catch(() => { if (!cancelled) setIdbReady(false); });
    return () => { cancelled = true; };
  }, []);

  /* ------------------------- project cast (per-project characters) ------------------------- */
  const addPresetToCast = (preset) => {
    if (cast.some(c => c.presetId === preset.id)) return;
    const copy = { ...preset, id: 'c' + Date.now().toString(36), presetId: preset.id };
    writeCast([...cast, copy]);
  };
  const removeFromCast = (charId) => {
    if (cast.length <= 1) return;
    if (!window.confirm('Remove this character from this project?')) return;
    const next = cast.filter(c => c.id !== charId);
    const l = look.characterId === charId ? { ...look, characterId: next[0].id } : look;
    setCast(next);
    setLook(l);
    writeActiveProject(project, lyricsText, segments, next, l, null);
  };
  const saveCastToLibrary = (char) => {
    if (characterPresets.some(p => p.name === char.name && p.face === char.face)) return;
    const preset = {
      id: 'ch' + Date.now().toString(36), name: char.name, face: char.face, hair: char.hair,
      outfit: char.outfit, styleNotes: char.styleNotes || '', imageUrl: char.imageUrl || '',
    };
    const next = [preset, ...characterPresets];
    setCharacterPresets(next);
    try { localStorage.setItem(LS_CHARACTERS, JSON.stringify(next)); } catch (e) {}
  };

  /* ------------------------- character presets (global library) ------------------------- */
  const savePresetForm = () => {
    if (!charForm || !charForm.name.trim()) return;
    let next;
    if (charForm.id) {
      next = characterPresets.map(p => p.id === charForm.id ? { ...p, ...charForm } : p);
    } else {
      next = [{
        id: 'ch' + Date.now().toString(36), name: charForm.name.trim(),
        face: charForm.face || '', hair: charForm.hair || '', outfit: charForm.outfit || '',
        styleNotes: charForm.styleNotes || '', imageUrl: charForm.imageUrl || '',
      }, ...characterPresets];
    }
    setCharacterPresets(next);
    try { localStorage.setItem(LS_CHARACTERS, JSON.stringify(next)); } catch (e) {}
    setCharForm(null);
  };
  const deletePreset = (id) => {
    if (!window.confirm('Delete this character preset?')) return;
    const next = characterPresets.filter(p => p.id !== id);
    setCharacterPresets(next);
    try { localStorage.setItem(LS_CHARACTERS, JSON.stringify(next)); } catch (e) {}
  };
  // "Use" drops the preset into the open project's cast and makes it the star.
  const usePreset = (preset) => {
    let c = cast.find(x => x.presetId === preset.id);
    let nextCast = cast;
    if (!c) {
      c = { ...preset, id: 'c' + Date.now().toString(36), presetId: preset.id };
      nextCast = [...cast, c];
      setCast(nextCast);
    }
    const l = { ...look, characterId: c.id };
    setLook(l);
    writeActiveProject(project, lyricsText, segments, nextCast, l, null);
  };
  /* ------------------------- saved looks (global style presets) ------------------------- */
  const saveCurrentLook = () => {
    const name = lookName.trim() || `Look ${looks.length + 1}`;
    const entry = {
      id: 'l' + Date.now().toString(36), name,
      paletteId: look.paletteId, styleId: look.styleId, themeId: look.themeId, characterId: look.characterId,
    };
    const next = [entry, ...looks];
    setLooks(next);
    try { localStorage.setItem(LS_LOOKS, JSON.stringify(next)); } catch (e) {}
    setLookName('');
  };
  const applyLook = (entry) => {
    const l = {
      paletteId: entry.paletteId, styleId: entry.styleId, themeId: entry.themeId,
      characterId: entry.characterId && cast.some(c => c.id === entry.characterId) ? entry.characterId : look.characterId,
    };
    writeLook(l);
  };
  const deleteLook = (id) => {
    if (!window.confirm('Delete this look?')) return;
    const next = looks.filter(x => x.id !== id);
    setLooks(next);
    try { localStorage.setItem(LS_LOOKS, JSON.stringify(next)); } catch (e) {}
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
  // Full DIY production prompt for the Bible: paste into Runway / Kling yourself.
  const compileBiblePrompt = (scene) => {
    const charLine = `Character: ${lockedChar.name} — ${lockedChar.face}, ${lockedChar.hair}, wearing ${lockedChar.outfit}.`;
    const sceneLine = `Scene (${scene.title}): ${scene.setting || lockedTheme.notes}. Action: ${scene.characterAction}.`;
    const camLine = `Camera angle: ${scene.cameraAngle}. Camera movement: ${scene.cameraMovement}.`;
    const lookLine = `Lighting and mood: ${scene.lightingMood}. Palette: [${lockedPalette.hexes.join(', ')}]. Style: ${lockedStyle.descriptor}.`;
    const syncLine = scene.lipSyncEnabled
      ? ` LIP SYNC DIRECTIONS: extreme close-up on the character's face, singing directly into the lens for the full shot — mouth and lip movements must visibly match the lyric being sung: "${scene.lyrics}". Keep the face centered, sharp, and in focus the entire time; subtle slow dolly-in, no cuts away from the face.`
      : '';
    const diyLine = ` Wardrobe continuity: same outfit (${lockedChar.outfit}) in every shot; keep the character's face identical across all scenes. Vertical 9:16, photorealistic cinematic music video. Lyric for this shot: "${scene.lyrics}".`;
    return `${charLine} ${sceneLine} ${camLine} ${lookLine}${syncLine}${diyLine}`;
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
        imageName: (p && p.imageName) || '',
        reviewStatus: (p && p.reviewStatus) || 'pending',
        brollPrompt: (p && p.brollPrompt) || '',
        lipsyncPrompt: (p && p.lipsyncPrompt) || '',
        videoPrompt: (p && p.videoPrompt) || '',
        biblePrompt: (p && p.biblePrompt) || '',
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
      // Every upload lands in the audio library too, so other projects can reuse it.
      let songId = null;
      if (idbReady) {
        songId = 's' + Date.now().toString(36);
        try {
          await idbPutSong({ id: songId, name: file.name, duration, peaks, addedAt: Date.now(), blob: file });
          refreshSongLibrary();
        } catch (e) { songId = null; }
      }
      const am = loadAudioIntoSession(file, { songId, name: file.name, duration, peaks });
      writeActiveProject(project, lyricsText, segments, null, null, am);
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

  /* ------------------------- Director: theme + storyline (Pollinations text) ------------------------- */
  const handleGenerateTheme = async () => {
    if (!segments.length) { setThemeError('Slice your song into intervals first (Step 2).'); return; }
    setIsGeneratingTheme(true);
    setThemeError('');
    try {
      const sceneList = segments
        .map(s => `${fmtClock(s.startTime)}–${fmtClock(s.endTime)} [${s.title}]: ${s.lyrics}`)
        .join('\n');
      const content = await pollinationsChat([
        {
          role: 'system',
          content: 'You are a music video director. Given a song\'s timestamped lyrics, invent one cohesive visual world for its music video. Reply with ONLY valid JSON: {"theme": "...", "storyline": "..."}. "theme": 3-5 sentences — visual style, color palette, mood, cinematography, wardrobe. Vivid and specific. "storyline": 4-6 sentences — the narrative arc of the video across the song, referencing the sections by name.',
        },
        {
          role: 'user',
          content: `Song: "${project.title}"${project.artist ? ` by ${project.artist}` : ''}. Duration: ${audio ? fmtClock(audio.duration) : 'unknown'}. ${segments.length} scenes.\n\nTimestamped lyrics:\n${sceneList}\n\nLocked look for reference — style: ${lockedStyle.name} (${lockedStyle.descriptor}); palette: ${lockedPalette.name} (${lockedPalette.mood}); character: ${lockedChar.name} — ${lockedChar.face}, ${lockedChar.hair}, wearing ${lockedChar.outfit}; world: ${lockedTheme.name} (${lockedTheme.notes}).`,
        },
      ]);
      const { theme, storyline } = parseThemeStoryline(content);
      const p = { ...project, themeText: theme, storylineText: storyline };
      setProject(p);
      persist(p, lyricsText, segments);
    } catch (e) {
      setThemeError(e.message || 'Theme generation failed.');
    } finally {
      setIsGeneratingTheme(false);
    }
  };

  /* ------------------------- Director: shared interval picker ------------------------- */
  const setIntervalChoice = (sec) => {
    const p = { ...project, intervalSeconds: sec };
    setProject(p);
    const iv = sec === 'custom' ? (parseFloat(p.customSeconds) || 15) : sec;
    if (audio) reslice(audio.duration, iv, lyricsText, segments);
    else persist(p, lyricsText, segments);
  };

  /* ------------------------- Director: Bible copy-all ------------------------- */
  const copyAllBible = () => {
    const text = segments.map(s => (
      `SCENE ${s.sceneNumber} — ${fmtClock(s.startTime)}–${fmtClock(s.endTime)} (${s.title})${s.lipSyncEnabled ? ' [LIP SYNC]' : ''}\n` +
      `Lyrics: ${s.lyrics}\n` +
      `Image: ${s.imageName || (s.keyframeImageUrl ? 'uploaded still' : '(no image uploaded yet)')}\n` +
      `Production prompt: ${s.biblePrompt || compileBiblePrompt(s)}`
    )).join('\n\n---\n\n');
    copyText('bible-all', text || 'No scenes yet.');
  };

  /* ------------------------- Director: copy ALL image prompts (paste into Fooocus) ------------------------- */
  const copyAllImagePrompts = () => {
    const text = segments.map(s => (
      `SCENE ${s.sceneNumber} — ${fmtClock(s.startTime)}–${fmtClock(s.endTime)} (${s.title})${s.lipSyncEnabled ? ' [LIP SYNC]' : ''}\n` +
      `Lyrics: ${s.lyrics}\n` +
      `Image prompt: ${s.approvedPrompt || compilePromptForScene(s)}`
    )).join('\n\n---\n\n');
    copyText('imgprompts-all', text || 'No scenes yet.');
  };

  /* ------------------------- On-device transcription (free) ------------------------- */
  const handleTranscribe = async () => {
    if (!audioFileRef.current) { setTranscribeError('Upload your song first.'); return; }
    transcribeCancelRef.current = false;
    setIsTranscribing(true);
    setTranscribeError('');
    setTranscribeStatus('Preparing audio…');
    try {
      const out = await transcribeOnDevice(audioFileRef.current,
        (s) => setTranscribeStatus(s),
        () => transcribeCancelRef.current);
      if (out.cancelled) { setTranscribeStatus('Cancelled.'); return; }
      // Lyrics text with timestamps
      const lines = out.segments.map((s) => `[${fmtClock(s.start)}] ${s.text}`);
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

  /* ------------------------- per-scene still upload (her Fooocus results) ------------------------- */
  const handleSceneImageUpload = async (index, file) => {
    if (!file) return;
    const scene = segments[index];
    if (!scene) return;
    if (scene.keyframeImageUrl && String(scene.keyframeImageUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(scene.keyframeImageUrl); } catch (e) {}
    }
    const url = URL.createObjectURL(file);
    updateScene(index, { keyframeImageUrl: url, imageName: file.name || 'uploaded still' });
    try {
      await idbImgPut({ id: `${activeProject.id}:${scene.id}`, blob: file, name: file.name || '', addedAt: Date.now() });
    } catch (e) { /* storage unavailable — image works in-session only */ }
  };
  const removeSceneImage = async (index) => {
    const scene = segments[index];
    if (!scene) return;
    if (scene.keyframeImageUrl && String(scene.keyframeImageUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(scene.keyframeImageUrl); } catch (e) {}
    }
    updateScene(index, { keyframeImageUrl: null, imageName: '' });
    try { await idbImgDelete(`${activeProject.id}:${scene.id}`); } catch (e) {}
  };
  // Re-attach persisted stills as object URLs (project open / app boot).
  // Scenes whose blob: URLs died without a stored blob get cleared.
  const hydrateSceneImages = async (projectId, scenes) => {
    let changed = false;
    const next = await Promise.all(scenes.map(async (s) => {
      try {
        const rec = await idbImgGet(`${projectId}:${s.id}`);
        if (rec && rec.blob) {
          changed = true;
          return { ...s, keyframeImageUrl: URL.createObjectURL(rec.blob), imageName: rec.name || s.imageName || '' };
        }
      } catch (e) { /* fall through */ }
      if (s.keyframeImageUrl && String(s.keyframeImageUrl).startsWith('blob:')) {
        changed = true;
        return { ...s, keyframeImageUrl: null, imageName: '' };
      }
      return s;
    }));
    return changed ? next : scenes;
  };

  /* ------------------------- REAL EXPORT (ffmpeg.wasm in-browser) ------------------------- */
  // Every scene becomes a 720x1280 h264 segment: your uploaded motion clip
  // (looped/trimmed to fill the scene) if you have one, otherwise
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

  /* ------------------------- Director wizard: unlock rules ------------------------- */
  const hasTheme = (project.themeText || '').trim().length > 0 || (project.storylineText || '').trim().length > 0;
  const directorUnlocked = (step) => {
    if (step <= 1) return true;
    if (step === 2) return !!audio;
    if (step === 3) return segments.length > 0;
    if (step === 4) return segments.length > 0;
    if (step === 9) return segments.length > 0 && !!audio;
    return hasTheme; // steps 5-8
  };
  const maxDirectorStep = DIRECTOR_STEPS.map((_, i) => i + 1).filter(directorUnlocked).length;
  const shownDirectorStep = Math.min(directorStep, Math.max(1, maxDirectorStep));

  const DirectorContinue = ({ next, children }) => (
    directorUnlocked(next) ? (
      <button
        onClick={() => setDirectorStep(next)}
        className="w-full text-sm font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-xl transition flex items-center justify-center space-x-2"
      >
        <span>{children || 'Continue'}</span>
        <ChevronRight className="w-4 h-4" />
      </button>
    ) : null
  );

  // Auto-advance out of Step 1 once a song is loaded
  useEffect(() => {
    if (activeTab === 'director' && directorStep === 1 && audio) setDirectorStep(2);
  }, [audio, activeTab, directorStep]);

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

            {/* Free transcription — Colab notebook */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center space-x-2">
                <Mic className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Free lyric transcription</h3>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                No API key, no cost. Open the notebook, upload your song, and get timestamped lyrics back in about a minute — then paste them into the Lyrics box below.
              </p>
              <a
                href={COLAB_TRANSCRIBE_URL}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center space-x-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition"
              >
                <span>Transcribe free in Colab ↗</span>
              </a>
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTranscribe}
                    disabled={isTranscribing || !audio}
                    className="text-xs font-bold bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
                  >
                    {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    <span>{isTranscribing ? 'Transcribing…' : 'Auto-transcribe (free)'}</span>
                  </button>
                  <a
                    href={COLAB_TRANSCRIBE_URL}
                    target="_blank" rel="noreferrer"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Faster: free Colab GPU ↗
                  </a>
                </div>
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
              {!isTranscribing && !transcribeStatus && (
                <p className="text-[10px] text-slate-500">Runs on your device — free, no key. A full song takes a few minutes on a phone.</p>
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

                  <label className="cursor-pointer w-full sm:w-auto bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition active:scale-95 flex-shrink-0">
                    <Upload className="w-3.5 h-3.5" /><span>{scene.keyframeImageUrl ? 'Replace still' : 'Upload still'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleSceneImageUpload(selectedSceneIndex, e.target.files && e.target.files[0]); e.target.value = ''; }} />
                  </label>
                </div>

                {scene.keyframeImageUrl ? (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono">9:16 Scene Still (your upload)</span>
                      <button onClick={() => removeSceneImage(selectedSceneIndex)} className="text-[10px] text-slate-400 hover:text-red-400 flex items-center space-x-1">
                        <Trash2 className="w-3 h-3" /><span>Remove</span>
                      </button>
                    </div>
                    <div className="relative aspect-[9/16] max-w-[190px] mx-auto rounded-lg overflow-hidden border border-slate-700 shadow-xl">
                      <img src={scene.keyframeImageUrl} alt={`Scene ${scene.sceneNumber} visual`} className="w-full h-full object-cover" />
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950 rounded-xl border border-dashed border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500">No still yet — upload your Fooocus image for this scene.</p>
                  </div>
                )}

                {/* Motion clip: your own upload */}
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
                      <p className="text-[10px] text-slate-500">
                        Upload your own motion clip — the export loops/trims it to fill this {scene.duration.toFixed(1)}s scene.
                      </p>
                      <div className="flex items-center gap-2">
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
                      <label className="text-xs font-bold text-slate-300">Image → video prompt <span className="text-slate-500 font-normal">(paste into Runway)</span></label>
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

        {/* ================= DIRECTOR TAB ================= */}
        {activeTab === 'director' && (
          <div className="space-y-5 animate-fadeIn">
            {/* Stepper */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 shadow-lg">
              <div className="flex items-center gap-1">
                {DIRECTOR_STEPS.map((st, i) => {
                  const n = i + 1;
                  const unlocked = directorUnlocked(n);
                  const isCurrent = shownDirectorStep === n;
                  const done = n < shownDirectorStep;
                  return (
                    <button
                      key={st.key}
                      disabled={!unlocked}
                      onClick={() => setDirectorStep(n)}
                      className="flex-1 flex flex-col items-center py-1.5 rounded-xl transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition ${isCurrent ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/30' : done ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {done ? <Check className="w-4 h-4" /> : n}
                      </span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider mt-1 ${isCurrent ? 'text-cyan-300' : 'text-slate-500'}`}>{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* STEP 1 — Audio + lyrics */}
            {shownDirectorStep === 1 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <FileAudio className="w-4 h-4 text-cyan-400" /><span>Step 1 — Your song</span>
                </h2>
                {!audio ? (
                  <label className="block cursor-pointer">
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleAudioFile(e.target.files && e.target.files[0])} />
                    <div className="border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-2xl p-8 text-center transition">
                      {isDecoding ? <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-2" /> : <FileAudio className="w-8 h-8 text-cyan-400 mx-auto mb-2" />}
                      <p className="text-sm font-bold text-white">{isDecoding ? 'Reading your audio…' : 'Upload your song'}</p>
                      <p className="text-[11px] text-slate-400 mt-1">MP3, WAV, M4A</p>
                    </div>
                  </label>
                ) : (
                  <div className="flex items-center justify-between flex-wrap gap-2 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                    <span className="text-xs font-bold text-white flex items-center space-x-2 min-w-0">
                      <Music className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      <span className="truncate">{audio.name}</span>
                      <span className="text-cyan-400 font-mono">· {formatTime(audio.duration).slice(0, 5)}</span>
                    </span>
                    <label className="cursor-pointer text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg flex items-center space-x-1.5 transition">
                      <Upload className="w-3.5 h-3.5" /><span>Swap song</span>
                      <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleAudioFile(e.target.files && e.target.files[0])} />
                    </label>
                  </div>
                )}
                {audioError && (
                  <p className="text-xs text-red-400 flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>{audioError}</span></p>
                )}
                {idbReady && songLibrary.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Or pick from your audio library</label>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {songLibrary.map(s => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{s.name}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{fmtClock(s.duration)}</p>
                          </div>
                          <button onClick={() => loadLibrarySong(s.id)} className="text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 rounded-lg transition flex-shrink-0 ml-2">Load</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Lyrics</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleTranscribe}
                        disabled={isTranscribing || !audio}
                        className="text-xs font-bold bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
                      >
                        {isTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        <span>{isTranscribing ? 'Transcribing…' : 'Auto-transcribe (free)'}</span>
                      </button>
                      <a
                        href={COLAB_TRANSCRIBE_URL}
                        target="_blank" rel="noreferrer"
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
                      >
                        Faster: free Colab GPU ↗
                      </a>
                    </div>
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
                  {!isTranscribing && !transcribeStatus && (
                    <p className="text-[10px] text-slate-500">Runs on your device — free, no key. A full song takes a few minutes on a phone.</p>
                  )}
                  <textarea
                    rows={5}
                    value={lyricsText}
                    onChange={(e) => { setLyricsText(e.target.value); persist(project, e.target.value, segments); }}
                    placeholder={'Paste your lyrics here — one line per line.\n[00:10] Timestamps like this are fine too.'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-fuchsia-500"
                  />
                </div>
                <DirectorContinue next={2}>Continue to intervals</DirectorContinue>
              </div>
            )}

            {/* STEP 2 — Timestamped intervals */}
            {shownDirectorStep === 2 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-cyan-400" /><span>Step 2 — Timestamped intervals</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {[10, 15, 20, 30].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => setIntervalChoice(sec)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${project.intervalSeconds === sec ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                    >
                      {sec}s
                    </button>
                  ))}
                  <button
                    onClick={() => setIntervalChoice('custom')}
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
                    ? `Covers the full ${formatTime(audio.duration).slice(0, 5)} → ${segments.length} interval${segments.length === 1 ? '' : 's'}, each carrying its lyric chunk.`
                    : 'Upload your song in Step 1 first.'}
                </p>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {segments.map((s) => (
                    <div key={s.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                      <div className="flex items-center space-x-2 mb-1 flex-wrap gap-y-1">
                        <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                        <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                        <SectionBadge title={s.title} />
                        {s.keyframeImageUrl && (
                          <span className="text-[9px] font-bold bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800">STILL</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 italic line-clamp-2">"{s.lyrics}"</p>
                    </div>
                  ))}
                </div>
                <DirectorContinue next={3}>Continue to sections</DirectorContinue>
              </div>
            )}

            {/* STEP 3 — Section labels */}
            {shownDirectorStep === 3 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Sliders className="w-4 h-4 text-cyan-400" /><span>Step 3 — Section labels</span>
                </h2>
                <p className="text-[10px] text-slate-500">
                  The auto-guess is just a starting point — set each interval to the real part of the song. Split verses get their own labels (Verse 1a, Verse 1b…).
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {segments.map((s, i) => {
                    const inList = SECTION_LABELS.includes(s.title);
                    return (
                      <div key={s.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                          <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                          <SectionBadge title={s.title} />
                        </div>
                        <p className="text-[11px] text-slate-400 italic line-clamp-1">"{s.lyrics}"</p>
                        <div className="flex gap-2">
                          <select
                            value={inList ? s.title : '__custom'}
                            onChange={(e) => { const v = e.target.value; if (v !== '__custom') updateScene(i, { title: v }); }}
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                          >
                            {SECTION_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                            <option value="__custom">Custom…</option>
                          </select>
                          <input
                            type="text"
                            value={s.title}
                            onChange={(e) => updateScene(i, { title: e.target.value })}
                            placeholder="Custom label"
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <DirectorContinue next={4}>Continue to theme</DirectorContinue>
              </div>
            )}

            {/* STEP 4 — Theme + storyline */}
            {shownDirectorStep === 4 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-400" /><span>Step 4 — Theme + storyline</span>
                </h2>
                <button
                  onClick={handleGenerateTheme}
                  disabled={isGeneratingTheme || !segments.length}
                  className="w-full text-sm font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl transition flex items-center justify-center space-x-2"
                >
                  {isGeneratingTheme ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  <span>{isGeneratingTheme ? 'Dreaming up your world…' : 'Generate theme + storyline (free)'}</span>
                </button>
                {themeError && (
                  <p className="text-xs text-red-400 flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>{themeError}</span></p>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Visual theme <span className="text-slate-600 normal-case">(style · palette · mood — editable)</span></label>
                  <textarea
                    rows={5}
                    value={project.themeText}
                    onChange={(e) => { const p = { ...project, themeText: e.target.value }; setProject(p); persist(p, lyricsText, segments); }}
                    placeholder="Hit generate — or write your own visual world here."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Storyline <span className="text-slate-600 normal-case">(the video's narrative arc — editable)</span></label>
                  <textarea
                    rows={6}
                    value={project.storylineText}
                    onChange={(e) => { const p = { ...project, storylineText: e.target.value }; setProject(p); persist(p, lyricsText, segments); }}
                    placeholder="Hit generate — or write your own storyline here."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <p className="text-[10px] text-slate-500">AI-drafted, free via Pollinations — rewrite anything. This guides every prompt and the Bible.</p>
                <DirectorContinue next={5}>Continue to image prompts</DirectorContinue>
              </div>
            )}

            {/* STEP 5 — Image prompts (prompt-only: copy into Fooocus) */}
            {shownDirectorStep === 5 && (
              <div className="space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" /><span>Step 5 — Image prompts</span>
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-1">One text-to-image prompt per scene. Copy them all, paste into your Fooocus notebook, generate.</p>
                  </div>
                  <button
                    onClick={copyAllImagePrompts}
                    disabled={!segments.length}
                    className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg flex items-center space-x-1.5 transition"
                  >
                    {copyFeedback === 'imgprompts-all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copyFeedback === 'imgprompts-all' ? 'Copied!' : 'Copy ALL image prompts'}</span>
                  </button>
                </div>
                {segments.map((s, i) => (
                  <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                      <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                      <SectionBadge title={s.title} />
                      {s.lipSyncEnabled && (
                        <span className="text-[9px] font-bold bg-fuchsia-950 text-fuchsia-300 px-1.5 py-0.5 rounded border border-fuchsia-800">LIP SYNC</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 italic">"{s.lyrics}"</p>
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Text-to-image prompt <span className="text-slate-600 normal-case">(Fooocus)</span></label>
                      <button
                        onClick={() => copyText('imgp-' + s.id, s.approvedPrompt || compilePromptForScene(s))}
                        className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-emerald-400 px-2 py-1 rounded flex items-center space-x-1 transition"
                      >
                        {copyFeedback === ('imgp-' + s.id) ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copyFeedback === ('imgp-' + s.id) ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={s.approvedPrompt || compilePromptForScene(s)}
                      onChange={(e) => updateScene(i, { approvedPrompt: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                ))}
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <DirectorContinue next={6}>Continue to upload</DirectorContinue>
              </div>
            )}

            {/* STEP 6 — Upload your images */}
            {shownDirectorStep === 6 && (
              <div className="space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
                  <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Upload className="w-4 h-4 text-cyan-400" /><span>Step 6 — Upload your images</span>
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-1">Drop in your Fooocus results — one image per scene. They save in the app, so they survive reloads.</p>
                </div>
                {segments.map((s, i) => (
                  <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex items-center gap-3">
                    <div className="w-20 flex-shrink-0">
                      {s.keyframeImageUrl ? (
                        <img src={s.keyframeImageUrl} alt={'Scene ' + s.sceneNumber} className="w-full aspect-[9/16] object-cover rounded-lg border border-slate-700" />
                      ) : (
                        <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center">
                          <span className="text-[9px] text-slate-600 text-center px-2">No image yet</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                        <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                        <SectionBadge title={s.title} />
                      </div>
                      {s.imageName ? <p className="text-[10px] text-slate-500 mt-1 truncate">{s.imageName}</p> : null}
                      <div className="flex gap-2 mt-2">
                        <label className="cursor-pointer text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 rounded-lg flex items-center space-x-1 transition">
                          <Upload className="w-3 h-3" /><span>{s.keyframeImageUrl ? 'Replace' : 'Upload image'}</span>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleSceneImageUpload(i, e.target.files && e.target.files[0]); e.target.value = ''; }} />
                        </label>
                        {s.keyframeImageUrl && (
                          <button onClick={() => removeSceneImage(i)} className="text-[10px] text-slate-400 hover:text-red-400 flex items-center space-x-1">
                            <Trash2 className="w-3 h-3" /><span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <DirectorContinue next={7}>Continue to storyboard</DirectorContinue>
              </div>
            )}

            {/* STEP 7 — Storyboard review */}
            {shownDirectorStep === 7 && (
              <div className="space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
                  <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Film className="w-4 h-4 text-emerald-400" /><span>Step 7 — Storyboard review</span>
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-1">See what each scene will look like. Approve it, veto it, or edit the video concept — your call on every scene.</p>
                </div>
                {segments.map((s, i) => {
                  const status = s.reviewStatus || 'pending';
                  return (
                    <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                        <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                        <SectionBadge title={s.title} />
                        {s.lipSyncEnabled && (
                          <span className="text-[9px] font-bold bg-fuchsia-950 text-fuchsia-300 px-1.5 py-0.5 rounded border border-fuchsia-800">LIP SYNC</span>
                        )}
                        {status === 'approved' && (
                          <span className="text-[9px] font-bold bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800">APPROVED ✓</span>
                        )}
                        {status === 'vetoed' && (
                          <span className="text-[9px] font-bold bg-red-950 text-red-300 px-1.5 py-0.5 rounded border border-red-800">VETOED ✕</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 italic">"{s.lyrics}"</p>
                      <div className="flex gap-3">
                        <div className="w-28 flex-shrink-0">
                          {s.keyframeImageUrl ? (
                            <img src={s.keyframeImageUrl} alt={'Scene ' + s.sceneNumber} className="w-full aspect-[9/16] object-cover rounded-lg border border-slate-700" />
                          ) : (
                            <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center">
                              <span className="text-[9px] text-slate-600 text-center px-2">No image — upload in Step 6</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <label className="text-[10px] uppercase font-bold text-slate-400">Video concept <span className="text-slate-600 normal-case">(for your video generator)</span></label>
                          <textarea
                            rows={4}
                            value={s.videoPrompt || compileVideoPrompt(s)}
                            onChange={(e) => updateScene(i, { videoPrompt: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateScene(i, { reviewStatus: status === 'approved' ? 'pending' : 'approved' })}
                              className={'text-[10px] font-bold px-3 py-1.5 rounded-lg border flex items-center space-x-1 transition ' + (status === 'approved' ? 'bg-emerald-600/40 border-emerald-500 text-emerald-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-700')}
                            >
                              <Check className="w-3 h-3" /><span>{status === 'approved' ? 'Approved ✓' : 'Approve'}</span>
                            </button>
                            <button
                              onClick={() => updateScene(i, { reviewStatus: status === 'vetoed' ? 'pending' : 'vetoed' })}
                              className={'text-[10px] font-bold px-3 py-1.5 rounded-lg border flex items-center space-x-1 transition ' + (status === 'vetoed' ? 'bg-red-600/40 border-red-500 text-red-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-700')}
                            >
                              <X className="w-3 h-3" /><span>{status === 'vetoed' ? 'Vetoed ✕' : 'Veto'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <DirectorContinue next={8}>Continue to the Bible</DirectorContinue>
              </div>
            )}

            {/* STEP 8 — The Bible: image, then prompt, per scene */}
            {shownDirectorStep === 8 && (
              <div className="space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" /><span>Step 8 — The Bible</span>
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-1">Image, then prompt, scene by scene — copy each prompt straight into your video generator.</p>
                  </div>
                  <button
                    onClick={copyAllBible}
                    disabled={!segments.length}
                    className="text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg flex items-center space-x-1.5 transition"
                  >
                    {copyFeedback === 'bible-all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copyFeedback === 'bible-all' ? 'Copied!' : 'Copy all prompts'}</span>
                  </button>
                </div>
                {segments.map((s, i) => (
                  <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                      <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                      <SectionBadge title={s.title} />
                      {s.lipSyncEnabled && (
                        <span className="text-[9px] font-bold bg-fuchsia-950 text-fuchsia-300 px-1.5 py-0.5 rounded border border-fuchsia-800">LIP SYNC</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300"><span className="text-slate-500 font-bold">Lyrics: </span><span className="italic">"{s.lyrics}"</span></p>
                    <div className="max-w-[220px]">
                      {s.keyframeImageUrl ? (
                        <img src={s.keyframeImageUrl} alt={'Scene ' + s.sceneNumber + ' visual'} className="w-full aspect-[9/16] object-cover rounded-xl border border-slate-700" />
                      ) : (
                        <div className="w-full aspect-[9/16] rounded-xl border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center">
                          <span className="text-[9px] text-slate-600 text-center px-2">No image — upload in Step 6</span>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Production prompt <span className="text-slate-600 normal-case">(your video generator)</span></label>
                      <button
                        onClick={() => copyText('bible-' + s.id, s.biblePrompt || compileBiblePrompt(s))}
                        className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2 py-1 rounded flex items-center space-x-1 transition"
                      >
                        {copyFeedback === ('bible-' + s.id) ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copyFeedback === ('bible-' + s.id) ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={s.biblePrompt || compileBiblePrompt(s)}
                      onChange={(e) => updateScene(i, { biblePrompt: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                ))}
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <DirectorContinue next={9}>Continue to finished video</DirectorContinue>
              </div>
            )}

            {/* STEP 9 — Finished video */}
            {shownDirectorStep === 9 && (
              <div className="space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
                  <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Clapperboard className="w-4 h-4 text-cyan-400" /><span>Step 9 — Finished video</span>
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Attach one motion clip per scene. Each clip is auto-placed at its scene timestamp, trimmed or looped to fill the interval, then your song is mixed underneath.
                  </p>
                </div>
                {segments.map((s, i) => {
                  const hasClip = !!(s.clipUrl || (s.videoGen && s.videoGen.url));
                  return (
                    <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex items-center gap-3">
                      <div className="w-16 flex-shrink-0">
                        {s.keyframeImageUrl ? (
                          <img src={s.keyframeImageUrl} alt={`Scene ${s.sceneNumber}`} className="w-full aspect-[9/16] object-cover rounded-lg border border-slate-700" />
                        ) : (
                          <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-slate-700 bg-slate-950" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="text-[10px] font-black text-slate-300">Scene {s.sceneNumber}</span>
                          <span className="text-[11px] font-mono text-cyan-400">{fmtClock(s.startTime)}–{fmtClock(s.endTime)}</span>
                          {hasClip ? (
                            <span className="text-[9px] font-bold bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800">CLIP ✓</span>
                          ) : (
                            <span className="text-[9px] font-bold bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700">no clip</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                          "{s.lyrics}" · trim {(s.trimStart || 0).toFixed(1)}s–{(s.trimEnd != null ? s.trimEnd : s.duration).toFixed(1)}s (fine-tune in Scenes)
                        </p>
                      </div>
                      {hasClip ? (
                        <button onClick={() => { removeClip(i); updateScene(i, { videoGen: { status: 'idle' } }); }} className="text-[10px] text-slate-400 hover:text-red-400 flex items-center space-x-1 flex-shrink-0">
                          <Trash2 className="w-3 h-3" /><span>Remove</span>
                        </button>
                      ) : (
                        <label className="cursor-pointer text-[10px] font-bold bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-300 px-2 py-1.5 rounded-lg flex items-center space-x-1 transition flex-shrink-0">
                          <Upload className="w-3 h-3" /><span>Clip</span>
                          <input type="file" accept="video/*" className="hidden" onChange={(e) => handleClipUpload(i, e.target.files && e.target.files[0])} />
                        </label>
                      )}
                    </div>
                  );
                })}
                {!segments.length && (
                  <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    No scenes yet — start at Step 1 with your song.
                  </p>
                )}
                <button
                  onClick={handleExportMP4}
                  disabled={!audio || !segments.length}
                  className="w-full text-sm font-bold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl transition flex items-center justify-center space-x-2"
                >
                  <DownloadCloud className="w-4 h-4" /><span>Export finished MP4</span>
                </button>
                <p className="text-[10px] text-slate-500 text-center">Clips and your song live in memory — re-attach them after a reload before exporting.</p>
              </div>
            )}
          </div>
        )}

        {/* ================= PROJECTS TAB ================= */}
        {activeTab === 'projects' && (
          <div className="space-y-4 animate-fadeIn">
            <h2 className="text-base font-bold text-white">Projects</h2>
            <div className="flex gap-2">
              <input
                type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New video name…" onKeyDown={(e) => { if (e.key === 'Enter') { createProject(newProjectName); setNewProjectName(''); } }}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
              <button onClick={() => { createProject(newProjectName); setNewProjectName(''); }} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-xl flex items-center space-x-1.5 transition">
                <Plus className="w-3.5 h-3.5" /><span>New</span>
              </button>
            </div>
            <div className="space-y-2.5">
              {projectIndex.map(entry => (
                <div key={entry.id} className={`p-3.5 rounded-2xl border transition ${entry.id === activeProject.id ? 'bg-cyan-950/30 border-cyan-800' : 'bg-slate-900/80 border-slate-800'}`}>
                  {renamingId === entry.id ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { renameProject(entry.id, renameValue); setRenamingId(null); } }}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                      />
                      <button onClick={() => { renameProject(entry.id, renameValue); setRenamingId(null); }} className="text-xs font-bold bg-cyan-600 text-white px-3 py-2 rounded-lg">Save</button>
                      <button onClick={() => setRenamingId(null)} className="text-xs font-bold bg-slate-800 text-slate-300 px-3 py-2 rounded-lg">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {entry.name}
                            {entry.id === activeProject.id && <span className="text-[9px] font-bold bg-cyan-600 text-white px-1.5 py-0.5 rounded ml-1.5">OPEN</span>}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {entry.songTitle || 'Untitled'} · {entry.sceneCount} scene{entry.sceneCount === 1 ? '' : 's'} · opened {new Date(entry.lastOpened).toLocaleDateString()}
                          </p>
                        </div>
                        {entry.id !== activeProject.id && (
                          <button onClick={() => openProject(entry.id)} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-3.5 py-2 rounded-lg transition flex-shrink-0">Open</button>
                        )}
                      </div>
                      <div className="flex gap-1.5 mt-2.5">
                        <button onClick={() => { setRenamingId(entry.id); setRenameValue(entry.name); }} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg transition">Rename</button>
                        <button onClick={() => duplicateProject(entry.id)} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg transition">Duplicate</button>
                        <button onClick={() => deleteProject(entry.id)} className="text-[10px] font-bold bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg transition">Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">Each project is one complete music video — its own song, cast, scenes, storyboard, Bible, and finished video. Everything auto-saves in this browser.</p>
          </div>
        )}

        {/* ================= CHARACTERS TAB (global preset library) ================= */}
        {activeTab === 'characters' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Character library</h2>
              <button onClick={() => setCharForm({ name: '', face: '', hair: '', outfit: '', styleNotes: '', imageUrl: '' })} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-3.5 py-2 rounded-xl flex items-center space-x-1.5 transition">
                <Plus className="w-3.5 h-3.5" /><span>New</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500">Preset actors shared across all your videos. <span className="text-cyan-400 font-bold">Use</span> drops one into the open project as its star.</p>
            {charForm && (
              <div className="bg-slate-900/80 border border-cyan-900 rounded-2xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">{charForm.id ? 'Edit character' : 'New character'}</h3>
                {[['name', 'Name'], ['face', 'Face'], ['hair', 'Hair'], ['outfit', 'Outfit'], ['styleNotes', 'Style notes']].map(([k, label]) => (
                  <div key={k}>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">{label}</label>
                    <input
                      type="text" value={charForm[k]} onChange={(e) => setCharForm({ ...charForm, [k]: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Portrait <span className="text-slate-600 normal-case">(optional — upload your own)</span></label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text" value={charForm.imageUrl} onChange={(e) => setCharForm({ ...charForm, imageUrl: e.target.value })}
                      placeholder="https://… or upload →" className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    />
                    <label className="cursor-pointer text-[10px] font-bold bg-indigo-600/40 hover:bg-indigo-600/60 border border-indigo-500/40 text-indigo-200 px-2.5 py-2 rounded-lg transition flex-shrink-0 flex items-center space-x-1">
                      <Upload className="w-3 h-3" /><span>Upload</span>
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files && e.target.files[0];
                          e.target.value = '';
                          if (!f) return;
                          try {
                            const url = await fileToPortraitDataUrl(f);
                            setCharForm((prev) => prev ? { ...prev, imageUrl: url } : prev);
                          } catch (err) { /* non-fatal */ }
                        }}
                      />
                    </label>
                  </div>
                  {charForm.imageUrl ? <img src={charForm.imageUrl} alt="" className="w-20 h-24 object-cover rounded-lg border border-slate-700 mt-2" /> : null}
                </div>
                <div className="flex gap-2">
                  <button onClick={savePresetForm} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg transition">Save</button>
                  <button onClick={() => setCharForm(null)} className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg transition">Cancel</button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {characterPresets.map(p => (
                <div key={p.id} className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl flex gap-3">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-20 h-24 object-cover rounded-lg border border-slate-700 flex-shrink-0" />
                  ) : (
                    <div className="w-20 h-24 rounded-lg bg-slate-800 border border-slate-700 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-white truncate">{p.name}</h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">{p.face}{p.hair ? ` · ${p.hair}` : ''}</p>
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{p.outfit}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button onClick={() => usePreset(p)} className="text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1 rounded transition">Use</button>
                      <button onClick={() => setCharForm({ ...p })} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition">Edit</button>
                      <button onClick={() => deletePreset(p.id)} className="text-[10px] bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-300 px-2 py-1 rounded transition">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= AUDIO TAB (song library) ================= */}
        {activeTab === 'audio' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Audio library</h2>
              <label className={`cursor-pointer text-xs font-bold text-white px-3.5 py-2 rounded-xl flex items-center space-x-1.5 transition ${idbReady ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-slate-800 opacity-50'}`}>
                <Upload className="w-3.5 h-3.5" /><span>Add song</span>
                <input
                  type="file" accept="audio/*" className="hidden" disabled={!idbReady}
                  onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) addSongToLibrary(f); e.target.value = ''; }}
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-500">
              {idbReady
                ? 'Full-length songs live here — load any of them into the open project without re-uploading.'
                : 'Song storage is unavailable in this browser — uploads still work in-session.'}
            </p>
            {audioError && (
              <p className="text-xs text-red-400 flex items-center space-x-1.5"><AlertTriangle className="w-3.5 h-3.5" /><span>{audioError}</span></p>
            )}
            <div className="space-y-2">
              {songLibrary.map(s => (
                <div key={s.id} className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${audioMeta.songId === s.id ? 'bg-cyan-950/30 border-cyan-800' : 'bg-slate-900/80 border-slate-800'}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {s.name}
                      {audioMeta.songId === s.id && <span className="text-[9px] font-bold bg-cyan-600 text-white px-1.5 py-0.5 rounded ml-1.5">IN PROJECT</span>}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">{fmtClock(s.duration)} · added {new Date(s.addedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => loadLibrarySong(s.id)} className="text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 rounded-lg transition">Load into project</button>
                    <button onClick={() => deleteLibrarySong(s.id)} className="text-[10px] font-bold bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg transition">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {idbReady && songLibrary.length === 0 && (
                <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                  No songs yet — every song you upload anywhere in the app lands here automatically.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ================= LOOKS TAB (saved style presets) ================= */}
        {activeTab === 'looks' && (
          <div className="space-y-4 animate-fadeIn">
            <h2 className="text-base font-bold text-white">Saved looks</h2>
            <p className="text-[10px] text-slate-500">Capture this project's locked look — palette, style, world — and apply it to any video in one tap.</p>
            <div className="flex gap-2">
              <input
                type="text" value={lookName} onChange={(e) => setLookName(e.target.value)}
                placeholder="Look name…" onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentLook(); }}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
              <button onClick={saveCurrentLook} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-xl flex items-center space-x-1.5 transition">
                <Plus className="w-3.5 h-3.5" /><span>Save current</span>
              </button>
            </div>
            <div className="space-y-2.5">
              {looks.map(entry => {
                const pal = palettes.find(p => p.id === entry.paletteId) || palettes[0];
                const sty = styles.find(s => s.id === entry.styleId);
                const thm = themes.find(t => t.id === entry.themeId);
                return (
                  <div key={entry.id} className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-2xl">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white truncate">{entry.name}</p>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button onClick={() => applyLook(entry)} className="text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 rounded-lg transition">Apply</button>
                        <button onClick={() => deleteLook(entry.id)} className="text-[10px] font-bold bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg transition">Delete</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex gap-1 flex-shrink-0">
                        {pal.hexes.map(h => <span key={h} className="w-6 h-6 rounded-md border border-slate-700" style={{ backgroundColor: h }} />)}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">{pal.name}{sty ? ` · ${sty.name}` : ''}{thm ? ` · ${thm.name}` : ''}</p>
                    </div>
                  </div>
                );
              })}
              {looks.length === 0 && (
                <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                  No saved looks yet — dial in a vibe on the Assets tab, then save it here.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ================= ASSETS TAB ================= */}
        {activeTab === 'assets' && (
          <div className="space-y-5 animate-fadeIn">
            <h2 className="text-base font-bold text-white">Visual Continuity Engine</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">1. This project's cast</h3>
                <button onClick={() => setShowCastPicker(!showCastPicker)} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg flex items-center space-x-1 transition">
                  <Plus className="w-3 h-3" /><span>{showCastPicker ? 'Close' : 'Pull from library'}</span>
                </button>
              </div>
              {showCastPicker && (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {characterPresets.filter(p => !cast.some(c => c.presetId === p.id)).map(p => (
                    <div key={p.id} className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-xl p-2">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} className="w-10 h-12 object-cover rounded-lg border border-slate-700 flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-12 rounded-lg bg-slate-800 border border-slate-700 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{p.face}</p>
                      </div>
                      <button onClick={() => addPresetToCast(p)} className="text-[10px] font-bold bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 rounded-lg transition flex-shrink-0">Add</button>
                    </div>
                  ))}
                  {characterPresets.filter(p => !cast.some(c => c.presetId === p.id)).length === 0 && (
                    <p className="text-[10px] text-slate-500">Everyone from your library is already in this cast. Make more on the Characters tab.</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {cast.map(char => (
                  <div key={char.id} className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-xl flex gap-3 shadow-lg">
                    {char.imageUrl ? (
                      <img src={char.imageUrl} alt={char.name} className="w-20 h-24 object-cover rounded-lg border border-slate-700 flex-shrink-0" />
                    ) : (
                      <div className="w-20 h-24 rounded-lg bg-slate-800 border border-slate-700 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-bold text-white truncate">{char.name}</h4>
                        {look.characterId === char.id && (
                          <span className="text-[9px] font-bold bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800 flex-shrink-0">ACTIVE</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-300 line-clamp-2 mt-1">{char.face}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <label className="cursor-pointer text-[10px] bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 px-2 py-1 rounded flex items-center space-x-1 transition">
                          <Upload className="w-3 h-3" /><span>Portrait</span>
                          <input
                            type="file" accept="image/*" className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files && e.target.files[0];
                              e.target.value = '';
                              if (!f) return;
                              try {
                                const url = await fileToPortraitDataUrl(f);
                                const next = cast.map(c => c.id === char.id ? { ...c, imageUrl: url } : c);
                                setCast(next);
                                writeActiveProject(project, lyricsText, segments, next, null, null);
                              } catch (err) { /* non-fatal */ }
                            }}
                          />
                        </label>
                        <button onClick={() => saveCastToLibrary(char)} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded flex items-center space-x-1 transition">
                          <Download className="w-3 h-3" /><span>Save to library</span>
                        </button>
                        {cast.length > 1 && (
                          <button onClick={() => removeFromCast(char.id)} className="text-[10px] bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-300 px-2 py-1 rounded flex items-center space-x-1 transition">
                            <Trash2 className="w-3 h-3" /><span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">2. Locked Look <span className="text-slate-600 normal-case">(this project)</span></h3>
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Star character</label>
                  <select value={look.characterId} onChange={(e) => writeLook({ ...look, characterId: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none">
                    {cast.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Palette</label>
                  <select value={look.paletteId} onChange={(e) => writeLook({ ...look, paletteId: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none">
                    {palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="flex gap-1.5 mt-2">{lockedPalette.hexes.map(h => <span key={h} className="w-8 h-8 rounded-lg border border-slate-700" style={{ backgroundColor: h }} />)}</div>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Style</label>
                  <select value={look.styleId} onChange={(e) => writeLook({ ...look, styleId: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none">
                    {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">World</label>
                  <select value={look.themeId} onChange={(e) => writeLook({ ...look, themeId: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-cyan-500 focus:outline-none">
                    {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Your project auto-saves in this browser. Re-upload your song after a reload — clips you attached need re-attaching too.</p>
          </div>
        )}

      </main>

      {/* MOBILE BOTTOM NAVIGATION — 8 tabs, scrollable on phones */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d14]/95 backdrop-blur-lg border-t border-slate-800 px-2 py-2 flex items-center gap-0.5 overflow-x-auto">
        {[
          { key: 'director', label: 'Director', Icon: Wand2 },
          { key: 'projects', label: 'Projects', Icon: Layers },
          { key: 'timeline', label: 'Timeline', Icon: Sliders },
          { key: 'scenes', label: 'Scenes', Icon: Film },
          { key: 'characters', label: 'Characters', Icon: Users },
          { key: 'audio', label: 'Audio', Icon: AudioLines },
          { key: 'looks', label: 'Looks', Icon: Palette },
          { key: 'assets', label: 'Assets', Icon: Sparkles },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex flex-col items-center flex-shrink-0 px-2.5 min-w-[58px] ${activeTab === key ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}
          >
            <Icon className="w-4 h-4 mb-0.5" /><span className="text-[9px] font-bold">{label}</span>
          </button>
        ))}
      </nav>

      {/* EXPORT OVERLAY — standalone so the Finished step can trigger it too */}
      {isExporting && (
        <div className="fixed inset-0 z-[70] bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
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
              <div className="w-full max-w-sm h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
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

      {/* MASTER ASSEMBLY PREVIEW MODAL */}
      {showAssemblyModal && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full relative">

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
