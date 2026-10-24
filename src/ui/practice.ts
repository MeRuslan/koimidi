/** Practice screen: transport, mode, tempo, hands, loop range, HUD, hints, finger editing, recording, settings popover. */
import type { App, PieceInfo } from '../app';
import { fingerName, keysLabel, noteName, t, type Key } from '../i18n';
import { ComputerKeyboard } from '../input/keyboard';
import { KEYBOARD_SIZES, type KeyboardChoice } from '../input/profile';
import { Engine, type HandSel, type Mode, type Summary } from '../practice/engine';
import { Recorder, takeToMidi, type Take } from '../practice/recorder';
import { FINGER_COLORS, Stage } from '../render/stage';
import { applyEdits, clearEdits, setFinger, suggestedSource, type FingerEdits } from '../score/edits';
import { bpmAt, measureAt, type Finger, type Score, type ScoreNote } from '../score/model';
import type { MidiSplit } from '../score/midi';
import { toMusicXML } from '../score/musicxml-export';
import { scoreFromStored } from '../importer';
import { getFile, putFingerings } from '../storage/files';
import { clearPieceSettings, loadPieceSettings, savePieceSettings } from '../storage/settings';
import { $, download, el, formatDuration, safeFileName, toast } from './dom';

const NO_FINGER = '#9fb4c4';
const DIGITS: Record<string, Finger> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5 };

export class PracticeView {
  active = false;
  engine: Engine | null = null;
  score: Score | null = null;
  private info: PieceInfo | null = null;
  private edits: FingerEdits = {};
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

  constructor(private app: App) {
    this.stage = new Stage($<HTMLCanvasElement>('stage'));
    this.kb = new ComputerKeyboard({
      noteOn: (p, v) => this.noteOn(p, v),
      noteOff: (p) => this.noteOff(p),
      command: (code) => this.command(code),
    });
    this.wire();
    new ResizeObserver(() => this.stage.resize()).observe($('stage').parentElement!);
    requestAnimationFrame(this.frame);
  }

  /* ---------- open / close ---------- */

  open(score: Score, info: PieceInfo, edits: FingerEdits): void {
    this.score = score;
    this.info = info;
    this.edits = edits;
    this.engine?.dispose();
    const e = new Engine(score, {
      flash: (p, kind) => this.stage.flash(p, kind),
      ripple: (p, n) => this.stage.ripple(p, n.finger ? FINGER_COLORS[n.finger] : NO_FINGER),
      sound: (p, v, secs) => {
        this.app.synth.unlock();
        this.app.synth.noteOn(p, v, secs);
      },
      wrongNote: (_p, wanted) => this.hintWrong(wanted),
      octaveHint: (p, want) => this.hintOctave(p, want),
      finished: (s) => this.hintFinished(s),
      change: () => (this.dirty = true),
      tick: (delay, accent) => this.app.synth.click(delay, accent),
    });
    this.engine = e;
    const s = this.app.settings;
    const ps = loadPieceSettings(info.id);
    e.mode = s.mode;
    e.loop = s.loop;
    e.anyOctave = s.anyOctave;
    e.countIn = s.countIn;
    e.metronome = s.metronome;
    e.speed = ps.speed ?? s.speed;
    e.setHand(ps.hand && this.handAvailable(ps.hand) ? ps.hand : e.pickHand());
    e.setRangeMeasures(ps.from ?? 1, ps.to ?? e.lastMeasure());
    this.stage.nameStyle = this.app.nameStyle();
    this.stage.profile = this.app.keyboardRange();
    this.stage.attach(score, e);
    this.kb.fitTo(e.activeNotes.map((n) => n.pitch));
    this.active = true;
    this.closeSettings();
    this.closePicker();
    this.hideHint();
    this.lastNext = this.lastStats = '';
    this.syncControls();
    this.buildSections();
    this.renderTake();
    $('pieceTitle').textContent = score.title;
    $('pieceComposer').textContent = score.composer ?? '';
    document.title = `${score.title} · koimidi`;
    this.warnFit();
    this.dirty = true;
  }

