# Changelog

## Unreleased

The tutorial on the practice screen, the notes put right on the waterfall, and the rhythm judged.

- **Rhythm.** A pass used to be judged by its notes alone; any press inside the hit window counted the same. Now it also gets a rhythm score, shown next to the right notes on the card at the end of a pass, live under the next notes, per pass and per bar in Progress. In tempo each right note is judged by how far from its beat it went down: on time within 8% of a beat (never less than 60 ms, which also takes in the lag of the screen and the sound), nothing from 35% of a beat on, a straight line in between; when your notes are early or late on the whole, the card says you rush or drag. In Learn mode the bars wait for you, so the gaps between notes are compared with the score's at your own tempo (the median of the pass): right within 15% (or 80 ms), nothing at 1.8 times longer or shorter; a stop to look for a key counts against it, a slow but even tempo does not. The card then also says what your tempo was, as a share of the piece's, to set the slider for In tempo by. Pauses (Space) and waits over 15 s are not gaps, and keys are timed when they go down rather than at the next frame
- Progress keeps the rhythm with each pass and bar; the trend shows it as a dashed line under the right notes, and Learn passes list your own tempo. Passes from before have no rhythm and show as they did

- **Edit the notes on the waterfall.** Recognition makes mistakes, and so do files. A click on a bar now also gives the note to the other hand or deletes it, and ✎ **Edit the notes** in the rail turns the stage into a piano roll that stands still over a beat grid, with a few more keys on either side: click an empty spot for a new note, drag a bar to another key or time, drag its top edge for another length, scroll with the wheel or by dragging the paper. A key played on the keyboard moves the chosen note to that key (into the nearest octave with *Any octave* on); the arrow keys nudge it by a key or a grid step, with Shift by an octave or a beat. Times snap to the grid, or to a note starting or ending nearby, so chords line up. A new note goes to the hand being practised (with both hands, to the one playing nearby) and ends before the next note on its key. Notes sound as they are clicked, put in or moved, to check them by ear; the trainer's hand can be edited too. Space leaves editing and plays on from there
- The edits are kept in this browser per piece, next to the fingers, as the notes taken out and put in, so they hold when the MIDI hand split changes; a moved note keeps the finger you gave it. Every change, fingers included, can be undone and redone (the arrows on the editing bar, `Ctrl`/`⌘` `Z`, `Ctrl` `Y` or `⇧⌘Z`), and the message for a deleted note has an Undo button. Settings › This piece › **Restore the original notes** drops them all; the MusicXML export has the notes as edited
- `Delete` / `Backspace` with a bar chosen deletes its note; they used to put back the suggested finger, which `0` still does

- **Video** on the practice screen, for a piece recognised from a YouTube link: the tutorial itself in YouTube's own player (koimidi keeps only the link, never the video), between the strip of bars and the stage, in step with the bars. It follows the tempo slider, waits with the bars in Learn mode, plays along in In tempo and Listen, and jumps with a click on a bar or a restart; in Listen mode the sound comes from the video and the synth keeps quiet. A switch in the rail turns it off and on, remembered in the settings. Offline, or when YouTube does not open (or the author forbids the video outside YouTube), a line says so and the piece works as before
- The import notes where the piece's first bar lies in the video and the speed it was watched at, so a piece recognised before this version has no video on the practice screen until it is recognised again
- The tempo of a recognised piece is the slope of a line through the whole pulse rather than the mean gap between notes: finer, so the video stays with the bars to the end of a long piece
- The restart button's tooltip names its key, Enter, as the Start button's names Space

## v0.6.1 — 2026-10-25

Pieces from videos: a held-out check on 34 tutorials from other channels (Rutube and Dailymotion mirrors of PlutaX, PHianonize, Sheet Music Boss, Betacustic, Toms Mucenieks, Piano Tutorial Easy, OnlinePianist, PianoKafe and others, two keyboard-with-sheet-music renderers, three glow visualisers, a vertical short and five filmed pianos) showed the recognition tuned to the two videos it was built on. Reworked to take more from the video itself and fewer fixed numbers. Over the 28 videos where a lit keyboard was found, the melody notes found went from 54% to 85%, wrong notes from 5% to 2%, extra notes from 6% to 3%, the rhythm of neighbouring notes from 60% to 89% and the bar lines from 34% to 62%; two of the filmed pianos are now told apart and sent to listening by ear.

