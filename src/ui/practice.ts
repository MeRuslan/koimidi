/** Practice screen: transport, mode, tempo, hands, loop range, HUD, hints, settings popover. */
import type { App, PieceInfo } from '../app';
import { fingerName, noteName, t } from '../i18n';
import { ComputerKeyboard } from '../input/keyboard';
import { Engine, type HandSel, type Mode, type Summary } from '../practice/engine';
import { FINGER_COLORS, Stage } from '../render/stage';
import { bpmAt, measureAt, type Score, type ScoreNote } from '../score/model';
import type { MidiSplit } from '../score/midi';
import { scoreFromStored } from '../importer';
import { getFile } from '../storage/files';
import { clearPieceSettings, loadPieceSettings, savePieceSettings } from '../storage/settings';
import { $, el } from './dom';

const NO_FINGER = '#9fb4c4';

export class PracticeView {
  active = false;
  engine: Engine | null = null;
  score: Score | null = null;
  private info: PieceInfo | null = null;
  private stage: Stage;
  private kb: ComputerKeyboard;
  private dirty = true;
  private hintUntil = 0;
  private lastNext = '';
  private lastStats = '';
  private pointers = new Map<number, number>();
  private last = performance.now();

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

  open(score: Score, info: PieceInfo): void {
    this.score = score;
    this.info = info;
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
    });
    this.engine = e;
    const s = this.app.settings;
    const ps = loadPieceSettings(info.id);
    e.mode = s.mode;
    e.loop = s.loop;
    e.anyOctave = s.anyOctave;
    e.speed = ps.speed ?? s.speed;
    e.setHand(ps.hand && this.handAvailable(ps.hand) ? ps.hand : e.pickHand());
    e.setRangeMeasures(ps.from ?? 1, ps.to ?? e.lastMeasure());
    this.stage.nameStyle = this.app.nameStyle();
    this.stage.attach(score, e);
    this.kb.fitTo(e.activeNotes.map((n) => n.pitch));
    this.active = true;
    this.closeSettings();
    this.hideHint();
    this.lastNext = this.lastStats = '';
    this.syncControls();
    this.buildSections();
    $('pieceTitle').textContent = score.title;
    $('pieceComposer').textContent = score.composer ?? '';
    document.title = `${score.title} · koimidi`;
    this.dirty = true;
  }

  close(): void {
    this.active = false;
    this.engine?.setPlaying(false);
    this.engine?.dispose();
    this.app.synth.allOff();
    this.kb.releaseAll();
    this.closeSettings();
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
    this.syncControls();
    this.buildSections();
    this.dirty = true;
  }

  private handAvailable(h: HandSel): boolean {
    const s = this.score!;
    return h === 'both' ? s.hands.R && s.hands.L : s.hands[h];
  }

  /* ---------- input ---------- */

  noteOn(p: number, vel: number): void {
    if (!this.active || !this.engine) return;
    if (this.app.settings.sound && this.engine.mode !== 'listen') {
      this.app.synth.unlock();
      this.app.synth.noteOn(p, vel);
    }
    this.engine.press(p, vel);
  }

  noteOff(p: number): void {
    this.app.synth.noteOff(p);
    this.engine?.release(p);
  }

  private command(code: string): boolean {
    if (!this.active || !this.engine) return false;
    const e = this.engine;
    switch (code) {
      case 'Space':
        this.togglePlay();
        return true;
      case 'Enter':
        e.restart();
        return true;
      case 'Escape':
        if (!$('settings').hidden) this.closeSettings();
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
    document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked) return;
        s.mode = r.value as Mode;
        this.app.save();
        this.engine?.setMode(s.mode);
        this.hideHint();
      }),
    );
    document.querySelectorAll<HTMLInputElement>('input[name=hand]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked || !this.engine) return;
        this.engine.setHand(r.value as HandSel);
        this.stage.fitRange();
        this.kb.fitTo(this.engine.activeNotes.map((n) => n.pitch));
        this.savePiece();
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
      const p = this.stage.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (p === null) return;
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

    // settings popover
    const btn = $('settingsBtn');
    const pop = $('settings');
    btn.addEventListener('click', () => (pop.hidden ? this.openSettings() : this.closeSettings()));
    addEventListener('pointerdown', (e) => {
      if (pop.hidden) return;
      const target = e.target as Node;
      if (!pop.contains(target) && !btn.contains(target)) this.closeSettings();
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
    this.open(score, this.info);
  }

  private openSettings(): void {
    const s = this.app.settings;
    $<HTMLInputElement>('sound').checked = s.sound;
    $<HTMLInputElement>('volume').value = String(s.volume);
    $<HTMLInputElement>('anyOct').checked = s.anyOctave;
    $<HTMLSelectElement>('noteNames').value = s.noteNames;
    $<HTMLSelectElement>('lang').value = this.app.lang;
    const isMidi = this.info?.source === 'file' && this.info.kind === 'midi';
    $('midiSplitRow').hidden = !isMidi;
    if (isMidi) $<HTMLSelectElement>('midiSplit').value = loadPieceSettings(this.info!.id).split ?? s.midiSplit;
    $('settings').hidden = false;
    $('settingsBtn').setAttribute('aria-expanded', 'true');
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
    if (stats !== this.lastStats) {
      $('stats').innerHTML = stats;
      this.lastStats = stats;
    }
    this.renderPlay();
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