  close(): void {
    if (this.recorder.recording) this.stopRecording();
    this.stopTakePlayback();
    this.active = false;
    this.engine?.setPlaying(false);
    this.engine?.dispose();
    this.app.synth.allOff();
    this.kb.releaseAll();
    this.closeSettings();
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
    this.buildSections();
    this.renderTake();
    this.dirty = true;
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

  private command(code: string): boolean {
    if (!this.active || !this.engine) return false;
    const e = this.engine;
    if (this.picked) {
      // Enter / Space on a focused finger button press that button
      if ((code === 'Enter' || code === 'Space') && $('picker').contains(document.activeElement)) return false;
      if (code in DIGITS) {
        this.chooseFinger(DIGITS[code]);
        return true;
      }
      if ((code === 'Backspace' || code === 'Delete' || code === 'Digit0') && this.picked.fingerSource === 'user') {
        this.chooseFinger(undefined);
        return true;
      }
    }
    switch (code) {
      case 'Space':
        this.togglePlay();
        return true;
      case 'Enter':
        e.restart();
        return true;
      case 'Escape':
        if (this.picked) this.closePicker();
        else if (!$('settings').hidden) this.closeSettings();
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
    $('rec').addEventListener('click', () => this.toggleRecording());
    document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked) return;
        s.mode = r.value as Mode;
        this.app.save();
        this.engine?.setMode(s.mode);
        this.hideHint();
        this.syncControls();
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
        this.engine.setHand(r.value as HandSel);
        this.stage.fitRange();
        this.kb.fitTo(this.engine.activeNotes.map((n) => n.pitch));
        this.savePiece();
        this.closePicker();
        this.lastStats = '';
        this.warnFit();
        $('legendLeft').hidden = r.value !== 'both';
      }),
    );
    const tempo = $<HTMLInputElement>('tempo');
    tempo.addEventListener('input', () => {
      if (!this.engine) return;
      this.engine.speed = +tempo.value / 100;
      s.speed = this.engine.speed;
      this.app.save();
      this.savePiece();
      this.renderTempo();
    });
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
    });
    const canvas = $<HTMLCanvasElement>('stage');
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
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
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    // finger picker
    const picker = $('picker');
    picker.setAttribute('aria-label', t('picker.label'));
    const fingers = $('pickerFingers');
    for (let f = 1 as Finger; f <= 5; f = (f + 1) as Finger) {
      const b = el('button', { type: 'button', class: 'pf', 'data-f': String(f) }, [el('b', { text: String(f) })]);
      b.style.setProperty('--c', FINGER_COLORS[f]);
      b.addEventListener('click', () => this.chooseFinger(f));
      fingers.append(b);
    }
    $('pickerReset').addEventListener('click', () => this.chooseFinger(undefined));
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

    // settings popover
    const btn = $('settingsBtn');
    const pop = $('settings');
    btn.addEventListener('click', () => (pop.hidden ? this.openSettings() : this.closeSettings()));
    addEventListener('pointerdown', (e) => {
      if (pop.hidden) return;
      const target = e.target as Node;
      if (!pop.contains(target) && !btn.contains(target)) this.closeSettings();
    });
    $('exportXml').addEventListener('click', () => this.exportMusicXML());
    $('resetFingers').addEventListener('click', () => {
      const n = Object.keys(this.edits).length;
      if (!this.score || !this.info || !n || !confirm(t('settings.resetFingersConfirm', { n }))) return;
      clearEdits(this.score, this.edits);
      void putFingerings(this.info.id, this.edits);
      this.lastNext = '';
      this.dirty = true;
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
    this.app.synth.unlock();
    this.closePicker();
    this.engine.toggle();
    this.hideHint();
  }

  private setRange(from: number, to: number): void {
    if (!this.engine) return;
    this.engine.setRangeMeasures(from, to);
    this.savePiece();
    this.syncControls();
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
    applyEdits(score, this.edits);
    this.open(score, this.info, this.edits);
  }

  private openSettings(): void {
    const s = this.app.settings;
    this.closePicker();
    $<HTMLInputElement>('sound').checked = s.sound;
    $<HTMLInputElement>('volume').value = String(s.volume);
    $<HTMLInputElement>('countIn').checked = s.countIn;
    $<HTMLInputElement>('anyOct').checked = s.anyOctave;
    $<HTMLSelectElement>('noteNames').value = s.noteNames;
    $<HTMLSelectElement>('lang').value = this.app.lang;
    this.fillKeyboardSelect();
    const isMidi = this.info?.source === 'file' && this.info.kind === 'midi';
    $('midiSplitRow').hidden = !isMidi;
    if (isMidi) $<HTMLSelectElement>('midiSplit').value = loadPieceSettings(this.info!.id).split ?? s.midiSplit;
    const edited = Object.keys(this.edits).length;
    const reset = $('resetFingers');
    reset.hidden = edited === 0;
    reset.textContent = t('settings.resetFingers', { n: edited });
    $('settings').hidden = false;
    $('settingsBtn').setAttribute('aria-expanded', 'true');
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
    const metro = $('metro');
    metro.hidden = e.mode === 'learn';
    metro.setAttribute('aria-pressed', String(e.metronome));
    const hands = $('hands');
    hands.hidden = !(score.hands.R && score.hands.L);
    document.querySelectorAll<HTMLInputElement>('input[name=hand]').forEach((r) => (r.checked = r.value === e.hand));
    $('legendLeft').hidden = e.hand !== 'both' || hands.hidden;
    $<HTMLInputElement>('tempo').value = String(Math.round(e.speed * 100));
    this.renderTempo();
    const from = $<HTMLInputElement>('rangeFrom');
    const to = $<HTMLInputElement>('rangeTo');
    from.max = to.max = String(e.lastMeasure());
    from.value = String(e.rangeMeasures[0]);
    to.value = String(e.rangeMeasures[1]);
    $<HTMLInputElement>('loop').checked = e.loop;
    $('rangeAll').hidden = e.rangeMeasures[0] === 1 && e.rangeMeasures[1] === e.lastMeasure();
    this.markSection();
    this.renderPlay();
  }

  private renderTempo(): void {
    const e = this.engine;
    if (!e || !this.score) return;
    const bpm = Math.round(bpmAt(this.score, 0) * e.speed);
    $('tempoVal').textContent = `${Math.round(e.speed * 100)}% · ♩=${bpm}`;
  }

  private renderPlay(): void {
    const e = this.engine;
    $('play').textContent = e?.playing ? `❚❚ ${t('pause')}` : `▶ ${t('play')}`;
  }

  private buildSections(): void {
    const score = this.score;
    const row = $('sectionsRow');
    const box = $('sections');
    box.replaceChildren();
    const secs = score?.measures.filter((m) => m.section) ?? [];
    row.hidden = secs.length < 2;
    if (!score || secs.length < 2) return;
    secs.forEach((m, i) => {
      const next = secs[i + 1];
      const to = next ? next.number - 1 : score.measures[score.measures.length - 1].number;
      const chip = el('button', { type: 'button', class: 'chip', text: m.section!, title: `${m.section}: ${t('piece.barsRange', { from: m.number, to })}` });
      chip.dataset.from = String(m.number);
      chip.dataset.to = String(to);
      chip.addEventListener('click', () => this.setRange(m.number, to));
      box.append(chip);
    });
    this.markSection();
  }

  private markSection(): void {
    const e = this.engine;
    if (!e) return;
    $('sections')
      .querySelectorAll<HTMLButtonElement>('.chip')
      .forEach((c) => c.classList.toggle('on', +c.dataset.from! === e.rangeMeasures[0] && +c.dataset.to! === e.rangeMeasures[1]));
  }

  /* ---------- finger editing ---------- */

  private openPicker(n: ScoreNote): void {
    const e = this.engine;
    if (!e) return;
    if (e.playing) e.setPlaying(false);
    this.closeSettings();
    this.picked = n;
    this.stage.selected = n;
    const style = this.app.nameStyle();
    let head = t('picker.head', { note: noteName(n.pitch, style), m: n.measure });
    if (e.hand === 'both') head += ` · ${t(n.hand === 'L' ? 'hand.L' : 'hand.R').toLowerCase()}`;
    $('pickerNote').textContent = head;
    const src = n.fingerSource;
    $('pickerSrc').textContent = src ? t(`picker.src.${src}` as Key) : '';
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
    const y = Math.max(8, Math.min(a.y - ph / 2, this.stage.waterY - ph - 8));
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

  private chooseFinger(f: Finger | undefined): void {
    const n = this.picked;
    if (!n || !this.score || !this.info) return;
    setFinger(this.score, n, f, this.edits);
    void putFingerings(this.info.id, this.edits);
    this.closePicker();
    this.lastNext = '';
    if (f) this.showHint(t('hint.fingerSet', { f, fname: fingerName(f) }), 2200, true);
    else this.showHint(t('hint.fingerReset'), 1800, true);
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
    row.hidden = !live && !this.take;
    $('takeStop').hidden = !live;
    for (const id of ['takePlay', 'takeSave', 'takeDiscard']) $(id).hidden = live;
  }

  /* ---------- HUD & hints ---------- */

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.active && this.engine) {
      const wasPlaying = this.engine.playing;
      this.engine.step(dt);
      if (wasPlaying !== this.engine.playing) this.renderPlay();
      if (this.hintUntil && now > this.hintUntil) this.hideHint();
      if (this.dirty) {
        this.updateHud();
        this.dirty = false;
      }
      this.stage.draw(now);
    }
    requestAnimationFrame(this.frame);
  };

  private badge(n: ScoreNote): string {
    const col = n.finger ? FINGER_COLORS[n.finger] : NO_FINGER;
    return `<span class="finger" style="background:${col}">${n.finger ?? '?'}</span>`;
  }

  private updateHud(): void {
    const e = this.engine;
    const score = this.score;
    if (!e || !score) return;
    const style = this.app.nameStyle();
    const target = e.target;
    let next: string;
    if (e.mode === 'listen') next = t('hud.listen');
    else if (!target) next = t('hud.ended');
    else {
      const pending = target.notes.filter((n) => e.noteState(n) !== 1);
      const parts = pending.map((n) => `<b>${noteName(n.pitch, style)}</b>${this.badge(n)}`);
      if (pending.length === 1) {
        const n = pending[0];
        const hand = e.hand === 'both' ? ` <span class="hand">${t(n.hand === 'L' ? 'hand.L' : 'hand.R').toLowerCase()}</span>` : '';
        next = `${t('hud.next')}: ${parts[0]} ${n.finger ? fingerName(n.finger) : ''}${hand}`;
      } else next = `${t('hud.next')}: ${parts.join(' + ')}`;
      if (!e.playing && !e.finished && e.mode === 'learn') next += `<span class="tip">${t('hud.pressToStart')}</span>`;
    }
    if (next !== this.lastNext) {
      $('next').innerHTML = next;
      this.lastNext = next;
    }
    const m = Math.max(1, measureAt(score, e.pos));
    const n = e.lastMeasure();
    let stats = `${t('hud.measure', { m: `<b>${m}</b>`, n })}<br>${t('hud.stats', { hits: `<b>${e.hits}</b>`, wrong: `<b>${e.wrong}</b>` })}`;
    if (e.mode === 'tempo') stats += t('hud.statsMissed', { misses: `<b>${e.misses}</b>` });
    const pl = this.stage.placement;
    if (pl && pl.outside > 0) stats += `<br><span class="warn">⚠ ${t('kb.needs', { keys: keysLabel(pl.needs) })}</span>`;
    if (stats !== this.lastStats) {
      $('stats').innerHTML = stats;
      this.lastStats = stats;
    }
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
    h.classList.toggle('ok', ok);
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
    const whole = e.rangeMeasures[0] === 1 && e.rangeMeasures[1] === e.lastMeasure();
    const text = whole
      ? t('hint.done', { hits: s.hits, wrong: s.wrong, missed })
      : t('hint.sectionDone', { from: e.rangeMeasures[0], to: e.rangeMeasures[1], hits: s.hits, wrong: s.wrong, missed });
    this.showHint(text, 7000, true);
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
