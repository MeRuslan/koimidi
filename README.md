# koimidi — free piano trainer

**koimidi** is a free, open-source piano trainer for MIDI keyboards that runs in the browser.
Falling notes with finger numbers, a "wait for the right key" mode, and built-in sound for keyboards that have none.
No sign-up, no server: your files are parsed on your device and never leave it.

**Try it:** https://meruslan.github.io/koimidi/ · [По-русски](README.ru.md)

<p align="center"><img src="docs/screenshot.jpg" alt="koimidi practice screen: falling colour-coded bars with finger numbers above an on-screen keyboard" width="800"></p>

## Why

Learning a melody without reading sheet music means you want three things at once: bars that fall onto the keys, the finger to use on each bar, and a trainer that *waits* for you instead of running ahead. Add a keyboard with no sound of its own (a small controller like the Komplete Kontrol M32) and you also need the browser to play what you press. None of the free web tools we tried did all of that, so this one does.

## Features

- **Falling bars, colour = finger.** The number sits on the leading edge, and the target key lights up with the same finger.
- **Learn mode waits for you.** Time stops on each note (or chord) until you play it. Play ahead of the bar and it counts at once; the bars catch up smoothly, no jump.
- **In-tempo mode** keeps going and counts late and wrong notes. **Listen mode** plays the piece for you.
- **Your own sound.** A small WebAudio piano plays whatever you press, with sustain pedal support (CC 64), so a silent controller is enough.
- **A real grand piano.** Pick *Grand piano · Salamander* in Settings: a sampled Yamaha C5 (about 10 MB, downloaded once, then works offline) played by [SpessaSynth](https://github.com/spessasus/spessasynth_lib).
- **Your own SoundFonts.** Add any `.sf2` or `.sf3` pack and choose its instrument; packs stay in your browser.
- **Open MIDI and MusicXML** (`.mid`, `.midi`, `.musicxml`, `.xml`, compressed `.mxl`). Parsing happens in the browser; files are kept in your browser's storage (IndexedDB) for next time.
- **Automatic fingering** (right and left hand) for files that carry none, using a Parncutt-style ergonomic cost model and dynamic programming. Fingering from MusicXML `<fingering>` is kept.
- **Your own fingering.** Click a bar and pick a finger (or press `1`–`5`). The choice is kept in this browser for that piece, the automatic fingering rearranges the notes around it, and a small dot marks the fingers you chose.
- **Export MusicXML with fingering**, yours included, to print the piece or open it in MuseScore and other notation programs.
- **Count-in and metronome.** *In tempo* starts after one bar of clicks; the metronome clicks every beat in *In tempo* and *Listen*.
- **Keyboard profile.** Tell koimidi how many keys your controller has, or let it guess from the device name (Komplete Kontrol M32 → 32 keys). Controllers up to 49 keys appear on screen key for key, at the octave that suits the piece; pieces that need more keys are flagged in the library and while you practise.
- **Record your playing** with the ● button, listen back, and save it as a `.mid` file.
- **Loop any range of bars**, with section chips when the score has rehearsal marks.
- **Any octave accepted** on small keyboards, with a hint about which way to press OCTAVE.
- **Tempo from 20 % to 100 %**, right / left / both hands, note names as *do re mi* or *C D E*.
- **The trainer plays the other hand.** Practise the right hand while koimidi plays the left (or the other way round) from grey bars; in *Learn* mode the other hand waits with you, so the chord sounds when you play your note.
- **Progress.** Practice time, accuracy of every pass, a strip of mistakes per bar (click a bar to loop it), your hardest bars, and how the current bar range has gone pass by pass. The library shows time and best result for each piece.
- **Works offline.** After the first visit the whole app is kept in the browser; install it from the address bar or the **Install** button and it opens like an app, without the internet.
- **No MIDI keyboard?** Computer keys `A`–`L` (white) and `W E T Y U O` (black) work, so does tapping the on-screen keys.
- **Built-in library** of 16 public-domain pieces, from *Twinkle, Twinkle* to *Für Elise* (part A), the Minuet in G, Brahms' Lullaby and *Korobeiniki*, typeset for koimidi.
- English and Russian interface; settings and your files stay in the browser.

## Requirements

Web MIDI works in Chromium browsers: **Chrome, Edge, Brave, Opera** on desktop and Android.
Safari and Firefox cannot see MIDI keyboards; everything else still works there with the computer keys.
The site must be served over `https://` or opened from `localhost` / a local file for Web MIDI to be available.

## Using it

1. Open the site, plug in the keyboard, allow MIDI access when the browser asks.
2. Pick a piece from the library or open your own `.mid` / `.musicxml` / `.mxl`.
3. Press the highlighted key to start. In *Learn* mode nothing moves until you play the right note.
4. Narrow the loop to a few bars (the **Bars** fields, the section chips, or `[` / `]` while playing), slow the tempo, repeat, widen. In a two-hand piece, practise one hand with **+ other hand** on, then both.
5. A finger feels wrong? Click its bar and choose another one; the rest of the fingering adapts.
6. Switch to *In tempo* when it feels easy, with the metronome if it helps. Record a take with ● to hear yourself.
7. Open **Progress** (the chart button) to see which bars still go wrong, and loop them.

Shortcuts: `Space` start/pause · `Enter` restart · `[` `]` loop start/end at the current bar · `Z` `X` shift the computer-keyboard octave · `1`–`5` finger for the selected bar · `Esc` back to the library.

## Privacy

There is no account, no analytics and no network requests after the page loads, apart from the browser checking for a new version of the app and the grand piano sound, which is downloaded from this same site the first time you choose it. Imported files, SoundFont packs, the fingers you chose, your progress and your settings are stored only in your browser (localStorage, IndexedDB and Cache Storage); clearing site data removes them. Recordings stay in memory until you save them. Nothing is uploaded anywhere.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: parsers, MusicXML export, fingering, practice engine, progress, recorder, library
npm run build      # type-check + production build into dist/
```

Plain TypeScript + Vite, no UI framework. Layout of `src/`:

| Folder | What lives there |
| --- | --- |
| `score/` | the score model, MIDI and MusicXML importers, MusicXML export, the compact library notation, automatic fingering and the player's finger edits |
| `practice/` | the practice engine (modes, waiting, hit windows, loop range, octave tolerance, count-in, metronome, the trainer's hand, pass statistics), progress and the recorder |
| `render/` | the canvas renderer (falling bars, keyboard) |
| `audio/` | the WebAudio synth and metronome, sampled instruments through SpessaSynth, sound banks (the grand piano and the player's packs) |
| `input/` | Web MIDI and computer-keyboard input, keyboard profiles |
| `storage/` | settings in localStorage; files, finger edits and progress in IndexedDB |
| `library/` | built-in pieces |
| `ui/` | home and practice screens, the progress panel |
| `sw.js`, `pwa.ts` | the service worker (its file list is filled in by the build, see `vite.config.ts`) and its registration, update prompt and Install button |

Deployment is a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs the tests, builds, and publishes `dist/` to GitHub Pages on every push to `main`. The build uses a relative base path, so it works from any folder or domain.

### The grand piano

`public/sounds/salamander-grand-piano.sf3` is built from the Salamander Grand Piano SF2 published by [FreePats](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html): 4 of its 16 velocity layers, a milder velocity curve, shortened tails, Ogg Vorbis samples. To rebuild it (needs `ffmpeg` with libvorbis):

```bash
node scripts/build-piano.mjs SalamanderGrandPiano-V3+20200602.sf2
```

### Adding a library piece

Pieces live in `src/library/pieces.ts` in a small text notation:

```
title: Ode to Joy
composer: Ludwig van Beethoven (1824)
time: 4/4
tempo: 112
R: @A E4:3 E4 F4:4 G4:5 | G4 F4 E4 D4 | C4:1 C4 D4 E4 | E4. D4/8 D4/2 |
L: C3/1:1 | G2/1:5 | C3/1 | G2/2 C3/2 |
```

`C4` is middle C; `/8` is an eighth, `.` a dot, `~` a tie, `:3` a finger, `[C4 E4 G4]/2:135` a chord, `r/4` a rest, `|` a barline (checked against the time signature, so typos surface as test failures), `@A` a section mark. Only pieces in the public domain, typeset by you, please; see `tests/library.test.ts`.

## Roadmap

Every release starts with a session on a real controller (Komplete Kontrol M32, Chrome over https); what breaks there comes first.

- **v0.2 — learn your own piece** (done). Edit a finger by clicking its bar; edits are kept in the browser per file and the automatic fingering works around them. Export MusicXML with `<fingering>`. Count-in and metronome for the in-tempo mode. Keyboard profile: your controller's range on screen and a warning when a piece does not fit it. Record your playing and export it as `.mid`.
- **v0.3 — two hands for real** (done). Practise one hand while the trainer plays the other. Progress statistics per piece and per bar range. Offline use as a PWA.
- **v0.4 — sound** (done). Sampled piano (Salamander Grand Piano as SF3 through SpessaSynth) and your own SoundFont packs (SF2/SF3). More public-domain pieces in the library.
- **Deferred:** vector-PDF import in the browser, MIDI output to an external synth, scanned-sheet recognition (OMR).

## Credits and licenses

- Code: [MIT](LICENSE).
- Library pieces: public-domain works typeset for this project.
- Grand piano sound: [Salamander Grand Piano V3](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); SF2 assembly by FreePats; reduced for koimidi as described in `public/sounds/salamander-grand-piano.txt`. This file is under CC BY 3.0, not MIT.
- [SpessaSynth](https://github.com/spessasus/spessasynth_lib) (Apache-2.0), [@tonejs/midi](https://github.com/Tonejs/Midi) (MIT), [fflate](https://github.com/101arrowz/fflate) (MIT), fonts [Golos Text](https://github.com/fontsource/fontsource) and [Unbounded](https://github.com/fontsource/fontsource) via Fontsource (SIL OFL).
- Fingering cost model after Parncutt, Sloboda, Clarke, Raekallio & Desain, *An ergonomic model of keyboard fingering for melodic fragments* (1997).

The name: Bashkir *көй* ("melody") + koi carp in a pond + MIDI.