- **By ear first.** The video screen now listens by default: any piano video will do, a filmed one too, and the result is a draft with the hands split by pitch. A switch next to Recognise, kept in the settings, turns on recognition by the lit keys instead (Synthesia-style videos: exact notes and hands by colour); it applies to a YouTube link, another tab and a file alike
- Keys are judged against their resting colour over the whole video (a median), not against one calibration frame: videos that fade in, or open on a title over the keys, lost almost every note before
- How far a key's colour must stray to count as a press comes from the point's own noise, capped by what points of its kind need; a change that only darkens a key (a shadow, a caption, a fade) never counts
- The falling bars always help split repeated notes: a bar's landing is trusted only while its bottom keeps coming down at the measured speed (a glow where bars land, or a letter printed low on a bar, stands still), and cuts keep clear of a note's ends by the lag this video shows between a bar landing and the key lighting
- The keyboard: every row of black keys in the frame is a candidate (a drawn keyboard above a filmed one), a label across the black keys no longer ends them, a keyboard's white keys end above the next dark shapes after a white run, and a pattern with dark shapes in the E–F and B–C gaps is not a keyboard (digits in a caption were)
- Choosing between keyboards: the one whose keys light up vividly, never the one right under another; the reference frame is the brightest calm sighting
- Hands by colour: the two hues come from the peaks of the hue histogram weighted by saturation (two colours used to collapse into one), and two hues that also sit in two registers are two hands even when a little loose
- Time: the tatum (the finest pulse the notes sit on) is read from the gaps between onsets, corrected for what a short period explains by chance; the bar is chosen among the usual lengths in tatums by repetition and accents, and written as the reading whose quarter note is near half a second (4/4 slightly preferred, 2/4 and 3/8 slightly not, 6/8, 9/8 and 12/8 when accents fall in threes). A slow tutorial is written slow; nothing presumes 100 bpm any more
- A close-up keyboard that does not say its octave starts from the octave the piece's register suggests (left hand around the C below middle C)
- Notes that could not have been played — more than ten at once, a dozen a second, or a note starting while two of its nearest neighbours are down (hands over a filmed piano) — are not a piece: the app says the keys do not light up and offers to listen instead
- `scripts/bench-video.mjs`: the recognition on a video file against a library piece (ffmpeg; melody found, wrong and extra notes, hands, rhythm, bar lines), on a manifest of videos, with before/after comparison; videos never enter the repository. With `--audio` it measures the fallback by ear the same way: on the same 34 videos the ear finds 80% of the melody notes, but 14% of them wrong (half of those an octave up) and with 17% extra notes (mostly the left hand above middle C, which the import puts into the right hand); its rhythm is as good as the picture's, its bars a little worse. It is what makes a filmed piano usable: 44–98% of the melody on the six videos without a lit keyboard

## v0.6.0 — 2026-10-25

A new look, and a practice screen that no longer falls apart on smaller windows.

- **Three looks**, in Settings: *Paper* (a printed score on warm paper, the keys in a black case behind a red felt strip, the default on a light system), *Lacquer* (the same at night, the default on a dark system) and *Console* (an aluminium panel with keycap buttons and a dark screen). The canvas, the home picture, the progress colours and the video piano roll all follow the look; the browser's own bar takes its colour too
- Type: Piazzolla for titles and the count-in, JetBrains Mono for labels and numbers, Golos Text for the rest; bundled for offline use, Latin and Cyrillic only
- **Practice screen rebuilt.** One rail on the left instead of a toolbar that wrapped into three rows: the piece, the mode with a line on what it does, a large Start / Pause, restart and record, tempo with − and +, the hands (left · both · right in the order they sit on the keys) and *The trainer plays the other hand*; Progress, Settings and the keyboard's status at the bottom. On a phone the rail becomes a header and a row of controls under the keys
- **Strip of bars** above the stage, every bar as wide as it is long: click a bar or drag across several to practise just those, shift-click to extend, click a section's name to take the section; a bracket marks the practised bars (dashed when the loop is off), a line follows the music, and a stripe under each bar shows its mistakes. Replaces the section chips row
- **The next notes on a picture of the hands**: every fingertip in its finger's colour (so it is also the legend), the fingers to press filled in, the trainer's hand dashed; below it the note names with finger numbers and names, the bar and the counts
- The stage: lanes under the black keys and a line at every C, bars land on a felt strip, the keys are drawn as keys (ivory with a shadow under the felt, black keys with a lip, off-centre as on a piano), left-hand bars are outlined instead of dimmed, the finger number sits in a chip at the leading edge, the next key gets a pad in the finger's colour, keys played by the trainer in Listen mode light up in the finger's colour, and the count-in is set large in the display face
- "Play the highlighted key to start" and "waiting for your key" now appear just above the keys, where you are looking
- **Without a MIDI keyboard the keys show their computer letters** (A–L, W E T Y U O), following Z / X
- The result of a pass appears large (94 %, "your best yet!") instead of in a line of text; recording shows its time on the record button, which turns into a stop button
- Settings and Progress open as sheets from the right edge with a close button, instead of popovers that ran off the screen; Settings has the looks as small pictures and a list of keyboard shortcuts; long instrument names no longer push the sheet wider than the window
- **Home**: a headline and a small animated picture of Ode to Joy falling onto the keys with its fingering; the keyboard's status as a line with its name and size; *Pick up where you left off* as a large button; the library as the contents page of a songbook, grouped by difficulty, with dotted leaders; your files in the same style with a remove button
- New icon: a red disc over keys
- Fixed: a hit ripple that started a moment after the frame could throw while drawing and freeze the stage until the page was reloaded; the drawing loop now carries on after an error
- Fixed: the lead-in before bar 1 was shaded as if it were outside the loop

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
