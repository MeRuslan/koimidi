# Changelog

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
