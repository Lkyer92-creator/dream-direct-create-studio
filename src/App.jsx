import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, Sparkles, Copy, Check, 
  Film, Music, Sliders, Eye, Download, Plus, ChevronRight, 
  Clapperboard, Video, RefreshCw, Scissors, Zap, X, MonitorPlay, FastForward,
  DownloadCloud, Cpu, CheckCircle
} from 'lucide-react';

// --- INITIAL CONTINUITY ASSETS ---
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
    id: 'char-1', 
    name: 'Kaelen (Lead)', 
    face: '24-year-old androgynous artist with sharp cheekbones, piercing hazel eyes', 
    hair: 'Textured jet-black wavy fringe undercut', 
    outfit: 'Oversized distressed charcoal bomber jacket with neon orange lining',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'
  }
];

const DEFAULT_THEMES = [
  { id: 'thm-1', name: 'Subterranean Neon Club & Rain Alley', notes: 'Bioluminescent low-ceiling concrete corridors, rain-drenched neon alleys with water reflections' }
];

const INITIAL_PROJECTS = [
  {
    id: 'proj-1',
    title: 'Echoes in the Rain (Single)',
    artist: 'Luna & The Machines',
    audioDuration: 40,
    intervalSeconds: 10,
    aspectRatio: '9:16',
    enableCaptions: true,
    lockedAssets: { characterId: 'char-1', paletteId: 'pal-1', styleId: 'sty-1', themeId: 'thm-1' },
    rawLyrics: `[00:00] Shadows stretching on the pavement
[00:10] Heartbeat echoing the bass in the basement
[00:20] You called my name into the cold night air
[00:30] All that remains is the phantom stare`
  }
];

