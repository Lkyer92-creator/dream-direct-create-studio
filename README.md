# 🎬 DDC Studio — Dream Direct Create Studio

A director's studio that turns your finished song into a full music video, built scene by
scene — a **prompt-only** workflow. The app writes every prompt; you generate the images
in Fooocus and the motion in your own video generator, then bring the results back in
for assembly.

Upload your audio, slice it into timed intervals (10/15/20/30s or custom), label each
section (Verse 1, Chorus, Break...), generate a theme and storyline, and get a text-to-image
prompt for every scene at once — copy them all, run them through Fooocus, upload the
images back, review your storyboard, and get a Bible of image + prompt pairs ready to
paste into your video generator. Then upload your finished clips per scene and the app
trims, syncs, and exports the whole video with your song underneath.

**No image generator, no video generator in this build — by design.** The app directs
and organizes; Fooocus and your video tool render.

Built with **Vite + React** (single-page app), **Tailwind CSS**, and **lucide-react**.

## The Director flow

A guided 9-step wizard (the **Director** tab):

1. **Audio** — upload your song (MP3/WAV/M4A). Real duration via the Web Audio API, real
   waveform from the decoded audio. Get lyrics three free ways: transcribe in the app,
   transcribe free in Colab, or type/paste them yourself. You can also pick a song from
   your Audio library instead of re-uploading.
2. **Intervals** — slice the song into timestamped segments: 10, 15, 20, 30 seconds, or
   any custom length. Each interval shows its time range and lyric chunk.
3. **Sections** — label what each segment actually is: Verse 1, Verse 1a, Verse 1b,
   Chorus, Break, Instrumental, Outro, and more — or type your own. The auto-guess is
   just a starting point; override anything.
4. **Theme + Storyline** — one tap generates a visual theme and a storyline for your
   video (free, via Pollinations text AI), dropped into editable fields. Rewrite anything —
   this guides every prompt and the Bible.
5. **Image prompts** — one editable text-to-image prompt per scene, compiled from your
   locked character, style, palette, world, and storyline. **Copy ALL image prompts**
   grabs every scene's prompt in one block — paste into Fooocus and generate.
6. **Upload images** — bring your Fooocus results back in, one image per scene. Stored
   in the app so they survive reloads and project switches.
7. **Storyboard** — review space: each scene shows its uploaded image plus the video
   concept. **Approve** or **Veto** each scene, edit anything, until the board looks
   right.
8. **Bible** — alternating Image / Prompt pairs per scene: the image, then its full
   editable production prompt (character, scene + action, camera angle, camera movement,
   lighting/mood, lip-sync directions on flagged scenes). Copy per scene or copy all —
   paste straight into your video generator.
9. **Finished** — upload your finished video clip per scene; clips auto-place at their scene
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
- **Characters** — preset character library: name, face, hair, outfit, style notes.
  Save once, pull into any project's cast. Portraits are your own uploads.
- **Audio** — your full-length songs, stored in the app (IndexedDB) so projects reuse
  them with no re-uploading.
- **Looks** — one-tap saved visual styles: palette + film style + world + character.
  Save the look you love, apply it to any project.
- **Assets** — per-project continuity: this project's cast (pull from your library),
  locked palette/style/world pickers — every prompt inherits the locked set.

## Audio → lyrics (free, no API key)

Three ways to get lyrics in — pick whichever suits the song:

1. **Transcribe in the app** — the **Extract lyrics from audio** button runs Whisper
   directly in your browser (via transformers.js) — no key, no account, no cost.
   It maps each timed line onto your intervals.
2. **Transcribe free in Colab** — the button in Step 1 opens the
   `song-transcriber.ipynb` notebook in Google Colab, where the open-source Whisper
   model runs on a free GPU. Upload your song, get timestamped lyrics back in about
   a minute, then paste them into the Lyrics box.
3. **Type or paste them yourself** — the Lyrics box in Step 1 is a plain editable
   field. Paste from anywhere or type them in by hand; the app slices them across
   your intervals either way.

Whisper transcribes sung vocals over music imperfectly no matter which route you
take — every line stays editable, fix by hand.

## Image generation

There is none in this app — by design. The app writes text-to-image prompts (one per
scene, plus a copy-all button); you generate the images in Fooocus (see
`fooocus-colab.ipynb` — runs free on a Colab GPU, controlled from your phone) and
upload them back into the app per scene.

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

- There is **no image or video generator** in this app — by design. It writes you the
  prompts; you render images in Fooocus and motion in your own video tool.
- The theme + storyline writer uses the free Pollinations text API (rate-limited, but
  it's one call per project).
- Transcription is a starting point — sung vocals over music transcribe imperfectly, so
  every transcribed line stays editable.
- Projects, characters, looks, and settings auto-save in your browser (localStorage);
  songs are kept in IndexedDB. Audio and attached clips live only in the browser you
  uploaded them in.
- Export renders for real with ffmpeg.wasm (~30MB one-time download) and mixes your
  uploaded song underneath — the MP4 that downloads is the finished video.
