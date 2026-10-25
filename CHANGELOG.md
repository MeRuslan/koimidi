# Changelog

## v0.5.1 — 2026-10-25

Pieces from videos: a held-out check on 34 tutorials from other channels (Rutube and Dailymotion mirrors of PlutaX, PHianonize, Sheet Music Boss, Betacustic, Toms Mucenieks, Piano Tutorial Easy, OnlinePianist, PianoKafe and others, two keyboard-with-sheet-music renderers, three glow visualisers, a vertical short and five filmed pianos) showed the recognition tuned to the two videos it was built on. Reworked to take more from the video itself and fewer fixed numbers. Over the 28 videos where a lit keyboard was found, the melody notes found went from 54% to 85%, wrong notes from 5% to 2%, extra notes from 6% to 3%, the rhythm of neighbouring notes from 60% to 89% and the bar lines from 34% to 62%; two of the filmed pianos are now told apart and sent to listening by ear.

- Keys are judged against their resting colour over the whole video (a median), not against one calibration frame: videos that fade in, or open on a title over the keys, lost almost every note before
- How far a key's colour must stray to count as a press comes from the point's own noise, capped by what points of its kind need; a change that only darkens a key (a shadow, a caption, a fade) never counts
- The falling bars always help split repeated notes: a bar's landing is trusted only while its bottom keeps coming down at the measured speed (a glow where bars land, or a letter printed low on a bar, stands still), and cuts keep clear of a note's ends by the lag this video shows between a bar landing and the key lighting
- The keyboard: every row of black keys in the frame is a candidate (a drawn keyboard above a filmed one), a label across the black keys no longer ends them, a keyboard's white keys end above the next dark shapes after a white run, and a pattern with dark shapes in the E–F and B–C gaps is not a keyboard (digits in a caption were)
- Choosing between keyboards: the one whose keys light up vividly, never the one right under another; the reference frame is the brightest calm sighting
- Hands by colour: the two hues come from the peaks of the hue histogram weighted by saturation (two colours used to collapse into one), and two hues that also sit in two registers are two hands even when a little loose
- Time: the tatum (the finest pulse the notes sit on) is read from the gaps between onsets, corrected for what a short period explains by chance; the bar is chosen among the usual lengths in tatums by repetition and accents, and written as the reading whose quarter note is near half a second (4/4 slightly preferred, 2/4 and 3/8 slightly not, 6/8, 9/8 and 12/8 when accents fall in threes). A slow tutorial is written slow; nothing presumes 100 bpm any more
- A close-up keyboard that does not say its octave starts from the octave the piece's register suggests (left hand around the C below middle C)
- Notes that could not have been played — more than ten at once, a dozen a second, or a note starting while two of its nearest neighbours are down (hands over a filmed piano) — are not a piece: the app says the keys do not light up and offers to listen instead
- `scripts/bench-video.mjs`: the recognition on a video file against a library piece (ffmpeg; melody found, wrong and extra notes, hands, rhythm, bar lines), on a manifest of videos, with before/after comparison; videos never enter the repository

## v0.5.0 — 2026-10-25

Pieces from videos.

