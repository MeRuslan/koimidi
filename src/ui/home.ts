/** Home screen: open a file, your files, built-in library. */
import type { App } from '../app';
import { barsLabel, getLang, keysLabel, t } from '../i18n';
import { fits, presetRange } from '../input/profile';
import { libraryItems } from '../library';
import { deleteFile, listFiles, type StoredFileMeta } from '../storage/files';
import { $, el, formatDuration } from './dom';

export class HomeView {
  constructor(private app: App) {
    $('langToggle').addEventListener('click', () => app.setLanguage(getLang() === 'ru' ? 'en' : 'ru'));
  }

  render(): void {
    $('langToggle').textContent = getLang() === 'ru' ? 'RU' : 'EN';
    this.renderLibrary();
    void this.renderRecent();
    this.app.renderMidiStatus();
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

  private meta(difficulty: number | null, hands: { R: boolean; L: boolean }, measures: number, seconds?: number, fit?: HTMLElement | null): HTMLElement {
    const m = el('span', { class: 'm' });
    if (difficulty) {
      const dots = el('span', { class: 'dots', title: t(`difficulty.${Math.min(3, difficulty)}` as 'difficulty.1') });
      for (let i = 1; i <= 3; i++) dots.append(el('i', { class: i <= difficulty ? 'on' : '' }));
      m.append(dots);
    }
    m.append(el('span', { text: this.handsLabel(hands) }));
    m.append(el('span', { text: barsLabel(measures) }));
    if (seconds) m.append(el('span', { text: formatDuration(seconds) }));
    if (fit) m.append(fit);
    return m;
  }

  private renderLibrary(): void {
    const list = $('libraryList');
    list.replaceChildren();
    const ru = getLang() === 'ru';
    const last = this.app.settings.lastPieceId;
    for (const item of libraryItems()) {
      const card = el('button', { type: 'button', class: 'card' }, [
        el('span', { class: 't', text: ru ? item.titleRu : item.title }),
        el('span', { class: 'c', text: ru ? item.composerRu : item.composer }),
        this.meta(item.difficulty, item.hands, item.measures, item.seconds, this.fitBadge(item.low, item.high)),
      ]);
      if (item.id === last) card.append(el('span', { class: 'badge', text: t('continue') }));
      card.addEventListener('click', () => void this.app.openLibrary(item.id));
      list.append(el('li', {}, [card]));
    }
  }

  private async renderRecent(): Promise<void> {
    const files = await listFiles();
    const block = $('recent');
    const list = $('recentList');
    block.hidden = files.length === 0;
    list.replaceChildren();
    const last = this.app.settings.lastPieceId;
    for (const f of files) list.append(this.recentRow(f, f.id === last));
  }

  private recentRow(f: StoredFileMeta, isLast: boolean): HTMLElement {
    const open = el('button', { type: 'button', class: 'card' }, [
      el('span', { class: 'tc' }, [el('span', { class: 't', text: f.title || f.name }), el('span', { class: 'c', text: f.composer || f.name })]),
      el('span', { class: 'right' }, [
        ...(isLast ? [el('span', { class: 'badge', text: t('continue') })] : []),
        this.meta(null, f.hands, f.measures, undefined, this.fitBadge(f.low, f.high)),
      ]),
    ]);
    open.addEventListener('click', () => void this.app.openStored(f.id));
    const remove = el('button', { type: 'button', class: 'ghost remove', title: t('recent.remove'), 'aria-label': t('recent.remove'), text: '×' });
    remove.addEventListener('click', async () => {
      if (!confirm(t('recent.removeConfirm', { title: f.title || f.name }))) return;
      await deleteFile(f.id);
      void this.renderRecent();
    });
    return el('li', {}, [open, remove]);
  }
}
