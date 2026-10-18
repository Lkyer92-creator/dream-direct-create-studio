# 🎬 DDC Dream-Direct-Create-studio

A director's studio that turns your finished song into a full AI music video, built scene by
scene — with **real in-app video generation** powered by your own fal.ai key, plus
**automatic lyric transcription** straight from your uploaded audio.

Upload your audio, slice it into timed intervals (5/10/15/20/30/40s), listen to each segment,
sync lyrics to time frames, lock your character / theme / style / color palette, direct every
shot (movement, lip sync, camera angle + movement), generate the actual video clips right
inside each scene card via fal.ai's Kling model, then assemble the full plan with optional
closed captions.

Built with **Next.js 14 (App Router, JavaScript)**, **Tailwind CSS**, and **lucide-react**.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│           DDC DIRECTOR'S STUDIO (Mobile UI)            │
└──────────────────────────┬─────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────────────┐
     ▼                     ▼                             ▼
┌────────────────────────┐ ┌─────────────────────────┐ ┌──────────────────────────┐
│  GLOBAL ASSET LIBRARY  │ │  AUDIO TIMELINE ENGINE  │ │   LYRIC SYNC & SRT GEN   │
│ • Locked Character/Actor│ │ • MP3/WAV Waveform      │ │ • Segment auto-slicing   │
│ • Color Palette (HEX)  │ │ • 5s-40s Slice presets  │ │ • Lip-sync prompt feed   │
│ • 35mm Style & Lens    │ │ • Solo loop auditioning │ │ • Downloadable .SRT file │
└───────────┬────────────┘ └────────────┬────────────┘ └────────────┬─────────────┘
            │                           │                          │
            └───────────────────────────┼──────────────────────────┘
                                        ▼
                    ┌───────────────────────────────────────┐
                    │    INTERVAL SCENE CARDS (Scene 1..N)   │
                    │ • Shot Type, Camera Angle & Movement  │
                    │ • Lip Sync Flag & Character Action    │
                    └───────────────────┬───────────────────┘
                                        ▼
                    ┌───────────────────────────────────────┐
                    │         AI PROMPT COMPILER            │
                    │  Mandatory User Approval & Edit Gate   │
                    └───────────────────┬───────────────────┘
                                        ▼
                    ┌───────────────────────────────────────┐
                    │    API ROUTE: /api/generate-video     │
                    │  (fal.ai / Kling 1.5 Image-to-Video)  │
                    └───────────────────┬───────────────────┘
                                        ▼
                    ┌───────────────────────────────────────┐
                    │     CONTINUITY MATRIX & ASSEMBLY      │
                    │ • 9:16 Vertical Video Final Timeline  │
                    │ • Text Shot List & MP4 Rendering      │
                    └───────────────────────────────────────┘
