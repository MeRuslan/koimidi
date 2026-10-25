/**
 * Home screen: what koimidi does (with a little falling-notes picture), open a
 * file or a video, the keyboard's status, the piece to continue, your files,
 * and the library as the contents page of a songbook, grouped by difficulty.
 */
import type { App } from '../app';
import { barsLabel, getLang, keysLabel, t, type Key } from '../i18n';
import { fits, presetRange } from '../input/profile';
import { libraryItems, type LibraryItem } from '../library';
import { bestAccuracy, type PieceProgress } from '../practice/progress';
import { deleteFile, listFiles, type StoredFileMeta } from '../storage/files';
import { listProgress } from '../storage/progress';
import { $, el, formatDuration } from './dom';
import { heroArt } from './hero-art';
import { percent, practiceTime } from './progress-panel';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];

export class HomeView {
  private progress = new Map<string, PieceProgress>();
  private files: StoredFileMeta[] = [];
  private art: { stop(): void } | null = null;
  private artLang = '';

  constructor(private app: App) {
    $('langToggle').addEventListener('click', () => app.setLanguage(getLang() === 'ru' ? 'en' : 'ru'));
  }

  render(): void {
    $('langToggle').textContent = getLang() === 'ru' ? 'RU' : 'EN';
    this.renderLibrary();
    void this.renderRecent();
    this.app.renderMidiStatus();
    this.startArt();
    // practice time and best result arrive from storage a moment later
    void listProgress().then((m) => {
      this.progress = m;
      this.renderLibrary();
      void this.renderRecent();
    });
  }

  /** The screen is left: stop the picture's animation. */
  hide(): void {
    this.art?.stop();
    this.art = null;
  }

  /** Start the picture, or keep it running (home re-renders when a keyboard connects); its caption is in the language. */
  private startArt(): void {
    if (this.art && this.artLang === getLang()) return;
    this.art?.stop();
    this.art = heroArt($('heroArt'));
    this.artLang = getLang();
  }

  /** "12 min · best 94%" for pieces practised for at least half a minute. */
  private progressBadge(id: string): HTMLElement | null {
    const p = this.progress.get(id);
    if (!p || p.seconds < 30) return null;
    const best = bestAccuracy(p);
    const time = practiceTime(p.seconds);
    return el('span', { class: 'prog', text: best === null ? time : t('progress.card', { time, acc: percent(best) }) });
  }

  private handsLabel(h: { R: boolean; L: boolean }): string {
    return h.R && h.L ? t('piece.hands.both') : h.L ? t('piece.hands.L') : t('piece.hands.R');
  }

  /** "needs 37 keys" when the piece does not fit the player's controller at any octave. */
  private fitBadge(low?: number, high?: number): HTMLElement | null {
    const size = this.app.keyboardSize();
    if (!size || low === undefined || high === undefined || fits(presetRange(size), low, high)) return null;
    return el('span', { class: 'fit', text: `⚠ ${t('kb.needs', { keys: keysLabel(high - low + 1) })}`, title: t('kb.needsTitle', { keys: keysLabel(+size) }) });
  }

  private meta(hands: { R: boolean; L: boolean }, measures: number, seconds: number | undefined, isLast: boolean, ...extras: (HTMLElement | null)[]): HTMLElement {
    const m = el('span', { class: 'toc-meta' });
    if (isLast) m.append(el('span', { class: 'badge', text: t('continue') }));
    for (const x of extras) if (x) m.append(x);
    m.append(el('span', { text: `${this.handsLabel(hands)} · ${barsLabel(measures)}` }));
    m.append(el('span', { class: 'dur', text: seconds ? formatDuration(seconds) : '' }));
    return m;
  }

