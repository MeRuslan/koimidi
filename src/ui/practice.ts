/**
 * Practice screen: the rail on the left (piece, mode, transport, tempo, hands,
 * the next notes on a picture of the hands), the strip of bars above the
 * stage (loop range), the stage itself, hints, the note picker (finger, hand,
 * delete), editing the notes on the stage, recording, and the settings and
 * progress sheets.
 */
import type { App, PieceInfo } from '../app';
import { fingerName, getLang, keysLabel, noteName, t, type Key } from '../i18n';
import { libraryItems } from '../library';
import { ComputerKeyboard } from '../input/keyboard';
import { KEYBOARD_SIZES, type KeyboardChoice } from '../input/profile';
import { Engine, type HandSel, type Mode, type PassStats, type Summary } from '../practice/engine';
import { addPass, emptyProgress, type PassResult, type PieceProgress } from '../practice/progress';
import { Recorder, takeToMidi, type Take } from '../practice/recorder';
import { Stage } from '../render/stage';
import { suggestedSource } from '../score/edits';
import { bpmAt, measureAt, type Finger, type Hand, type Score, type ScoreNote } from '../score/model';
import { emptyNoteEdits, hasNoteEdits, PieceEditor, roomUntil, type PieceEdits } from '../score/note-edits';
import type { MidiSplit } from '../score/midi';
import { toMusicXML } from '../score/musicxml-export';
import { scoreFromStored } from '../importer';
import { getFile, putPieceEdits } from '../storage/files';
import { deleteProgress, getProgress, putProgress } from '../storage/progress';
import { clearPieceSettings, loadPieceSettings, savePieceSettings } from '../storage/settings';
import { fingerColor, onThemeChange, THEMES, type ThemeChoice } from '../theme';
import { $, download, el, formatDuration, paintRange, safeFileName, toast } from './dom';
import { HandMap } from './hands';
import { NoteEditing } from './note-editing';
import { percent, ProgressPanel } from './progress-panel';
import { Timeline } from './timeline';
import { VideoPanel } from './video-panel';