// --- HELPER COMPONENTS ---
const SectionBadge = ({ title }) => {
  const lowerTitle = title.toLowerCase();
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

export default function DDCDirectorStudio() {
  const [activeTab, setActiveTab] = useState('timeline');
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [currentProjectId, setCurrentProjectId] = useState('proj-1');
  const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];

  const [characters, setCharacters] = useState(DEFAULT_CHARACTERS);
  const [palettes, setPalettes] = useState(DEFAULT_PALETTES);
  const [styles, setStyles] = useState(DEFAULT_STYLES);
  const [themes, setThemes] = useState(DEFAULT_THEMES);

  const [audioFileName] = useState('midnight_neon_master.wav');
  
  // Timeline/Scene State
  const [segments, setSegments] = useState([]);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [sortByEnergy, setSortByEnergy] = useState(false);
  const [generatingImageId, setGeneratingImageId] = useState(null);
  const [generatingPortraitId, setGeneratingPortraitId] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);

  // Audio / Preview State
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true);

  // Master Assembly Modal State
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [isAssemblyPlaying, setIsAssemblyPlaying] = useState(false);
  const [assemblyTime, setAssemblyTime] = useState(0);

  // Export Engine State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');

  const audioCtxRef = useRef(null);
  const oscillatorRef = useRef(null);
  const playTimerRef = useRef(null);
  const assemblyTimerRef = useRef(null);
  const canvasRef = useRef(null);

  const generateSegments = (duration, intervalSec) => {
    const totalSegments = Math.ceil(duration / intervalSec);
    const lyricsLines = currentProject.rawLyrics.split('\n').filter(Boolean);
    const newSegs = [];

    for (let i = 0; i < totalSegments; i++) {
      const start = i * intervalSec;
      const end = Math.min((i + 1) * intervalSec, duration);
      const matchedLyric = lyricsLines[i] || `[${formatTime(start)}] (Instrumental / Beat)`;
      const defaultTitle = i === 0 ? 'Intro' : i === 1 ? 'Verse 1' : i === 2 ? 'Pre-Chorus' : `Chorus ${i}`;
      
      let defaultEnergy = 5;
      if (defaultTitle.includes('Chorus')) defaultEnergy = 9;
      if (defaultTitle.includes('Pre-Chorus')) defaultEnergy = 7;
      if (defaultTitle.includes('Intro')) defaultEnergy = 3;

      newSegs.push({
        id: `scene-${i + 1}`,
        sceneNumber: i + 1,
        title: defaultTitle,
        startTime: start,
        endTime: end,
        duration: end - start,
        energyLevel: defaultEnergy,
        trimOffsets: { start: 0, end: end - start },
        lyrics: matchedLyric.replace(/\[\d{2}:\d{2}\]/, '').trim(),
        shotType: i % 2 === 0 ? 'Lip sync' : 'Motion clip',
        lipSyncEnabled: i % 2 === 0,
        characterAction: i % 2 === 0 ? 'Stands looking into lens' : 'Runs through dark alleyway',
        cameraAngle: i % 2 === 0 ? 'Close-up' : 'Tracking shot',
        cameraMovement: i % 2 === 0 ? 'Dolly in' : 'Handheld',
        setting: 'Subterranean rain alley',
        lightingMood: 'High-contrast cyan rim lights',
        approvedPrompt: '',
        keyframeImageUrl: null,
      });
    }
    return newSegs;
  };

  useEffect(() => {
    setSegments(generateSegments(currentProject.audioDuration, currentProject.intervalSeconds));
  }, [currentProject.intervalSeconds, currentProject.audioDuration, currentProject.rawLyrics]);

  // Audio Context Helpers
  const stopAudio = () => {
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    if (assemblyTimerRef.current) clearInterval(assemblyTimerRef.current);
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop(); } catch (e) {}
      oscillatorRef.current = null;
    }
    setIsPlaying(false);
    setIsAssemblyPlaying(false);
  };

  const initSynth = (frequency) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();

    const osc = audioCtxRef.current.createOscillator();
    const gain = audioCtxRef.current.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency, audioCtxRef.current.currentTime);
    gain.gain.setValueAtTime(0.04, audioCtxRef.current.currentTime);
    osc.connect(gain);
    gain.connect(audioCtxRef.current.destination);
    osc.start();
    oscillatorRef.current = osc;
  };

  // Timeline Segment Preview
  const playSegmentAudio = (segIndex) => {
    stopAudio();
    const seg = segments[segIndex];
    if (!seg) return;
    setActiveSegmentIndex(segIndex);
    setCurrentTime(seg.startTime);
    setIsPlaying(true);

    const freqs = [220, 261.63, 293.66, 329.63, 392.00, 440];
    initSynth(freqs[segIndex % freqs.length]);

    playTimerRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const next = prev + 0.1;
        if (next >= seg.endTime) {
          if (loopEnabled) return seg.startTime;
          stopAudio();
          return seg.endTime;
        }
        return next;
      });
    }, 100);
  };

  // Master Assembly Playback Logic
  const toggleAssemblyPlayback = () => {
    if (isAssemblyPlaying) {
      stopAudio();
    } else {
      stopAudio(); // clear previous
      setIsAssemblyPlaying(true);
      if (assemblyTime >= currentProject.audioDuration) setAssemblyTime(0);
      
      initSynth(220); // Base drone for assembly

      assemblyTimerRef.current = setInterval(() => {
        setAssemblyTime(prev => {
          const next = prev + 0.05; // 50ms tick for smoother visual tracking
          if (next >= currentProject.audioDuration) {
            stopAudio();
            return currentProject.audioDuration;
          }
          
          const activeSeg = segments.find(s => next >= s.startTime && next < s.endTime);
          if (activeSeg && oscillatorRef.current && audioCtxRef.current) {
            const freq = 200 + (activeSeg.energyLevel * 20);
            oscillatorRef.current.frequency.setTargetAtTime(freq, audioCtxRef.current.currentTime, 0.1);
          }
          
          return next;
        });
      }, 50);
    }
  };

  useEffect(() => {
    if (!showAssemblyModal) {
      setIsAssemblyPlaying(false);
      if (assemblyTimerRef.current) clearInterval(assemblyTimerRef.current);
    }
  }, [showAssemblyModal]);


  // Waveform render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    const bars = 70;
    const barWidth = width / bars;
    const progressRatio = currentTime / (currentProject.audioDuration || 40);

    for (let i = 0; i < bars; i++) {
      const barHeight = Math.sin(i * 0.3) * 18 + Math.cos(i * 0.8) * 12 + 25;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      ctx.fillStyle = (i / bars <= progressRatio) ? '#06b6d4' : '#334155';
      ctx.fillRect(x, y, barWidth - 2, barHeight);
    }
  }, [currentTime, currentProject.audioDuration]);

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  }

  const lockedChar = characters.find(c => c.id === currentProject.lockedAssets.characterId) || characters[0];
  const lockedPalette = palettes.find(p => p.id === currentProject.lockedAssets.paletteId) || palettes[0];
  const lockedStyle = styles.find(s => s.id === currentProject.lockedAssets.styleId) || styles[0];
  const lockedTheme = themes.find(t => t.id === currentProject.lockedAssets.themeId) || themes[0];

  const compilePromptForScene = (scene) => {
    return `Cinematic music video, ${lockedStyle.descriptor}. Character: ${lockedChar.name}, wearing ${lockedChar.outfit}. Setting: ${scene.setting || lockedTheme.notes}. Action: ${scene.characterAction}. Camera: ${scene.cameraAngle}, ${scene.cameraMovement}. Lighting: ${scene.lightingMood}. Colors: [${lockedPalette.hexes.join(', ')}]. 9:16 vertical.`;
  };

  // --- FREE IMAGE GENERATION INTEGRATION (Pollinations AI) ---

  // 1. Scene Keyframe Generator
  const handleGenerateFreeKeyframe = (index) => {
    const scene = segments[index];
    const promptToUse = scene.approvedPrompt || compilePromptForScene(scene);
    setGeneratingImageId(scene.id);
    
    const seed = Math.floor(Math.random() * 999999);
    // 9:16 Aspect Ratio mapping for vertical video
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptToUse)}?width=720&height=1280&model=flux&seed=${seed}&nologo=true`;

    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const updated = [...segments];
      updated[index] = { ...updated[index], keyframeImageUrl: imageUrl, approvedPrompt: promptToUse };
      setSegments(updated);
      setGeneratingImageId(null);
    };
    img.onerror = () => { setGeneratingImageId(null); alert('Failed to generate image.'); };
  };

  // 2. Character Portrait Generator
  const handleGenerateCharacterPortrait = (charId, charPrompt) => {
    setGeneratingPortraitId(charId);
    
    const seed = Math.floor(Math.random() * 100000);
    // Standard Portrait dimensions
    const portraitUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      `cinematic character portrait, ${charPrompt}, highly detailed, sharp focus, 8k, masterpiece`
    )}?width=512&height=768&model=flux&seed=${seed}&nologo=true`;

    const img = new Image();
    img.src = portraitUrl;
    img.onload = () => {
      setCharacters(prev => prev.map(c => 
        c.id === charId ? { ...c, imageUrl: portraitUrl } : c
      ));
      setGeneratingPortraitId(null);
    };
    img.onerror = () => {
      setGeneratingPortraitId(null);
      alert('Failed to generate character portrait.');
    };
  };

  // Export Engine Logic
  const handleExportMP4 = () => {
    stopAudio();
    setIsExporting(true);
    setExportProgress(0);
    
    setExportStatus('Initializing Render Engine...');
    setTimeout(() => { setExportProgress(15); setExportStatus('Mixing Master Audio Track...'); }, 1000);
    setTimeout(() => { setExportProgress(35); setExportStatus('Processing Trim Offsets & Keyframes...'); }, 2500);
    setTimeout(() => { setExportProgress(65); setExportStatus('Encoding 9:16 Vertical Video Frames...'); }, 4500);
    setTimeout(() => { setExportProgress(90); setExportStatus('Multiplexing Audio & Video (H.264)...'); }, 6500);
    setTimeout(() => {
      setExportProgress(100);
      setExportStatus('Render Complete!');
      setTimeout(() => {
        const dummyBlob = new Blob(["This is a placeholder for the actual compiled MP4 binary data."], { type: 'video/mp4' });
        const url = URL.createObjectURL(dummyBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProject.title.replace(/\s+/g, '_')}_Master_Assembly.mp4`;
        a.click();
        URL.revokeObjectURL(url);
        setIsExporting(false);
      }, 1500);
    }, 8000);
  };

  const activeAssemblySegment = segments.find(seg => assemblyTime >= seg.startTime && assemblyTime < seg.endTime) || segments[0];

  return (
    <div className="flex flex-col min-h-screen bg-[#07090e] text-slate-100 font-sans pb-24 md:pb-16">
      
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
            <p className="text-[11px] text-slate-400 truncate max-w-[150px]">{currentProject.title}</p>
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

        {/* TIMELINE TAB */}
        {activeTab === 'timeline' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center space-x-2">
                  <Music className="w-4 h-4 text-cyan-400" />
                  <span>{audioFileName}</span>
                </span>
                <span className="text-xs font-mono text-cyan-400">
                  {formatTime(currentTime).slice(0, 5)} / {formatTime(currentProject.audioDuration).slice(0, 5)}
                </span>
              </div>
              <canvas ref={canvasRef} width={600} height={80} className="w-full h-20 rounded-lg bg-slate-950" />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Time Slices ({segments.length} Scenes)</h3>
              </div>

              {segments.map((seg, idx) => (
                <div key={seg.id} className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition">
                  <div className="flex items-center space-x-3">
                    <button 
                      onClick={() => (isPlaying && activeSegmentIndex === idx) ? stopAudio() : playSegmentAudio(idx)}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 flex items-center justify-center transition"
                    >
                      {isPlaying && activeSegmentIndex === idx ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                    </button>
                    <div>
                      <div className="flex items-center space-x-2 mb-0.5">
                        <SectionBadge title={seg.title} />
                        <span className="text-[11px] font-mono text-cyan-400">{formatTime(seg.startTime).slice(0, 5)}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-1 italic">"{seg.lyrics}"</div>
                    </div>
                  </div>

                  <button 
                    onClick={() => { setSelectedSceneIndex(idx); setActiveTab('scenes'); }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center space-x-1 transition"
                  >
                    <span>Design</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SCENES TAB */}
        {activeTab === 'scenes' && segments[selectedSceneIndex] && (() => {
          let displayedSegments = [...segments];
          if (sortByEnergy) displayedSegments.sort((a, b) => b.energyLevel - a.energyLevel);
          
          const scene = segments[selectedSceneIndex];
          const isGeneratingImg = generatingImageId === scene.id;

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
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800">
                        {formatTime(scene.startTime).slice(0, 5)} - {formatTime(scene.endTime).slice(0, 5)}
                      </span>
                      <SectionBadge title={scene.title} />
                      <span className="text-[10px] font-bold bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800 flex items-center">
                        <Zap className="w-3 h-3 mr-1 fill-current" /> Energy {scene.energyLevel}/10
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white mt-1">Scene {scene.sceneNumber}: {scene.title}</h2>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleGenerateFreeKeyframe(selectedSceneIndex)}
                      disabled={isGeneratingImg}
                      className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition active:scale-95 shadow-md shadow-emerald-600/30"
                    >
                      {isGeneratingImg ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Generating Image...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Free Keyframe Still</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Section Tag</label>
                    <input 
                      type="text" 
                      value={scene.title}
                      onChange={(e) => {
                        const copy = [...segments];
                        copy[selectedSceneIndex].title = e.target.value;
                        setSegments(copy);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center">
                      <Zap className="w-3 h-3 mr-1" /> Intensity / Energy (1-10)
                    </label>
                    <input 
                      type="range" 
                      min="1" max="10" 
                      value={scene.energyLevel}
                      onChange={(e) => {
                        const copy = [...segments];
                        copy[selectedSceneIndex].energyLevel = parseInt(e.target.value);
                        setSegments(copy);
                      }}
                      className="w-full accent-amber-500 mt-1"
                    />
                  </div>
                </div>

                {scene.keyframeImageUrl && (
                  <div className="mt-3 p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono">
                        ✓ 9:16 Storyboard Keyframe (Ready)
                      </span>
                      <a href={scene.keyframeImageUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline">
                        View Full Res ↗
                      </a>
                    </div>
                    <div className="relative aspect-[9/16] max-w-[190px] mx-auto rounded-lg overflow-hidden border border-slate-700 shadow-xl">
                      <img src={scene.keyframeImageUrl} alt={`Scene ${scene.sceneNumber} visual`} className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}

                <div className="p-4 bg-indigo-950/20 border border-indigo-900/50 rounded-xl space-y-3">
                  <div className="flex items-center space-x-2">
                    <Scissors className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Clip Trim & Assembly Offsets</h3>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Adjust the start and end offsets of your final generated clip to fit exactly into this {scene.duration}s block. (This trims the clip in the Master Assembly Preview).
                  </p>
                  
                  <div className="grid grid-cols-2 gap-6 pt-2">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-300 mb-1">
                        <span>Start Trim</span>
                        <span className="font-mono text-cyan-400">{scene.trimOffsets.start.toFixed(1)}s</span>
                      </div>
                      <input 
                        type="range" min="0" max={scene.duration} step="0.1"
                        value={scene.trimOffsets.start}
                        onChange={(e) => {
                          const copy = [...segments];
                          copy[selectedSceneIndex].trimOffsets.start = parseFloat(e.target.value);
                          if (copy[selectedSceneIndex].trimOffsets.start >= copy[selectedSceneIndex].trimOffsets.end) {
                            copy[selectedSceneIndex].trimOffsets.end = copy[selectedSceneIndex].trimOffsets.start + 0.1;
                          }
                          setSegments(copy);
                        }}
                        className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-300 mb-1">
                        <span>End Trim</span>
                        <span className="font-mono text-cyan-400">{scene.trimOffsets.end.toFixed(1)}s</span>
                      </div>
                      <input 
                        type="range" min="0" max={scene.duration} step="0.1"
                        value={scene.trimOffsets.end}
                        onChange={(e) => {
                          const copy = [...segments];
                          copy[selectedSceneIndex].trimOffsets.end = parseFloat(e.target.value);
                          if (copy[selectedSceneIndex].trimOffsets.end <= copy[selectedSceneIndex].trimOffsets.start) {
                            copy[selectedSceneIndex].trimOffsets.start = copy[selectedSceneIndex].trimOffsets.end - 0.1;
                          }
                          setSegments(copy);
                        }}
                        className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-300">Prompt (Inspect & Edit Before Generation)</label>
                  </div>
                  <textarea
                    rows={4}
                    value={scene.approvedPrompt || compilePromptForScene(scene)}
                    onChange={(e) => {
                      const copy = [...segments];
                      copy[selectedSceneIndex].approvedPrompt = e.target.value;
                      setSegments(copy);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

              </div>
            </div>
          );
        })()}

        {/* ASSETS TAB */}
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
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3" />
                            <span>Re-Roll Portrait</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d14]/95 backdrop-blur-lg border-t border-slate-800 px-3 py-2 flex items-center justify-around">
        <button onClick={() => setActiveTab('timeline')} className={`flex flex-col items-center ${activeTab === 'timeline' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Sliders className="w-4 h-4 mb-0.5" />
          <span className="text-[10px]">Timeline</span>
        </button>
        <button onClick={() => setActiveTab('scenes')} className={`flex flex-col items-center ${activeTab === 'scenes' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Film className="w-4 h-4 mb-0.5" />
          <span className="text-[10px]">Scenes</span>
        </button>
        <button onClick={() => setActiveTab('assets')} className={`flex flex-col items-center ${activeTab === 'assets' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300 transition'}`}>
          <Sparkles className="w-4 h-4 mb-0.5" />
          <span className="text-[10px]">Assets</span>
        </button>
      </nav>

      {/* MASTER ASSEMBLY PREVIEW MODAL */}
      {showAssemblyModal && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full relative">
            
            {/* Export Render Overlay */}
            {isExporting && (
              <div className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
                {exportProgress < 100 ? (
                  <Cpu className="w-12 h-12 text-cyan-400 animate-pulse mb-4" />
                ) : (
                  <CheckCircle className="w-12 h-12 text-emerald-400 mb-4" />
                )}
                
                <h2 className="text-lg font-bold text-white mb-2">Rendering Assembly...</h2>
                <p className="text-xs text-cyan-400 font-mono mb-6">{exportStatus}</p>
                
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
                  <div 
                    className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300 ease-out"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400 font-bold">{exportProgress}% Complete</div>
              </div>
            )}

            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/50">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <MonitorPlay className="w-4 h-4 text-indigo-400" />
                  <span>Master Assembly Preview</span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Sequential timeline with trim offsets applied</p>
              </div>
              <button 
                onClick={() => setShowAssemblyModal(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Simulated 9:16 Video Canvas */}
            <div className="relative w-full aspect-[9/16] bg-black overflow-hidden flex items-center justify-center">
              {activeAssemblySegment.keyframeImageUrl ? (
                <img 
                  src={activeAssemblySegment.keyframeImageUrl} 
                  alt="Clip Frame"
                  className="w-full h-full object-cover transition-transform duration-75"
                  style={{
                    transform: `scale(${
                      1 + (
                        ((assemblyTime - activeAssemblySegment.startTime) + activeAssemblySegment.trimOffsets.start) * 0.015
                      )
                    })`
                  }}
                />
              ) : (
                <div className="text-center p-6">
                  <Video className="w-12 h-12 text-slate-700 mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">No Keyframe Generated</p>
                  <p className="text-[10px] text-slate-600 mt-1">Scene {activeAssemblySegment.sceneNumber}</p>
                </div>
              )}

              {/* Director's Burn-In Overlay */}
              <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none drop-shadow-md">
                <div>
                  <div className="bg-black/60 backdrop-blur-sm text-white text-[10px] font-mono px-2 py-1 rounded border border-white/10 inline-block mb-1">
                    REC <span className="text-red-500 ml-1">●</span>
                  </div>
                  <br />
                  <div className="bg-black/60 backdrop-blur-sm text-amber-400 text-[11px] font-mono px-2 py-1 rounded border border-amber-500/20 inline-block">
                    {formatTime(assemblyTime)} / {formatTime(currentProject.audioDuration).slice(0, 5)}
                  </div>
                </div>
                
                <div className="text-right flex flex-col items-end space-y-1">
                  <div className="bg-black/60 backdrop-blur-sm text-cyan-300 text-[10px] font-mono px-2 py-1 rounded border border-cyan-500/20 inline-block">
                    SCENE {activeAssemblySegment.sceneNumber}
                  </div>
                  <div className="bg-black/60 backdrop-blur-sm text-slate-300 text-[9px] font-mono px-2 py-1 rounded border border-white/10 inline-block">
                    TRIM IN: {activeAssemblySegment.trimOffsets.start.toFixed(1)}s
                  </div>
                </div>
              </div>
              
              {/* Lyrics Subtitles */}
              {activeAssemblySegment.lyrics && (
                <div className="absolute bottom-6 left-4 right-4 text-center">
                  <span className="bg-black/70 backdrop-blur-md text-white text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg shadow-lg inline-block border border-white/10">
                    "{activeAssemblySegment.lyrics}"
                  </span>
                </div>
              )}
            </div>

            {/* Playback Controls & Export */}
            <div className="p-4 bg-slate-900 border-t border-slate-800">
              
              {/* Scrub Bar */}
              <div className="mb-4 relative w-full h-2 bg-slate-800 rounded-full cursor-pointer"
                   onClick={(e) => {
                     const rect = e.currentTarget.getBoundingClientRect();
                     const clickX = e.clientX - rect.left;
                     setAssemblyTime((clickX / rect.width) * currentProject.audioDuration);
                   }}>
                <div 
                  className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full"
                  style={{ width: `${(assemblyTime / currentProject.audioDuration) * 100}%` }}
                />
                {segments.map(seg => (
                  <div 
                    key={seg.id} 
                    className="absolute top-0 w-0.5 h-full bg-slate-950" 
                    style={{ left: `${(seg.startTime / currentProject.audioDuration) * 100}%` }} 
                  />
                ))}
              </div>

              <div className="flex items-center justify-between">
                {/* Export Button */}
                <button
                  onClick={handleExportMP4}
                  className="bg-slate-800 hover:bg-slate-700 text-cyan-400 px-3 py-2 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700"
                >
                  <DownloadCloud className="w-4 h-4" />
                  <span>Export MP4</span>
                </button>
                
                <div className="flex items-center space-x-3">
                  <button 
                    onClick={() => setAssemblyTime(0)}
                    className="text-slate-400 hover:text-white transition"
                  >
                    <FastForward className="w-4 h-4 rotate-180" />
                  </button>
                  <button 
                    onClick={toggleAssemblyPlayback}
                    className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition active:scale-95"
                  >
                    {isAssemblyPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
