# 🎬 DDC Studio — Dream Direct Create Studio

A director's studio that turns your finished song into a full music video, built scene by
scene — with **free in-app image generation** powered by Pollinations.ai, plus
**automatic lyric transcription** straight from your uploaded audio.

Upload your audio, slice it into timed intervals (10/15/20/30s or custom), generate a theme
and storyline, storyboard one visual per interval, and get a complete Bible for every scene —
timestamp, lyrics, the actual generated visual, and a full production prompt (character,
scene, camera angle, camera movement, lip-sync directions) ready to paste into Runway.
Then assemble the finished video: upload your clips per scene and the app trims, syncs,
and exports it all with your song underneath.

**Images only** — there is no video generator in this build. You direct, the app handles
visuals and prompts, and you render motion clips in Runway (or your tool of choice) with
the prompts it writes for you.

Built with **Vite + React** (single-page app), **Tailwind CSS**, and **lucide-react**.

## The Director flow

A guided 6-step wizard (the **Director** tab):

1. **Audio** — upload your song (MP3/WAV/M4A). Real duration via the Web Audio API, real
   waveform from the decoded audio. **Extract lyrics from audio** runs it through
   Whisper transcription and maps each timed line onto your intervals — every line stays
   editable. You can also pick a song from your Audio library instead of re-uploading.
2. **Intervals** — slice the song into timestamped segments: 10, 15, 20, 30 seconds, or
   any custom length. Each interval shows its time range and lyric chunk.
3. **Theme + Storyline** — one tap generates a visual theme and a storyline for your
   video (free, via Pollinations text AI), dropped into editable fields. Rewrite anything —
   this guides every visual and the Bible.
4. **Storyboard** — one AI visual per interval (Pollinations Flux, 9:16), generated with
   your locked character, style, palette, and world baked in. Generate all at once or
   re-roll per scene. Each scene has a **lip-sync toggle** for close-up singing shots.
5. **Bible** — one card per scene: timestamp, lyrics, the actual generated image, and a
   full editable production prompt covering character, scene + action, camera angle,
   camera movement, lighting/mood, palette, and explicit lip-sync directions quoting the
   lyric chunk on lip-sync scenes. Copy per scene, or copy all prompts at once.
6. **Finished** — upload your own video clip per scene; clips auto-place at their scene
   timestamps, get trimmed/looped to fit, and export as one finished MP4 with your song
   mixed underneath (rendered right in the browser with ffmpeg.wasm).

## Bottom nav

**Director · Projects · Timeline · Scenes · Characters · Audio · Looks · Assets**

- **Projects** — every project is one complete music video: its own characters, scenes,
  storyboard, Bible, and finished video. Create, rename, duplicate, delete, and switch
  between projects — everything auto-saves per project in your browser.
- **Timeline** — waveform, tap-to-play any segment with loop, rename segments.
- **Scenes** — per-scene editor: shot type, camera angle + movement, character action,
  setting, lighting/mood, lyric line.
- **Characters** — preset character library: name, face, hair, outfit, style notes, and
  free AI-generated portraits. Save once, pull into any project's cast.
- **Audio** — your full-length songs, stored in the app (IndexedDB) so projects reuse
  them with no re-uploading.
- **Looks** — one-tap saved visual styles: palette + film style + world + character.
  Save the look you love, apply it to any project.
- **Assets** — per-project continuity: this project's cast (pull from your library),
  locked palette/style/world pickers — every prompt inherits the locked set.

## Audio → lyrics transcription

The **Extract lyrics from audio** button runs your uploaded song through Whisper
(`fal-ai/whisper`), entirely in the browser with **your** fal.ai key:

- Your key is typed into the app and lives **only** in your browser's localStorage —
  it is never committed to the repo or sent anywhere but fal.ai.
- Transcription bills to your fal.ai account.
- Sung vocals over music transcribe imperfectly — every line stays editable, fix by hand.

## Image generation

All visuals are generated in-app with the free Pollinations.ai image API
(`image.pollinations.ai`, Flux model) — no key needed. Keyframes render at 720×1280
(9:16 vertical); character portraits at 512×768. Every generation uses a fresh random
seed; hit re-roll for a new take.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build & deploy

```bash
npm run build
```

The static site in `dist/` is deployed to GitHub Pages via the `gh-pages` branch.
Live at **lkyer92-creator.github.io/dream-direct-create-studio/**.

## Honest notes

- There is **no video generator** in this app — by design. It writes you the prompts;
  you render the motion in Runway or your own tool.
- Pollinations is free with rate limits — generating a full storyboard takes a minute or
  two; scenes generate one at a time.
- Transcription is a starting point — sung vocals over music transcribe imperfectly, so
  every transcribed line stays editable.
- Projects, characters, looks, and settings auto-save in your browser (localStorage);
  songs are kept in IndexedDB. Audio and attached clips live only in the browser you
  uploaded them in.
- Export renders for real with ffmpeg.wasm (~30MB one-time download) and mixes your
  uploaded song underneath — the MP4 that downloads is the finished video.