```

## Demo mocks replaced

This UI was delivered as a visual prototype with demo internals. Every mock was replaced
with the real implementation before shipping:

- **Clip generation** was a `setTimeout` + hardcoded sample MP4 → now POSTs
  `/api/generate-video` and polls `/api/video-status` (real fal.ai Kling renders).
- **Segment audio** was a Web Audio oscillator playing synth tones → now plays the actual
  uploaded audio file restricted to the segment's time range, with the loop toggle.
- **Audio upload** faked a 45s duration → now decodes the real file with the Web Audio API
  for true duration.
- **Waveform** drew deterministic fake bars → now draws real peaks from the decoded
  `AudioBuffer`.
- **Lyrics** were hardcoded sample text → now come from real fal.ai Whisper transcription
  of the uploaded audio, auto-mapped onto the interval segments (all editable).
- **State** lived only in React memory → now persists to localStorage (`mvd_projects_v1`).

## How it works

- **Projects tab** — project cards, create/delete, open. New Project modal asks for the song
  title.
- **Timeline tab** — upload audio (MP3/WAV/M4A), real waveform + duration, interval presets
  (5/10/15/20/30/40s + custom) that slice the song into numbered segments, tap any segment
  (or click the waveform) to play just that slice with loop toggle, rename segments.
  **Extract lyrics from audio** transcribes your song via fal.ai Whisper and drops each timed
  line into the right segment; every line stays editable. Export bar: `.srt` captions +
  shot-list `.txt`.
- **Scenes tab** — scene selector strip + one full editor card per segment: shot type
  (Keyframe / Motion clip / B-roll / Lip sync), lip-sync toggle, camera angle + movement,
  character action, setting, lighting/mood, lyric line. **AI Assist** drafts an editable video
  prompt from your directions + the locked assets — the mandatory approval gate: nothing
  generates until you approve the prompt. Each card has a real **Generate clip** panel
  (5s/10s, cancel support) and the rendered MP4 plays right in the card. Status pills:
  Planning, Prompt Ready, Rendering…, Video Rendered, Failed.
- **Assets tab (Continuity Engine)** — Characters (with reference image URL for Kling),
  Color palettes (HEX swatches), Visual film styles, Themes/environments. Add, delete, and
  lock one of each per project — every scene prompt inherits the locked set.
- **Review tab** — coordination table (every scene side-by-side: timeframe, shot type,
  angle/move, lip-sync, character, status), **Master settings** (9:16 vertical fixed,
  closed-caption toggle, default interval length), rendered-clips gallery.
- **API Route drawer** (header button) — documents the real backend routes.

## Your fal.ai key stays secret

The key lives **only on the server** (`process.env.FAL_KEY`, read inside
`app/api/generate-video/route.js`, `app/api/video-status/route.js` and
`app/api/transcribe/route.js`). The browser talks to those routes — it never sees the key.
There is no `NEXT_PUBLIC_` key anywhere. Never commit a real key to git.

## Audio → lyrics transcription

The **Extract lyrics from audio** button (Timeline tab) runs your uploaded song through
fal.ai's `whisper` model (task=transcribe, segment-level timestamps), entirely server-side:

1. The app asks `/api/transcribe` to initiate a fal.ai storage upload.
2. Your browser PUTs the audio bytes **directly to fal.ai's storage** (pre-signed URL, no key
   involved) — this keeps big files off the serverless function.
3. The server submits the whisper queue job and returns the status URL.
4. The app polls the shared `/api/video-status` fal.ai queue proxy, then fetches the timed
   transcript.
5. Each timed chunk is mapped onto the interval segments it overlaps. **Everything stays
   editable** — sung vocals over music transcribe imperfectly, so fix lines by hand.

## Local development

```bash
npm install
cp .env.example .env.local
# paste your real fal.ai key into .env.local as FAL_KEY=...
npm run dev
```

Open http://localhost:3000.

## Deploy (Vercel free tier)

1. Push this folder to a GitHub repo.
2. Import the repo at vercel.com (New Project).
3. Under **Environment Variables**, add `FAL_KEY` with your fal.ai key.
4. Deploy. Your app URL is live with video generation working.

> GitHub Pages **cannot** host this app — the API routes are required to keep your key
> server-side. Any static-only host would force the key into the browser, where anyone
> could steal it and burn your credits.

## Honest notes

- Kling v1.5 pro image-to-video renders **5s or 10s per clip** — longer intervals chain
  multiple clips end to end.
- A character **reference image URL** is required for generation (Kling is image-to-video).
  Add one to your locked character in the Assets tab.
- Render usage bills to **your fal.ai account**.
- Generation usually takes 1–2 minutes per clip; the app polls for completion and times out
  after ~3.5 minutes (check your fal.ai dashboard for finished clips).
- Prompts are always editable before you hit Generate — nothing renders without your approval.
- Transcription is a starting point — sung vocals over music transcribe imperfectly, so every
  transcribed line stays editable for fixing by hand.
- Audio files are kept in memory only — re-upload each visit. Scenes, lyrics, assets, and
  render statuses auto-save to localStorage.

## Files

- `app/page.js` — the full DDC Director's Studio UI (Projects / Timeline / Scenes / Assets /
  Review tabs + API docs drawer + New Project modal)
- `app/layout.js`, `app/globals.css` — shell + Tailwind-powered dark studio theme
- `tailwind.config.js`, `postcss.config.js` — Tailwind v3 setup
- `lib/seed-data.js` — starter continuity library (characters, palettes, styles, themes),
  interval presets, status model
- `lib/utils.js` — time formatting, downloads, clipboard, ids
- `app/api/generate-video/route.js` — server route: starts a fal.ai render (holds the key)
- `app/api/video-status/route.js` — server route: polls any fal.ai queue status (holds the key)
- `app/api/transcribe/route.js` — server route: fal.ai storage upload initiate + whisper
  transcription submit (holds the key)
- `components/SceneGeneratePanel.js` — per-scene real generation panel (duration, cancel,
  error states; reports status up to the scene card)
- `hooks/useVideoGeneration.js` — client hook: start + poll video render, no key client-side
- `hooks/useTranscription.js` — client hook: upload + transcribe audio, no key client-side
- `music-video-creator-app-prompt.txt`, `ddc-dream-disect-create-prompt.txt` — copy-paste
  prompts for the LastApp build (reference only, not part of the deployed app)