- **From a video** on the home screen: a YouTube link (played in YouTube's own player inside koimidi), a video in another browser tab, or a video file (also by dropping it on the page)
- The keyboard is found in the frame by its white keys and the pattern of black keys in twos and threes: full keyboards and close-ups cut off at the edges, black keys midway between white ones or off-centre as on a real piano, letters and logos on the keys; the octave comes from the key count (88, 76, 61, 49 keys) or, for a close-up, from middle C nearest the centre, with an octave switch on the result
- Long intros and outros: the keyboard is looked for in the first seconds and then at a few places further on, and the whole video is recorded
- Every key is followed frame by frame, white keys in two places (some videos light only the part between the black keys), against each key's usual colour over the whole video; fades, cuts and title cards are skipped, and keys held across a stall in the video are let go
- Hands by the hue of the lit keys, so a lighter shade for white keys and a darker one for black keys of the same hand stay one hand
- Repeated notes of the same key: split by the dark moment between them when the video shows one; otherwise by the gap between the falling bars just above the keys (bars told from a plain or picture background by being bright and vivid, looked at across their whole width so the note names printed on them are not taken for gaps)
- Tempo by autocorrelation and the beats by dynamic programming (Ellis 2007), notes on a grid of quarters or thirds of a beat; 4/4, 3/4, or 12/8 and 9/8 when the beats split in three; the first downbeat from the rhythm, bass notes and long notes; half-speed playback for fast pieces, with the real tempo kept
- Result screen: title, notes, hands, bars and tempo, a piano roll of the first bars, time signature and bar lines adjustable, a preview with the app's sound; the piece is stored as a MIDI file in *Your files* with the video's link
- YouTube buffering and pauses do not stretch the notes; a file pauses while its tab is hidden; tab capture works in the background
- No lit keyboard: recognise by ear instead with Spotify's Basic Pitch (TensorFlow.js, about 1 MB, loaded only then and kept for offline use once fetched), marked as a draft
- Tests on synthetic videos drawn from the library pieces in three styles (Synthesia; a close-up with real piano proportions, striped keys and a logo; keys lit only at the top, letters on the keys and a picture behind the bars), and through H.264 at 720p and 360p when ffmpeg is installed

## v0.4.0 — 2026-10-25

Sound.

- Grand piano: Salamander Grand Piano V3 (Yamaha C5, Alexander Holm, CC BY 3.0) as a 9.8 MB SF3 built for the web by `scripts/build-piano.mjs` (4 of 16 velocity layers, milder velocity curve, shortened tails, Ogg Vorbis), played by SpessaSynth in an AudioWorklet; downloaded with progress the first time it is chosen and kept in Cache Storage for offline use
- Your own SoundFont packs (`.sf2`, `.sf3`): added from Settings, checked, stored in IndexedDB (version 4 adds the "soundbanks" store), with a choice of instrument inside the pack; remove a pack from Settings
- The simple synth keeps playing while a sound loads and takes over if a sound cannot be loaded; the chosen sound comes back on the next visit
- Four more library pieces: Row, Row, Row Your Boat; Brahms' Lullaby; Minuet in G (Petzold); Korobeiniki
- Fixed: in Listen mode a note repeated right after itself was cut off almost at once (the first note's release timer stopped the second one); the key highlight had the same problem

## v0.3.0 — 2026-10-25

Two hands for real.

- The trainer plays the other hand while you practise one (**+ other hand**, on by default): grey bars without numbers, softer sound, its own key colour; in Learn mode its notes wait with the timeline and sound together with yours, even when you play ahead of the bars
- Every pass through the loop range is counted per bar (hits, wrong keys, misses) with its practice time; waits longer than 15 s for a key do not count
- Progress panel: practice time, mistakes per bar as a heat strip (click a bar to loop it), hardest bars, accuracy trend and the latest passes for the current range, mode and hand; reset per piece
- After each pass: "Bars 1–8: 94% correct, your best yet!"; the end-of-range summary now counts that pass only
- Library cards show practice time and best result
- Offline use as a PWA: web app manifest with icons, a service worker that keeps the whole app (about 600 KB) in the browser, an update prompt instead of surprise reloads, and an Install button where the browser offers it
- Progress is saved when the page is hidden or closed; IndexedDB version 3 adds the "progress" store, and removing a file removes its progress

## v0.2.0 — 2026-10-25

Learn your own piece.

- Change a finger by clicking its bar (or with keys `1`–`5`); edits are kept in the browser per piece (IndexedDB, keyed by file hash or library id), the automatic fingering works around them, and a dot marks them on the bar
- "Back to suggested" for one note and "Reset my fingers" for the whole piece
- Export MusicXML 4.0 with `<fingering>` for every note: piano part on two staves, voices, ties across barlines, pickups, triplets, tempo and section marks; hand-played MIDI timing is rounded to a 1/24-beat grid
- One bar of count-in before *In tempo*, with a large on-screen count; metronome for *In tempo* and *Listen* with an accented downbeat, scheduled on the audio clock
- Keyboard profile: 25 to 88 keys, or detected from the MIDI device name; controllers up to 49 keys are drawn key for key at the best octave, keys and lanes beyond the controller are shaded, and pieces that do not fit are flagged in the library and while practising
- Record your playing (MIDI keyboard, computer keys or on-screen keys, with the sustain pedal), listen back, save as `.mid`
- Settings popover grouped into This piece, Sound, Keyboard, Display
- Library pieces are parsed afresh on every open, so edits never leak between visits

## v0.1.0 — 2026-10-25

First public release.

- Falling bars coloured by finger, with the finger number on the bar and on the target key
- Learn mode that waits for the right key or chord; early presses count and the bars catch up smoothly
- In-tempo mode with hit window and missed-note count; Listen mode that plays the piece
- Built-in WebAudio piano for keyboards without sound, sustain pedal (CC 64)
- Import of MIDI (`.mid`, `.midi`) and MusicXML (`.musicxml`, `.xml`, compressed `.mxl`), parsed in the browser
- Automatic fingering for both hands (Parncutt-style cost model, dynamic programming); fingering from files is kept
- Loop any range of bars; section chips from rehearsal marks; right / left / both hands
- Same note accepted in any octave, with an OCTAVE hint for small keyboards
- Computer keys and on-screen keys as fallback input
- Library of 12 public-domain pieces typeset for koimidi
- Settings and imported files stored in the browser (localStorage, IndexedDB); nothing is uploaded
- English and Russian interface
- GitHub Pages deployment via GitHub Actions
