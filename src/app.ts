/** Application shell: settings, language, audio, MIDI, file import and navigation between screens. */
import { libraryScore } from './library';
import { importFile, scoreFromStored } from './importer';
import { applyI18n, detectLang, keysLabel, setLang, t, type NameStyle } from './i18n';
import { startMidi, type MidiStatus } from './input/midi';
import { guessSize, presetRange, type KeyboardSize, type KeyRange } from './input/profile';
import { Synth } from './audio/synth';
import { applyEdits } from './score/edits';
import type { Score } from './score/model';
import { getFile, getFingerings, requestPersistence, touchFile, type FileKind } from './storage/files';
import { loadPieceSettings, loadSettings, saveSettings, type Lang, type Settings } from './storage/settings';
import { $, toast } from './ui/dom';
import { HomeView } from './ui/home';
import { PracticeView } from './ui/practice';

export interface PieceInfo {
  id: string;
  source: 'library' | 'file';
  kind?: FileKind;
}

export class App {
  settings: Settings = loadSettings();
  synth = new Synth();
  midi: MidiStatus = { kind: 'requesting' };
  home: HomeView;
  practice: PracticeView;
  current: PieceInfo | null = null;
  private unlockToastShown = false;

  constructor() {
    setLang(this.settings.lang === 'auto' ? detectLang() : this.settings.lang);
    this.home = new HomeView(this);
    this.practice = new PracticeView(this);
    applyI18n();
    $('version').textContent = `v${__APP_VERSION__}`;
    this.home.render();
    requestPersistence();

    startMidi({
      noteOn: (p, v) => {
        if (!this.synth.ready && this.settings.sound && !this.unlockToastShown) {
          this.unlockToastShown = true;
          toast(t('audio.unlock'), { ms: 5000 });
        }
        this.practice.noteOn(p, v);
      },
      noteOff: (p) => this.practice.noteOff(p),
      sustain: (on) => {
        this.synth.setSustain(on);
        this.practice.sustain(on);
      },
      status: (s) => {
        this.midi = s;
        // the controller's name may give its size away: refresh the fit badges and the on-screen keyboard
        if (!$('home').hidden) this.home.render();
        else this.renderMidiStatus();
        if (this.settings.keyboard === 'auto') this.practice.applyProfile();
      },
    });
    addEventListener('beforeunload', (e) => {
      if (this.practice.hasUnsavedTake()) e.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.practice.flushProgress();
    });

    const unlock = () => this.synth.unlock();
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });

    const input = $<HTMLInputElement>('file');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void this.openFile(f);
    });
    $('openBtn').addEventListener('click', () => input.click());
    this.setupDrop();
  }

  /* ---------- settings & language ---------- */

  save(): void {
    saveSettings(this.settings);
  }

  get lang(): Lang {
    return this.settings.lang === 'auto' ? detectLang() : this.settings.lang;
  }

  setLanguage(l: Lang): void {
    this.settings.lang = l;
    this.save();
    setLang(l);
    applyI18n();
    this.home.render();
    this.practice.refreshTexts();
    this.renderMidiStatus();
  }

  nameStyle(): NameStyle {
    if (this.settings.noteNames !== 'auto') return this.settings.noteNames;
    return this.lang === 'ru' ? 'solfege' : 'letters';
  }

  /* ---------- keyboard profile ---------- */

  /** Size and name of the connected controller when its name gives the key count away. */
  detectedKeyboard(): { size: KeyboardSize; name: string } | null {
    if (this.midi.kind !== 'connected') return null;
    for (const name of this.midi.names) {
      const size = guessSize([name]);
      if (size) return { size, name };
    }
    return null;
  }

  /** The player's controller size: chosen in Settings, or detected; null means just fit the piece. */
  keyboardSize(): KeyboardSize | null {
    const k = this.settings.keyboard;
    return k === 'auto' ? (this.detectedKeyboard()?.size ?? null) : k;
  }

  keyboardRange(): KeyRange | null {
    const size = this.keyboardSize();
    return size ? presetRange(size) : null;
  }

  /* ---------- MIDI status ---------- */

  renderMidiStatus(): void {
    const s = this.midi;
    const pill = $('midi');
    const line = $('homeMidi');
    let cls = '';
    let full = '';
    let short = '';
    switch (s.kind) {
      case 'connected': {
        cls = 'ok';
        const size = this.keyboardSize();
        full = t('midi.connected', { names: s.names.join(', ') }) + (size ? ` · ${keysLabel(+size)}` : '');
        short = s.names.join(', ');
        break;
      }
      case 'none':
        cls = 'warn';
        full = t('midi.none');
        short = t('midi.short.none');
        break;
      case 'denied':
        cls = 'warn';
        full = t('midi.denied');
        short = t('midi.short.denied');
        break;
      case 'unsupported':
        cls = 'warn';
        full = t('midi.unsupported');
        short = t('midi.short.unsupported');
        break;
      default:
        full = t('midi.requesting');
        short = t('midi.short.requesting');
    }
    pill.className = `status ${cls}`;
    pill.textContent = short;
    pill.title = full;
    line.className = `status-line ${cls}`;
    line.textContent = full;
    $('browserHint').hidden = s.kind !== 'unsupported';
  }

  /* ---------- opening pieces ---------- */

  openLibrary(id: string): Promise<void> {
    const score = libraryScore(id);
    return this.show(score, { id, source: 'library' });
  }

  async openStored(id: string): Promise<void> {
    const f = await getFile(id);
    if (!f) {
      toast(t('open.failed', { name: id, reason: 'missing' }), { error: true });
      return;
    }
    try {
      const split = loadPieceSettings(id).split ?? this.settings.midiSplit;
      const score = scoreFromStored(f, split);
      void touchFile(id);
      await this.show(score, { id, source: 'file', kind: f.kind });
    } catch (e) {
      toast(t('open.failed', { name: f.name, reason: (e as Error).message }), { error: true });
    }
  }

  async openFile(file: File): Promise<void> {
    toast(t('open.reading', { name: file.name }), { ms: 1500 });
    try {
      const { score, stored } = await importFile(file, this.settings.midiSplit);
      await this.show(score, { id: stored.id, source: 'file', kind: stored.kind });
      const auto = score.notes.some((n) => n.fingerSource === 'auto');
      toast(`${t('storage.saved')}${auto ? ' · ' + t('hint.fingersAuto') : ''}`, { ms: 3500 });
    } catch (e) {
      const msg = (e as Error).message === 'unknown-type' ? t('open.unknownType') : (e as Error).message;
      toast(t('open.failed', { name: file.name, reason: msg }), { error: true, ms: 6000 });
    }
  }

  /** Open the practice screen with the player's finger edits for this piece applied. */
  private async show(score: Score, info: PieceInfo): Promise<void> {
    const edits = await getFingerings(info.id);
    applyEdits(score, edits);
    this.current = info;
    this.settings.lastPieceId = info.id;
    this.save();
    $('home').hidden = true;
    $('practice').hidden = false;
    this.practice.open(score, info, edits);
  }

  showHome(): void {
    this.practice.close();
    $('practice').hidden = true;
    $('home').hidden = false;
    this.current = null;
    this.home.render();
  }

  /* ---------- drag & drop ---------- */

  private setupDrop(): void {
    const overlay = $('dropOverlay');
    let depth = 0;
    addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      overlay.hidden = false;
    });
    addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.openFile(f);
    });
  }
}