const DIGITS: Record<string, Finger> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5 };
/** arrow keys while editing: keys up or down, steps later or earlier */
const ARROWS: Record<string, [keys: number, steps: number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export class PracticeView {
  active = false;
  engine: Engine | null = null;
  score: Score | null = null;
  private info: PieceInfo | null = null;
  /** the player's edits of this piece (fingers, notes) and their undo */
  private editor: PieceEditor | null = null;
  /** edits are stored one after another, so an older copy never lands last */
  private saving: Promise<void> = Promise.resolve();
  private editing: NoteEditing;
  private stage: Stage;
  private kb: ComputerKeyboard;
  private dirty = true;
  private hintUntil = 0;
  private lastNext = '';
  private lastStats = '';
  private pointers = new Map<number, number>();
  private last = performance.now();
  /** note whose finger picker is open */
  private picked: ScoreNote | null = null;
  private recorder = new Recorder();
  private take: Take | null = null;
  private takeSaved = true;
  private takeTimers: ReturnType<typeof setTimeout>[] = [];
  private recTimer: ReturnType<typeof setInterval> | undefined;
  /** this piece's practice progress, once loaded from storage */
  private progress: PieceProgress | null = null;
  /** result of the last complete pass, for the end-of-piece hint */
  private lastPass: PassResult | null = null;
  private panel: ProgressPanel;
  private timeline: Timeline;
  private hands: HandMap;
  /** the video a piece was recognised from, in step with the bars */
  private video: VideoPanel;
  /** show which computer keys play which notes (no MIDI keyboard) */
  private letters = false;
  /** the hands the picture of the hands was built for */
  private handsKey = '';

  constructor(private app: App) {
    this.stage = new Stage($<HTMLCanvasElement>('stage'));
    this.editing = new NoteEditing(
      {
        piece: () => (this.score && this.engine && this.editor ? { score: this.score, engine: this.engine, editor: this.editor } : null),
        edited: (n) => this.noteEdited(n),
        pick: (n) => this.openPicker(n),
        picking: () => !!this.picked,
        unpick: () => this.closePicker(),
        audition: (p, beats) => this.audition(p, beats),
        redraw: () => (this.dirty = true),
      },
      this.stage,
      $<HTMLCanvasElement>('stage'),
    );
    this.timeline = new Timeline($('tlTrack'), (from, to) => this.setRange(from, to));
    this.hands = new HandMap($('handmap'));
    this.video = new VideoPanel();
    onThemeChange(() => {
      this.stage.refreshPalette();
      this.lastNext = '';
      this.dirty = true;
    });
    this.panel = new ProgressPanel(
      (m) => {
        this.setRange(m, m);
        this.refreshPanel();
      },
      () => this.resetProgress(),
    );
    this.kb = new ComputerKeyboard({
      noteOn: (p, v) => this.noteOn(p, v),
      noteOff: (p) => this.noteOff(p),
      command: (code, e) => this.command(code, e),
    });
    this.wire();
    new ResizeObserver(() => this.stage.resize()).observe($('stage').parentElement!);
    requestAnimationFrame(this.frame);
  }

  /* ---------- open / close ---------- */

  /** Open a piece as the file gives it; the player's edits are applied here. */
  open(score: Score, info: PieceInfo, edits: PieceEdits): void {
    this.engine?.dispose(); // reports the previous piece's last pass while it is still current
    this.leaveEditing();
    this.score = score;
    this.info = info;
    this.editor = new PieceEditor(score, edits);
    this.lastPass = null;
    if (this.progress?.id !== info.id) {
      this.progress = null;
      void getProgress(info.id).then((p) => {
        if (this.info?.id !== info.id) return;
        this.progress = p;
        this.timeline.setHeat(p);
      });
    }
    const e = new Engine(score, {
      flash: (p, kind) => this.stage.flash(p, kind),
      ripple: (p, n) => this.stage.ripple(p, fingerColor(n.finger)),
      sound: (p, v, secs) => {
        if (this.video.sounding) return; // Listen mode with the video: its sound, not the synth's
        this.app.synth.unlock();
        this.app.synth.noteOn(p, v, secs);
      },
      wrongNote: (_p, wanted) => this.hintWrong(wanted),
      octaveHint: (p, want) => this.hintOctave(p, want),
      finished: (s) => this.hintFinished(s),
      change: () => (this.dirty = true),
      tick: (delay, accent) => this.app.synth.click(delay, accent),
      pass: (stats) => this.recordPass(info.id, stats),
    });
    this.engine = e;
    const s = this.app.settings;
    const ps = loadPieceSettings(info.id);
    e.mode = s.mode;
    e.loop = s.loop;
    e.anyOctave = s.anyOctave;
    e.countIn = s.countIn;
    e.metronome = s.metronome;
    e.accompany = s.accompany;
    e.speed = ps.speed ?? s.speed;
    e.setHand(ps.hand && this.handAvailable(ps.hand) ? ps.hand : e.pickHand());
    e.setRangeMeasures(ps.from ?? 1, ps.to ?? e.lastMeasure());
    this.stage.nameStyle = this.app.nameStyle();
    this.stage.profile = this.app.keyboardRange();
    this.stage.attach(score, e);
    this.kb.fitTo(e.activeNotes.map((n) => n.pitch));
    this.timeline.build(score);
    this.timeline.setHeat(this.progress?.id === info.id ? this.progress : null);
    this.buildHands(true);
    this.video.open(info.video ?? null, score, s.video);
    this.active = true;
    this.closeSettings();
    this.closePicker();
    this.hideHint();
    this.lastNext = this.lastStats = '';
    this.syncControls();
    this.renderTake();
    this.renderTitle();
    this.renderEditBar();
    this.warnFit();
    this.dirty = true;
  }

  close(): void {
    this.leaveEditing();
    if (this.recorder.recording) this.stopRecording();
    this.stopTakePlayback();
    this.active = false;
    this.engine?.setPlaying(false);
    this.engine?.dispose();
    this.video.close();
    this.app.synth.allOff();
    this.kb.releaseAll();
    this.closeSettings();
    this.panel.close();
    this.closePicker();
    document.title = 'koimidi — free piano trainer';
  }

  /** Draw one frame immediately (used by automated checks while the tab is in the background). */
  renderNow(): void {
    if (!this.active) return;
    this.updateHud();
    this.dirty = false;
    this.stage.draw(performance.now());
  }

  refreshTexts(): void {
    this.stage.nameStyle = this.app.nameStyle();
    this.lastNext = this.lastStats = '';
    $('picker').setAttribute('aria-label', t('picker.label'));
    this.syncControls();
    this.renderTitle();
    if (this.score) {
      this.timeline.build(this.score);
      this.timeline.setHeat(this.progress);
      this.buildHands(true);
    }
    this.renderTake();
    this.renderThemes();
    this.renderEditTitles();
    this.video.refreshTexts();
    this.refreshPanel();
    this.dirty = true;
  }

  /** The piece's name in the rail and the tab; library pieces have Russian names too. */
  private renderTitle(): void {
    const score = this.score;
    const info = this.info;
    if (!score || !info) return;
    const lib = info.source === 'library' && getLang() === 'ru' ? libraryItems().find((i) => i.id === info.id) : undefined;
    const title = lib?.titleRu ?? score.title;
    $('pieceTitle').textContent = title;
    $('pieceComposer').textContent = lib?.composerRu ?? score.composer ?? '';
    document.title = `${title} · koimidi`;
  }

  /** Letters of the computer keys on the on-screen keyboard: on while no MIDI keyboard is connected. */
  showLetters(on: boolean): void {
    this.letters = on;
    this.dirty = true;
  }

  /**
   * Store progress including the pass under way, e.g. when the page is hidden
   * or closed. The pass itself goes on and is counted once it ends; the stored
   * snapshot is replaced then.
   */
  flushProgress(): void {
    const p = this.progress;
    if (!p) return;
    const cur = this.engine?.currentPass;
    if (!cur) return;
    const snap = structuredClone(p);
    addPass(snap, cur);
    void putProgress(snap);
  }

  /** The keyboard profile changed (setting or a newly connected device): refit the on-screen keyboard. */
  applyProfile(): void {
    if (!this.active || !this.engine) return;
    this.stage.profile = this.app.keyboardRange();
    this.stage.fitRange();
    this.lastStats = '';
    this.warnFit();
    this.dirty = true;
  }

  /** A recording that has not been saved yet (the app asks before the page closes). */
  hasUnsavedTake(): boolean {
    return this.recorder.recording || (!!this.take && !this.takeSaved);
  }

  private handAvailable(h: HandSel): boolean {
    const s = this.score!;
    return h === 'both' ? s.hands.R && s.hands.L : s.hands[h];
  }

  /* ---------- input ---------- */

  noteOn(p: number, vel: number): void {
    if (!this.active || !this.engine) return;
    this.recorder.noteOn(p, vel);
    if (this.editing.on) {
      // nothing is judged while editing; a key played with a note picked moves the note there
      if (this.app.settings.sound) {
        this.app.synth.unlock();
        this.app.synth.noteOn(p, vel);
      }
      if (this.picked) this.retune(this.picked, p);
      return;
    }
    if (this.app.settings.sound && this.engine.mode !== 'listen') {
      this.app.synth.unlock();
      this.app.synth.noteOn(p, vel);
    }
    this.engine.press(p, vel);
  }

  noteOff(p: number): void {
    this.recorder.noteOff(p);
    this.app.synth.noteOff(p);
    this.engine?.release(p);
  }

  sustain(on: boolean): void {
    this.recorder.pedal(on);
  }

  private command(code: string, ev: KeyboardEvent): boolean {
    if (!this.active || !this.engine) return false;
    const e = this.engine;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) {
      // only undo and redo; the rest belongs to the browser (⌘[ is Back)
      if (ev.altKey || !(code === 'KeyZ' || (code === 'KeyY' && ev.ctrlKey))) return false;
      if (code === 'KeyY' || ev.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    const sel = this.picked ?? (this.editing.on ? this.stage.selected : null);
    if (sel) {
      // Enter / Space on a focused button in the picker press that button
      if ((code === 'Enter' || code === 'Space') && $('picker').contains(document.activeElement)) return false;
      if (code in DIGITS) {
        this.chooseFinger(DIGITS[code], sel);
        return true;
      }
      if (code === 'Digit0' || code === 'Numpad0') {
        if (sel.fingerSource === 'user') this.chooseFinger(undefined, sel);
        return true;
      }
      if (code === 'Backspace' || code === 'Delete') {
        this.deleteNote(sel);
        return true;
      }
      if (this.editing.on && code in ARROWS) {
        const [keys, steps] = ARROWS[code];
        const beats = ev.shiftKey ? 4 / this.score!.timeSig[1] : this.stage.editGrid();
        const m = this.editing.nudge(sel, ev.shiftKey ? keys * 12 : keys, steps * beats);
        if (m && this.picked) this.openPicker(m);
        return true;
      }
    }
    switch (code) {
      case 'Space':
        this.togglePlay();
        return true;
      case 'Enter':
        if (this.editing.on) this.setEditing(false);
        e.restart();
        return true;
      case 'Escape':
        if (this.picked) this.closePicker();
        else if (!$('settings').hidden) this.closeSettings();
        else if (this.panel.open) this.panel.close();
        else if (this.editing.on && this.stage.selected) {
          this.stage.selected = null;
          this.dirty = true;
        } else if (this.editing.on) this.setEditing(false);
        else this.app.showHome();
        return true;
      case 'BracketLeft': {
        const m = measureAt(this.score!, e.pos);
        this.setRange(m, Math.max(m, e.rangeMeasures[1]));
        return true;
      }
      case 'BracketRight': {
        const m = measureAt(this.score!, e.pos);
        this.setRange(Math.min(m, e.rangeMeasures[0]), m);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---------- controls ---------- */

  private wire(): void {
    const s = this.app.settings;
    $('back').addEventListener('click', () => this.app.showHome());
    $('play').addEventListener('click', () => this.togglePlay());
    $('restart').addEventListener('click', () => this.engine?.restart());
    $('edit').addEventListener('click', () => this.setEditing(!this.editing.on));
    $('editDone').addEventListener('click', () => this.setEditing(false));
    $('editUndo').addEventListener('click', () => this.undo());
    $('editRedo').addEventListener('click', () => this.redo());
    this.renderEditTitles();
    $('rec').addEventListener('click', () => this.toggleRecording());
    document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked) return;
        s.mode = r.value as Mode;
        this.app.save();
        this.keepPlace(() => this.engine?.setMode(s.mode));
        this.hideHint();
        this.syncControls();
        this.refreshPanel();
      }),
    );
    $('metro').addEventListener('click', () => {
      s.metronome = !s.metronome;
      this.app.save();
      this.app.synth.unlock();
      this.engine?.setMetronome(s.metronome);
      this.syncControls();
    });
    document.querySelectorAll<HTMLInputElement>('input[name=hand]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked || !this.engine) return;
        const e = this.engine;
        this.keepPlace(() => e.setHand(r.value as HandSel));
        this.stage.fitRange();
        this.kb.fitTo(this.engine.activeNotes.map((n) => n.pitch));
        this.savePiece();
        this.closePicker();
        this.lastStats = '';
        this.warnFit();
        this.syncControls();
        this.refreshPanel();
      }),
    );
    const accomp = $<HTMLInputElement>('accomp');
    accomp.addEventListener('change', () => {
      s.accompany = accomp.checked;
      this.app.save();
      if (!this.engine) return;
      this.engine.setAccompany(s.accompany);
      this.stage.fitRange();
      this.syncControls();
    });
    const videoOn = $<HTMLInputElement>('videoOn');
    videoOn.addEventListener('change', () => {
      s.video = videoOn.checked;
      this.app.save();
      this.video.setOn(s.video);
    });
    const tempo = $<HTMLInputElement>('tempo');
    const setTempo = (pct: number) => {
      if (!this.engine) return;
      pct = Math.max(+tempo.min, Math.min(+tempo.max, Math.round(pct / 5) * 5));
      tempo.value = String(pct);
      this.engine.speed = pct / 100;
      s.speed = this.engine.speed;
      this.app.save();
      this.savePiece();
      this.renderTempo();
    };
    tempo.addEventListener('input', () => setTempo(+tempo.value));
    $('tempoDown').addEventListener('click', () => setTempo(+tempo.value - 5));
    $('tempoUp').addEventListener('click', () => setTempo(+tempo.value + 5));
    const from = $<HTMLInputElement>('rangeFrom');
    const to = $<HTMLInputElement>('rangeTo');
    const apply = () => this.setRange(parseInt(from.value, 10) || 1, parseInt(to.value, 10) || 1);
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
    $('rangeAll').addEventListener('click', () => this.setRange(1, this.engine?.lastMeasure() ?? 1));
    const loop = $<HTMLInputElement>('loop');
    loop.addEventListener('change', () => {
      s.loop = loop.checked;
      this.app.save();
      if (this.engine) this.engine.loop = loop.checked;
      this.syncControls();
    });
    const canvas = $<HTMLCanvasElement>('stage');
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = local(e);
      if (this.editing.down(e, x, y)) return;
      const p = this.stage.hitTest(x, y);
      if (p === null) {
        // above the keyboard: a bar opens the finger picker
        const n = this.stage.noteAt(x, y);
        if (n) this.openPicker(n);
        else this.closePicker();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, p);
      this.noteOn(p, 0.7);
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (p === undefined) return;
      this.pointers.delete(e.pointerId);
      this.noteOff(p);
    };
    canvas.addEventListener('pointermove', (e) => {
      const { x, y } = local(e);
      this.editing.move(e, x, y);
    });
    canvas.addEventListener('pointerup', (e) => {
      const { x, y } = local(e);
      if (!this.editing.up(e, x, y)) up(e);
    });
    canvas.addEventListener('pointercancel', (e) => {
      this.editing.cancel();
      up(e);
    });
    canvas.addEventListener('pointerleave', () => this.editing.leave());
    canvas.addEventListener('wheel', (e) => this.editing.wheel(e), { passive: false });

    // finger picker
    const picker = $('picker');
    picker.setAttribute('aria-label', t('picker.label'));
    const fingers = $('pickerFingers');
    for (let f = 1 as Finger; f <= 5; f = (f + 1) as Finger) {
      const b = el('button', { type: 'button', class: 'pf', 'data-f': String(f) }, [el('b', { text: String(f) })]);
      b.style.setProperty('--c', `var(--f${f})`);
      b.addEventListener('click', () => this.chooseFinger(f));
      fingers.append(b);
    }
    $('pickerReset').addEventListener('click', () => this.chooseFinger(undefined));
    $('pickerDelete').addEventListener('click', () => this.picked && this.deleteNote(this.picked));
    document.querySelectorAll<HTMLInputElement>('input[name=pickHand]').forEach((r) =>
      r.addEventListener('change', () => r.checked && this.picked && this.setNoteHand(this.picked, r.value as Hand)),
    );
    addEventListener('pointerdown', (e) => {
      if (!this.picked) return;
      const target = e.target as Node;
      if (!picker.contains(target) && target !== canvas) this.closePicker();
    });

    // recording row
    $('takeStop').addEventListener('click', () => this.stopRecording());
    $('takePlay').addEventListener('click', () => this.toggleTakePlayback());
    $('takeSave').addEventListener('click', () => this.saveTake());
    $('takeDiscard').addEventListener('click', () => {
      if (!this.takeSaved && !confirm(t('take.discardConfirm'))) return;
      this.stopTakePlayback();
      this.take = null;
      this.takeSaved = true;
      this.renderTake();
    });

    // progress popover
    const progBtn = $('progressBtn');
    progBtn.addEventListener('click', () => {
      if (this.panel.open) this.panel.close();
      else if (this.engine && this.score) {
        this.closeSettings();
        this.closePicker();
        this.panel.show(this.progress, this.engine, this.score);
      }
    });
    addEventListener('pointerdown', (e) => {
      if (!this.panel.open) return;
      const target = e.target as Node;
      if (!$('progress').contains(target) && !progBtn.contains(target)) this.panel.close();
    });

    // settings popover
    const btn = $('settingsBtn');
    const pop = $('settings');
    btn.addEventListener('click', () => (pop.hidden ? this.openSettings() : this.closeSettings()));
    pop.querySelector('[data-close]')!.addEventListener('click', () => this.closeSettings());
    this.renderThemes();
    addEventListener('pointerdown', (e) => {
      if (pop.hidden) return;
      const target = e.target as Node;
      if (!pop.contains(target) && !btn.contains(target)) this.closeSettings();
    });
    $('exportXml').addEventListener('click', () => this.exportMusicXML());
    $('resetFingers').addEventListener('click', () => {
      const ed = this.editor;
      const n = ed ? Object.keys(ed.edits.fingers).length : 0;
      if (!ed || !n || !confirm(t('settings.resetFingersConfirm', { n }))) return;
      ed.clearFingers();
      this.saveEdits();
      this.lastNext = '';
      this.dirty = true;
      this.renderEditBar();
      this.closeSettings();
    });
    $('resetNotes').addEventListener('click', () => {
      const ed = this.editor;
      if (!ed || !hasNoteEdits(ed.edits.notes) || !confirm(t('settings.resetNotesConfirm'))) return;
      ed.clearNotes();
      this.closePicker();
      this.noteEdited(null);
      this.closeSettings();
    });
    const sound = $<HTMLInputElement>('sound');
    sound.addEventListener('change', () => {
      s.sound = sound.checked;
      this.app.save();
      if (!s.sound) this.app.synth.allOff();
    });
    const volume = $<HTMLInputElement>('volume');
    volume.addEventListener('input', () => {
      paintRange(volume);
      s.volume = +volume.value;
      this.app.synth.setVolume(s.volume);
      this.app.save();
    });
    const countIn = $<HTMLInputElement>('countIn');
    countIn.addEventListener('change', () => {
      s.countIn = countIn.checked;
      this.app.save();
      this.engine?.setCountIn(s.countIn);
    });
    const keyboard = $<HTMLSelectElement>('keyboard');
    keyboard.addEventListener('change', () => {
      s.keyboard = keyboard.value as KeyboardChoice;
      this.app.save();
      this.applyProfile();
      this.app.renderMidiStatus();
    });
    const anyOct = $<HTMLInputElement>('anyOct');
    anyOct.addEventListener('change', () => {
      s.anyOctave = anyOct.checked;
      this.app.save();
      if (this.engine) this.engine.anyOctave = anyOct.checked;
    });
    const names = $<HTMLSelectElement>('noteNames');
    names.addEventListener('change', () => {
      s.noteNames = names.value as typeof s.noteNames;
      this.app.save();
      this.refreshTexts();
    });
    const split = $<HTMLSelectElement>('midiSplit');
    split.addEventListener('change', () => void this.changeSplit(split.value as MidiSplit));
    const lang = $<HTMLSelectElement>('lang');
    lang.addEventListener('change', () => this.app.setLanguage(lang.value as 'ru' | 'en'));
    $('resetPiece').addEventListener('click', () => {
      if (!this.info || !this.engine) return;
      clearPieceSettings(this.info.id);
      this.engine.speed = s.speed;
      this.engine.setHand(this.engine.pickHand());
      this.engine.setRangeMeasures(1, this.engine.lastMeasure());
      this.stage.fitRange();
      this.syncControls();
      this.closeSettings();
    });
  }

  private togglePlay(): void {
    if (!this.engine) return;
    // Space while editing: done, and play from here
    if (this.editing.on) this.setEditing(false);
    this.app.synth.unlock();
    this.closePicker();
    this.engine.toggle();
    // still inside the user's gesture: the video may start with its sound
    this.video.sync(this.engine, performance.now());
    this.hideHint();
  }

  private setRange(from: number, to: number): void {
    if (!this.engine) return;
    this.engine.setRangeMeasures(from, to);
    this.savePiece();
    this.syncControls();
    this.refreshPanel();
  }

  private savePiece(): void {
    if (!this.info || !this.engine) return;
    const e = this.engine;
    const prev = loadPieceSettings(this.info.id);
    savePieceSettings(this.info.id, { ...prev, from: e.rangeMeasures[0], to: e.rangeMeasures[1], hand: e.hand, speed: e.speed });
  }

  private async changeSplit(split: MidiSplit): Promise<void> {
    if (!this.info || this.info.source !== 'file' || this.info.kind !== 'midi') return;
    const f = await getFile(this.info.id);
    if (!f) return;
    const prev = loadPieceSettings(this.info.id);
    savePieceSettings(this.info.id, { ...prev, split, hand: undefined });
    this.app.settings.midiSplit = split;
    this.app.save();
    const score = scoreFromStored(f, split);
    this.open(score, this.info, this.editor?.edits ?? { fingers: {}, notes: emptyNoteEdits() });
  }

  private openSettings(): void {
    const s = this.app.settings;
    this.closePicker();
    this.panel.close();
    $<HTMLInputElement>('sound').checked = s.sound;
    $<HTMLInputElement>('volume').value = String(s.volume);
    paintRange($<HTMLInputElement>('volume'));
    $<HTMLInputElement>('countIn').checked = s.countIn;
    $<HTMLInputElement>('anyOct').checked = s.anyOctave;
    $<HTMLSelectElement>('noteNames').value = s.noteNames;
    $<HTMLSelectElement>('lang').value = this.app.lang;
    this.fillKeyboardSelect();
    void this.app.sound.render();
    const isMidi = this.info?.source === 'file' && this.info.kind === 'midi';
    $('midiSplitRow').hidden = !isMidi;
    if (isMidi) $<HTMLSelectElement>('midiSplit').value = loadPieceSettings(this.info!.id).split ?? s.midiSplit;
    const edited = this.editor ? Object.keys(this.editor.edits.fingers).length : 0;
    const reset = $('resetFingers');
    reset.hidden = edited === 0;
    reset.textContent = t('settings.resetFingers', { n: edited });
    $('resetNotes').hidden = !this.editor || !hasNoteEdits(this.editor.edits.notes);
    this.renderThemes();
    $('settings').hidden = false;
    $('settingsBtn').setAttribute('aria-expanded', 'true');
  }

  /** The looks, each as a small picture of the stage in its own colours. */
  private renderThemes(): void {
    const box = $('themes');
    const current = this.app.settings.theme;
    const choices: ThemeChoice[] = ['auto', ...THEMES];
    box.replaceChildren(
      ...choices.map((c) => {
        const input = el('input', { type: 'radio', name: 'theme', value: c });
        input.checked = c === current;
        input.addEventListener('change', () => input.checked && this.app.setTheme(c));
        const bars = [
          ['18%', '34px', 1],
          ['40%', '22px', 3],
          ['63%', '40px', 4],
          ['80%', '16px', 2],
        ].map(([left, h, f]) => {
          const i = el('i');
          i.style.cssText = `left:${left};height:${h};background:var(--f${f})`;
          return i;
        });
        const prev = el('span', { class: `theme-prev${c === 'auto' ? ' split' : ''}`, ...(c === 'auto' ? {} : { 'data-theme': c }) }, [...bars, el('span', { class: 'kb' })]);
        return el('label', { class: 'theme' }, [input, prev, el('span', { class: 'theme-name', text: t(`theme.${c}` as Key) })]);
      }),
    );
  }

  private fillKeyboardSelect(): void {
    const sel = $<HTMLSelectElement>('keyboard');
    const det = this.app.detectedKeyboard();
    const what = det ? `${keysLabel(+det.size)} (${det.name})` : t('settings.keyboard.fit');
    sel.replaceChildren(
      el('option', { value: 'auto', text: t('settings.keyboard.auto', { what }) }),
      ...KEYBOARD_SIZES.map((k) => el('option', { value: k, text: keysLabel(+k) })),
    );
    sel.value = this.app.settings.keyboard;
  }

  private closeSettings(): void {
    $('settings').hidden = true;
    $('settingsBtn').setAttribute('aria-expanded', 'false');
  }

  /** Push engine state into the controls. */
  private syncControls(): void {
    const e = this.engine;
    const score = this.score;
    if (!e || !score) return;
    document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) => (r.checked = r.value === e.mode));
    $('modeHint').textContent = t(`mode.${e.mode}.hint` as Key);
    const metro = $('metro');
    metro.hidden = e.mode === 'learn';
    metro.setAttribute('aria-pressed', String(e.metronome));
    const hands = $('hands');
    hands.hidden = !(score.hands.R && score.hands.L);
    document.querySelectorAll<HTMLInputElement>('input[name=hand]').forEach((r) => (r.checked = r.value === e.hand));
    $('accompRow').hidden = hands.hidden || e.hand === 'both';
    $<HTMLInputElement>('accomp').checked = e.accompany;
    $<HTMLInputElement>('tempo').value = String(Math.round(e.speed * 100));
    this.renderTempo();
    const from = $<HTMLInputElement>('rangeFrom');
    const to = $<HTMLInputElement>('rangeTo');
    from.max = to.max = String(e.lastMeasure());
    from.value = String(e.rangeMeasures[0]);
    to.value = String(e.rangeMeasures[1]);
    $<HTMLInputElement>('loop').checked = e.loop;
    $('rangeAll').hidden = e.rangeMeasures[0] === 1 && e.rangeMeasures[1] === e.lastMeasure();
    this.timeline.setRange(e.rangeMeasures[0], e.rangeMeasures[1], e.loop);
    this.renderPlay();
  }

  private renderTempo(): void {
    const e = this.engine;
    if (!e || !this.score) return;
    const tempo = $<HTMLInputElement>('tempo');
    paintRange(tempo);
    const bpm = Math.round(bpmAt(this.score, 0) * e.speed);
    $('tempoVal').innerHTML = `${Math.round(e.speed * 100)}% <small>· ♩ ${bpm}</small>`;
    $('tempoDown').toggleAttribute('disabled', +tempo.value <= +tempo.min);
    $('tempoUp').toggleAttribute('disabled', +tempo.value >= +tempo.max);
  }

  private renderPlay(): void {
    const playing = !!this.engine?.playing;
    const label = playing ? t('pause') : t('play');
    const text = $('playLabel');
    // called on every redrawn frame of the HUD: touch the DOM only when something changed
    if (text.textContent === label) return;
    $('play').classList.toggle('on', playing);
    text.textContent = label;
  }

  /* ---------- finger editing ---------- */

  private openPicker(n: ScoreNote): void {
    const e = this.engine;
    if (!e) return;
    if (e.playing) e.setPlaying(false);
    this.closeSettings();
    this.picked = n;
    this.stage.selected = n;
    // the hand is in the switch below
    $('pickerNote').textContent = t('picker.head', { note: noteName(n.pitch, this.app.nameStyle()), m: n.measure });
    const src = n.fingerSource;
    $('pickerSrc').textContent = src ? t(`picker.src.${src}` as Key) : '';
    document.querySelectorAll<HTMLInputElement>('input[name=pickHand]').forEach((r) => (r.checked = r.value === n.hand));
    $('pickerRetune').hidden = !this.editing.on;
    $('pickerFingers')
      .querySelectorAll<HTMLButtonElement>('.pf')
      .forEach((b) => {
        const f = +b.dataset.f!;
        b.setAttribute('aria-pressed', String(n.finger === f));
        b.title = `${f} · ${fingerName(f)}`;
        b.setAttribute('aria-label', b.title);
      });
    const reset = $('pickerReset');
    reset.hidden = src !== 'user';
    reset.title = suggestedSource(n) ? t(`picker.src.${suggestedSource(n)}` as Key) : '';
    this.placePicker(n);
    this.dirty = true;
  }

  private placePicker(n: ScoreNote): void {
    const picker = $('picker');
    const wrap = picker.parentElement!;
    picker.hidden = false;
    const a = this.stage.barAnchor(n) ?? { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
    const pw = picker.offsetWidth;
    const ph = picker.offsetHeight;
    const gap = 16;
    let x = a.x + gap;
    if (x + pw > wrap.clientWidth - 8) x = a.x - gap - pw;
    x = Math.max(8, Math.min(x, wrap.clientWidth - pw - 8));
    // clear of the editing bar at the top while editing
    const minY = this.editing.on ? $('editBar').offsetTop + $('editBar').offsetHeight + 8 : 8;
    const y = Math.max(minY, Math.min(a.y - ph / 2, this.stage.waterY - ph - 8));
    picker.style.left = `${x}px`;
    picker.style.top = `${y}px`;
    const current = picker.querySelector<HTMLButtonElement>('.pf[aria-pressed=true]') ?? picker.querySelector<HTMLButtonElement>('.pf');
    current?.focus({ preventScroll: true });
  }

  private closePicker(): void {
    if (!this.picked && $('picker').hidden) return;
    this.picked = null;
    this.stage.selected = null;
    $('picker').hidden = true;
    this.dirty = true;
  }

  private chooseFinger(f: Finger | undefined, n: ScoreNote | null = this.picked): void {
    if (!n || !this.editor) return;
    this.editor.setFinger(n, f);
    this.saveEdits();
    this.closePicker();
    // while editing the note stays chosen, for the arrow keys
    if (this.editing.on) this.stage.selected = n;
    this.lastNext = '';
    this.renderEditBar();
    if (f) this.showHint(t('hint.fingerSet', { f, fname: fingerName(f) }), 2200, true);
    else this.showHint(t('hint.fingerReset'), 1800, true);
  }

  /* ---------- editing the notes ---------- */

  private setEditing(on: boolean): void {
    const e = this.engine;
    if (!e || this.editing.on === on) return;
    this.closePicker();
    this.editing.setOn(on);
    this.stage.selected = null;
    if (on) {
      e.setPlaying(false);
      this.hideHint();
    } else {
      // carry on from where the editing ended, or from the start of the bars when that is outside them
      e.seek(e.pos);
      this.kb.fitTo(e.activeNotes.map((n) => n.pitch));
    }
    this.stage.fitRange();
    this.renderEditBar();
    this.lastNext = this.lastStats = '';
    this.syncControls();
    this.dirty = true;
  }

  /** Editing off without carrying on anywhere: another piece opens, or the screen closes. */
  private leaveEditing(): void {
    if (!this.editing.on) return;
    this.editing.setOn(false);
    this.stage.selected = null;
    this.renderEditBar();
  }

  /** While editing, a change of hand or mode keeps the bars where they are instead of starting over. */
  private keepPlace(change: () => void): void {
    const e = this.engine;
    if (!e || !this.editing.on) {
      change();
      return;
    }
    const pos = e.pos;
    change();
    e.pos = pos;
    e.reload();
    this.stage.selected = null;
  }

  /** The notes changed: store the edits, regroup the notes and keep `sel` chosen. */
  private noteEdited(sel: ScoreNote | null): void {
    const e = this.engine;
    if (!e || !this.score) return;
    this.saveEdits();
    // a note given to the other hand stays in sight: both hands are shown then
    let hand = e.hand;
    if (!this.handAvailable(hand)) hand = e.pickHand();
    else if (sel && hand !== 'both' && sel.hand !== hand) hand = 'both';
    if (hand !== e.hand) {
      const pos = e.pos;
      e.setHand(hand);
      e.pos = pos;
      this.kb.fitTo(e.activeNotes.map((n) => n.pitch));
    }
    e.reload();
    if (!this.editing.on) this.stage.fitRange();
    this.buildHands();
    this.stage.selected = sel;
    this.lastNext = this.lastStats = '';
    this.syncControls();
    this.renderEditBar();
    this.dirty = true;
  }

  /** The picture of the hands, built again when the piece's hands change (a note given to a hand that had none). */
  private buildHands(always = false): void {
    const h = this.score!.hands;
    const key = `${h.L} ${h.R}`;
    if (!always && key === this.handsKey) return;
    this.handsKey = key;
    this.hands.build(h);
  }

  private saveEdits(): void {
    const info = this.info;
    const ed = this.editor;
    if (!info || !ed) return;
    this.saving = this.saving.then(() => putPieceEdits(info.id, ed.edits));
  }

  private undo(): void {
    if (!this.editor?.undo()) return;
    this.closePicker();
    this.noteEdited(null);
    this.showHint(t('edit.undone'), 1400, true);
  }

  private redo(): void {
    if (!this.editor?.redo()) return;
    this.closePicker();
    this.noteEdited(null);
    this.showHint(t('edit.redone'), 1400, true);
  }

  private deleteNote(n: ScoreNote): void {
    const ed = this.editor;
    if (!ed) return;
    const name = noteName(n.pitch, this.app.nameStyle());
    ed.remove(n);
    this.closePicker();
    this.noteEdited(null);
    toast(t('note.deleted', { note: name }), { ms: 5000, action: { label: t('undo'), run: () => this.undo() } });
  }

  private setNoteHand(n: ScoreNote, hand: Hand): void {
    const ed = this.editor;
    if (!ed || n.hand === hand) return;
    const m = ed.change(n, { hand });
    this.noteEdited(m);
    this.openPicker(m);
    this.showHint(t(hand === 'L' ? 'hint.noteToL' : 'hint.noteToR', { note: noteName(m.pitch, this.app.nameStyle()) }), 2200, true);
  }

  /** A key played while editing with a note picked: the note goes to that key (with "any octave", into the octave nearest to it). */
  private retune(n: ScoreNote, p: number): void {
    const ed = this.editor;
    const score = this.score;
    if (!ed || !score) return;
    let pitch = p;
    if (this.app.settings.anyOctave) {
      pitch = p + 12 * Math.round((n.pitch - p) / 12);
      if (pitch > this.stage.high) pitch -= 12;
      if (pitch < this.stage.low) pitch += 12;
    }
    if (pitch === n.pitch) return;
    const dur = Math.min(n.dur, roomUntil(score, pitch, n.t, n) - n.t);
    if (dur <= 0) return;
    const style = this.app.nameStyle();
    const m = ed.change(n, { pitch, dur });
    this.noteEdited(m);
    this.openPicker(m);
    this.showHint(t('hint.noteRetuned', { from: noteName(n.pitch, style), to: noteName(m.pitch, style) }), 1800, true);
  }

  /** A note played briefly, to check it by ear. */
  private audition(p: number, beats: number): void {
    const score = this.score;
    const e = this.engine;
    if (!score || !e) return;
    this.app.synth.unlock();
    this.app.synth.noteOn(p, 0.7, Math.min(1.2, Math.max(0.15, (beats * 60) / (bpmAt(score, Math.max(0, e.pos)) * e.speed))));
  }

  private renderEditBar(): void {
    const on = this.editing.on;
    $('editBar').hidden = !on;
    $('stage').parentElement!.classList.toggle('editing', on);
    $('edit').setAttribute('aria-pressed', String(on));
    $<HTMLButtonElement>('editUndo').disabled = !this.editor?.canUndo;
    $<HTMLButtonElement>('editRedo').disabled = !this.editor?.canRedo;
  }

  private renderEditTitles(): void {
    const undo = $('editUndo');
    undo.title = t('edit.undo', { keys: MAC ? '⌘Z' : 'Ctrl+Z' });
    undo.setAttribute('aria-label', undo.title);
    const redo = $('editRedo');
    redo.title = t('edit.redo', { keys: MAC ? '⇧⌘Z' : 'Ctrl+Y' });
    redo.setAttribute('aria-label', redo.title);
  }

  /* ---------- progress ---------- */

  private recordPass(id: string, stats: PassStats): void {
    const p = this.progress?.id === id ? this.progress : null;
    if (!p) {
      // not loaded yet (or another piece is open by now): fold it into the stored copy
      void getProgress(id).then((q) => {
        addPass(q, stats);
        return putProgress(q);
      });
      return;
    }
    const r = addPass(p, stats);
    void putProgress(p);
    if (this.info?.id === id) this.timeline.setHeat(p);
    if (r && this.info?.id === id) {
      this.lastPass = r;
      // with the loop on the next pass starts at once: show how this one went
      if (this.engine?.loop) this.showResult(r, this.passWhat(stats.from, stats.to), '', 3500);
    }
    this.refreshPanel();
  }

  private passWhat(from: number, to: number): string {
    return from === 1 && to === this.engine!.lastMeasure() ? t('pass.whole') : t('pass.range', { from, to });
  }

  private refreshPanel(): void {
    if (this.panel.open && this.engine && this.score) this.panel.render(this.progress, this.engine, this.score);
  }

  private resetProgress(): void {
    if (!this.info) return;
    this.progress = emptyProgress(this.info.id);
    void deleteProgress(this.info.id);
    this.timeline.setHeat(this.progress);
    this.refreshPanel();
  }

  /* ---------- export ---------- */

  private exportMusicXML(): void {
    const score = this.score;
    if (!score) return;
    const xml = toMusicXML(score, { software: `koimidi ${__APP_VERSION__}`, date: localDate(new Date()) });
    const name = safeFileName(score.title, 'musicxml');
    download(name, xml, 'application/vnd.recordare.musicxml+xml');
    this.closeSettings();
    toast(t('file.saved', { name }));
  }

  /* ---------- recording ---------- */

  private toggleRecording(): void {
    if (!this.score) return;
    if (this.recorder.recording) {
      this.stopRecording();
      return;
    }
    if (this.take && !this.takeSaved && !confirm(t('take.replaceConfirm'))) return;
    this.stopTakePlayback();
    this.take = null;
    this.recorder.start(this.score.title);
    clearInterval(this.recTimer);
    this.recTimer = setInterval(() => this.renderTake(), 250);
    this.renderTake();
  }

  private stopRecording(): void {
    clearInterval(this.recTimer);
    this.recTimer = undefined;
    const take = this.recorder.stop();
    if (take) {
      this.take = take;
      this.takeSaved = false;
    } else toast(t('take.empty'));
    this.renderTake();
  }

  private toggleTakePlayback(): void {
    if (this.takeTimers.length) {
      this.stopTakePlayback();
      return;
    }
    const take = this.take;
    const e = this.engine;
    if (!take || !e) return;
    this.app.synth.unlock();
    if (e.playing) e.setPlaying(false);
    for (const n of take.notes) {
      this.takeTimers.push(
        setTimeout(() => {
          this.app.synth.noteOn(n.pitch, n.velocity, n.dur);
          e.keys.set(n.pitch, 'auto');
          this.dirty = true;
          this.takeTimers.push(setTimeout(() => e.keys.get(n.pitch) === 'auto' && e.keys.delete(n.pitch), Math.max(80, n.dur * 1000)));
        }, n.t * 1000),
      );
    }
    for (const p of take.pedal) this.takeTimers.push(setTimeout(() => this.app.synth.setSustain(p.on), p.t * 1000));
    this.takeTimers.push(setTimeout(() => this.stopTakePlayback(), take.duration * 1000 + 400));
    this.renderTake();
  }

  private stopTakePlayback(): void {
    if (!this.takeTimers.length) return;
    for (const tm of this.takeTimers) clearTimeout(tm);
    this.takeTimers = [];
    this.app.synth.setSustain(false);
    this.app.synth.allOff();
    if (this.engine) for (const [p, src] of [...this.engine.keys]) if (src === 'auto') this.engine.keys.delete(p);
    this.renderTake();
  }

  private saveTake(): void {
    const take = this.take;
    const score = this.score;
    if (!take || !score) return;
    const bpm = Math.round(bpmAt(score, 0) * (this.engine?.speed ?? 1));
    const data = takeToMidi(take, { bpm, timeSig: score.timeSig });
    const name = safeFileName(`${take.title} ${stamp(take.recordedAt)}`, 'mid');
    download(name, new Uint8Array(data), 'audio/midi');
    this.takeSaved = true;
    toast(t('file.saved', { name }));
  }

  private renderTake(): void {
    const row = $('takeRow');
    const rec = $('rec');
    const time = $('recTime');
    const live = this.recorder.recording;
    rec.classList.toggle('on', live);
    rec.setAttribute('aria-pressed', String(live));
    rec.querySelector('use')?.setAttribute('href', live ? '#i-stop' : '#i-rec');
    rec.title = t(live ? 'record.stop' : 'record');
    rec.setAttribute('aria-label', rec.title);
    time.hidden = !live;
    if (live) time.textContent = formatDuration(this.recorder.elapsed());
    row.classList.toggle('live', live);
    if (live) {
      $('takeText').textContent = t('take.recording', { time: formatDuration(this.recorder.elapsed()), n: this.recorder.count });
    } else if (this.take) {
      $('takeText').textContent = t('take.ready', { time: formatDuration(this.take.duration), n: this.take.notes.length });
      $('takePlay').textContent = this.takeTimers.length ? `■ ${t('take.stopPlay')}` : `▶ ${t('take.play')}`;
    }
    // while recording the record button itself shows the time and stops it; the card is for the finished take
    row.hidden = live || !this.take;
    $('takeStop').hidden = !live;
    for (const id of ['takePlay', 'takeSave', 'takeDiscard']) $(id).hidden = live;
  }

  /* ---------- HUD & hints ---------- */

  private frame = (now: number): void => {
    // asked first, so that one bad frame cannot stop the drawing for good
    requestAnimationFrame(this.frame);
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (this.active && this.engine) {
      const wasPlaying = this.engine.playing;
      this.engine.step(dt);
      this.video.sync(this.engine, now);
      if (wasPlaying !== this.engine.playing) this.renderPlay();
      if (this.hintUntil && now > this.hintUntil) this.hideHint();
      if (this.dirty) {
        this.updateHud();
        this.dirty = false;
      }
      this.stage.letters = this.letters ? this.kb.base : null;
      this.timeline.update(this.engine.pos);
      this.stage.draw(now);
    }
  };

  private badge(n: ScoreNote): string {
    return `<span class="finger" style="--c:${n.finger ? `var(--f${n.finger})` : 'var(--nofinger)'}">${n.finger ?? '?'}</span>`;
  }

  private updateHud(): void {
    const e = this.engine;
    const score = this.score;
    if (!e || !score) return;
    const style = this.app.nameStyle();
    const target = e.target;
    const pending = e.mode === 'listen' || !target ? [] : target.notes.filter((n) => e.noteState(n) !== 1);
    let next: string;
    if (e.mode === 'listen') next = `<span class="tip">${t('hud.listen')}</span>`;
    else if (!target) next = `<span class="lead">${t('hud.ended')}</span>`;
    else {
      const parts = pending.map((n) => {
        const hand = e.hand === 'both' ? ` <small>${t(n.hand === 'L' ? 'hand.L' : 'hand.R').toLowerCase()}</small>` : '';
        const fname = pending.length === 1 && n.finger ? ` <small>${fingerName(n.finger)}</small>` : '';
        return `<span class="nt">${noteName(n.pitch, style)}${this.badge(n)}${fname}${hand}</span>`;
      });
      next = `<span class="lead">${t('hud.next')}</span><span class="notes">${parts.join('')}</span>`;
    }
    if (next !== this.lastNext) {
      $('next').innerHTML = next;
      this.lastNext = next;
    }
    const sc = score.hands;
    this.hands.update({
      active: new Set(e.hand === 'both' ? ['L', 'R'] : [e.hand]),
      trainer: e.accompanying && e.hand !== 'both' ? (e.hand === 'R' ? 'L' : 'R') : null,
      outlined: e.hand === 'both' && sc.L && sc.R ? 'L' : null,
      next: pending.map((n) => ({ hand: n.hand, finger: n.finger })),
    });
    const m = Math.max(1, measureAt(score, e.pos));
    const n = e.lastMeasure();
    const num = (key: 'hud.hits' | 'hud.wrong' | 'hud.misses', v: number) => t(key, { n: `<b>${v}</b>` });
    let stats = `<span>${t('hud.bar', { m: `<b>${m}</b>`, n })}</span><span class="${e.hits ? 'ok' : ''}">${num('hud.hits', e.hits)}</span><span class="${e.wrong ? 'bad' : ''}">${num('hud.wrong', e.wrong)}</span>`;
    if (e.mode === 'tempo') stats += `<span class="${e.misses ? 'bad' : ''}">${num('hud.misses', e.misses)}</span>`;
    const rhythm = e.mode === 'listen' ? null : e.rhythm;
    if (rhythm) stats += `<span>${t('hud.rhythm', { n: `<b>${percent(rhythm.score)}</b>` })}</span>`;
    const pl = this.stage.placement;
    if (pl && pl.outside > 0) stats += `<span class="warn">⚠ ${t('kb.needs', { keys: keysLabel(pl.needs) })}</span>`;
    if (stats !== this.lastStats) {
      $('stats').innerHTML = stats;
      this.lastStats = stats;
    }
    $('nowTip').hidden = e.playing || e.mode === 'listen' || this.editing.on;
    this.renderPlay();
  }

  /** Tell the player once when the selected notes do not fit their controller. */
  private warnFit(): void {
    const pl = this.stage.placement;
    const size = this.app.keyboardSize();
    if (!pl || !size || pl.outside === 0) return;
    const fix = t(this.app.settings.anyOctave ? 'kb.fix.anyOctave' : 'kb.fix.octave');
    this.showHint(t('kb.noFit', { need: keysLabel(pl.needs), keys: keysLabel(+size), fix }), 8000);
  }

  private showHint(text: string, ms: number, ok = false): void {
    const h = $('hint');
    h.textContent = text;
    h.className = ok ? 'hint ok' : 'hint';
    h.hidden = false;
    this.hintUntil = performance.now() + ms;
  }

  private hideHint(): void {
    $('hint').hidden = true;
    this.hintUntil = 0;
  }

  private hintWrong(wanted: ScoreNote[]): void {
    const style = this.app.nameStyle();
    if (wanted.length === 1) {
      const n = wanted[0];
      this.showHint(t('hint.wrong', { note: noteName(n.pitch, style), f: n.finger ?? '?', fname: n.finger ? fingerName(n.finger) : '' }), 1800);
    } else this.showHint(t('hint.wrongChord', { notes: wanted.map((n) => noteName(n.pitch, style)).join(' + ') }), 1800);
  }

  private hintOctave(pressed: number, want: number): void {
    const k = Math.round(Math.abs(want - pressed) / 12);
    const n = k === 1 ? t('hint.octave.one') : t('hint.octave.many', { n: k });
    const dir = want > pressed ? t('hint.octave.lower') : t('hint.octave.higher');
    this.showHint(t('hint.octave', { n, dir, arrow: want > pressed ? '▶' : '◀' }), 4200);
  }

  private hintFinished(s: Summary): void {
    const e = this.engine!;
    const missed = s.mode === 'tempo' ? t('hint.doneMissed', { misses: s.misses }) : '';
    const [from, to] = e.rangeMeasures;
    const r = this.lastPass;
    if (r) {
      this.showResult(r, this.passWhat(from, to), t('result.counts', { hits: s.hits, wrong: s.wrong, missed }), 7000);
      return;
    }
    const whole = from === 1 && to === e.lastMeasure();
    const text = whole ? t('hint.done', { hits: s.hits, wrong: s.wrong, missed }) : t('hint.sectionDone', { from, to, hits: s.hits, wrong: s.wrong, missed });
    this.showHint(text, 7000, true);
  }

  /**
   * How a pass went: the share of right notes in large type and whether it
   * beat the best, and the rhythm next to it once enough notes were timed,
   * with what to mind (rushing, dragging) or, in learn mode, your own tempo.
   */
  private showResult(r: PassResult, what: string, counts: string, ms: number): void {
    const best = r.previousBest !== null && r.accuracy > r.previousBest + 1e-9;
    const vs = r.previousBest === null ? '' : best ? t('result.best') : t('result.bestWas', { best: percent(r.previousBest) });
    const h = $('hint');
    if (r.rhythm === null) {
      h.replaceChildren(
        el('b', { class: 'score', text: percent(r.accuracy) }),
        el('span', { class: 'res' }, [el('b', { text: what }), el('small', { text: [counts || t('result.correct'), vs].filter(Boolean).join(' · ') })]),
      );
    } else {
      const figure = (x: number, label: string, cls = '') => el('span', { class: `fig ${cls}` }, [el('b', { class: 'score', text: percent(x) }), el('small', { text: label })]);
      const tip = r.lean > 0 ? t('result.late') : r.lean < 0 ? t('result.early') : r.pace !== null ? t('result.pace', { speed: percent(r.pace) }) : '';
      h.replaceChildren(
        figure(r.accuracy, t('result.notes'), 'notes'),
        figure(r.rhythm, t('result.rhythm')),
        el('span', { class: 'res' }, [el('b', { text: what }), el('small', { text: [counts, tip, vs].filter(Boolean).join(' · ') })]),
      );
    }
    h.className = `hint ok result${best ? ' best' : ''}`;
    h.hidden = false;
    this.hintUntil = performance.now() + ms;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-25 14-05" for file names. */
function stamp(d: Date): string {
  return `${localDate(d)} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