  private row(n: number, title: string, composer: string, meta: HTMLElement, open: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'toc-row' }, [
      el('span', { class: 'toc-n', text: String(n).padStart(2, '0') }),
      el('span', { class: 'toc-title' }, [el('b', { text: title }), el('small', { text: composer })]),
      el('span', { class: 'toc-dots', 'aria-hidden': 'true' }),
      meta,
    ]);
    b.addEventListener('click', open);
    return b;
  }

  private renderLibrary(): void {
    const box = $('libraryList');
    box.replaceChildren();
    const ru = getLang() === 'ru';
    const last = this.app.settings.lastPieceId;
    const items = libraryItems();
    const levels = [...new Set(items.map((i) => Math.max(1, Math.min(3, i.difficulty))))].sort();
    let n = 0;
    for (const level of levels) {
      const group = items.filter((i) => Math.max(1, Math.min(3, i.difficulty)) === level);
      box.append(
        el('div', { class: 'toc-group-head' }, [
          el('span', { class: 'roman', text: ROMAN[level] }),
          el('h3', { text: t(`library.level.${level}` as Key) }),
          el('span', { class: 'count fine', text: t(`difficulty.${level}` as Key) }),
        ]),
      );
      const list = el('ol', { class: 'toc' });
      for (const item of group) {
        n++;
        const row = this.row(n, ru ? item.titleRu : item.title, ru ? item.composerRu : item.composer,
          this.meta(item.hands, item.measures, item.seconds, item.id === last, this.fitBadge(item.low, item.high), this.progressBadge(item.id)),
          () => void this.app.openLibrary(item.id));
        list.append(el('li', {}, [row]));
      }
      box.append(list);
    }
    this.renderContinue(items);
  }

  private async renderRecent(): Promise<void> {
    const files = await listFiles();
    this.files = files;
    const block = $('recent');
    const list = $('recentList');
    block.hidden = files.length === 0;
    list.replaceChildren();
    const last = this.app.settings.lastPieceId;
    files.forEach((f, i) => list.append(this.recentRow(f, i + 1, f.id === last)));
    this.renderContinue(libraryItems());
  }

  private recentRow(f: StoredFileMeta, n: number, isLast: boolean): HTMLElement {
    const open = this.row(n, f.title || f.name, f.composer || f.name,
      this.meta(f.hands, f.measures, undefined, isLast, this.fitBadge(f.low, f.high), this.progressBadge(f.id)),
      () => void this.app.openStored(f.id));
    const remove = el('button', { type: 'button', class: 'btn icon ghost remove', title: t('recent.remove'), 'aria-label': t('recent.remove') });
    remove.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash"/></svg>';
    remove.addEventListener('click', async () => {
      if (!confirm(t('recent.removeConfirm', { title: f.title || f.name }))) return;
      await deleteFile(f.id);
      void this.renderRecent();
    });
    return el('li', {}, [open, remove]);
  }

  /** The piece opened last, as a large button above the shelves. */
  private renderContinue(items: LibraryItem[]): void {
    const box = $('continue');
    const id = this.app.settings.lastPieceId;
    const ru = getLang() === 'ru';
    const lib = items.find((i) => i.id === id);
    const file = lib ? null : this.files.find((f) => f.id === id);
    if (!lib && !file) {
      box.hidden = true;
      return;
    }
    const title = lib ? (ru ? lib.titleRu : lib.title) : file!.title || file!.name;
    const composer = lib ? (ru ? lib.composerRu : lib.composer) : file!.composer || '';
    const p = this.progress.get(id!);
    const bits = [composer, barsLabel(lib ? lib.measures : file!.measures)];
    if (p && p.seconds >= 30) {
      const best = bestAccuracy(p);
      bits.push(best === null ? practiceTime(p.seconds) : t('progress.card', { time: practiceTime(p.seconds), acc: percent(best) }));
    }
    const go = el('span', { class: 'ct-go' });
    go.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg>';
    const b = el('button', { type: 'button', class: 'continue' }, [
      el('span', { class: 'label', text: t('continue.label') }),
      el('span', { class: 'ct-title', text: title }),
      el('span', { class: 'ct-meta', text: bits.filter(Boolean).join(' · ') }),
      go,
    ]);
    b.addEventListener('click', () => void (lib ? this.app.openLibrary(lib.id) : this.app.openStored(file!.id)));
    box.replaceChildren(b);
    box.hidden = false;
  }
}
