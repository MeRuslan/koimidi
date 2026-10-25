/**
 * The sound part of Settings: which sound plays the notes (the simple synth,
 * the grand piano, or a SoundFont pack the player added), the instrument
 * inside a pack, adding and removing packs, download progress and credits.
 */
import type { App } from '../app';
import { addPack, BankError, bankBytes, downloadGrand, GRAND, hasGrand, listBanks, type Instrument } from '../audio/banks';
import { patchKey, type Patch } from '../audio/sampler';
import { getLang, t } from '../i18n';
import { deleteBank, type StoredBankMeta } from '../storage/soundbanks';
import { $, el, toast } from './dom';

/** "12.4 MB", "890 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return t('size.mb', { n: (bytes / 1024 / 1024).toLocaleString(getLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return t('size.kb', { n: Math.max(1, Math.round(bytes / 1024)) });
}

type Note = { text: string; error?: boolean } | 'credit' | null;

const BANK_ERRORS = { 'not-soundfont': 'sound.notSoundFont', 'no-room': 'sound.noRoom', unavailable: 'sound.unavailable' } as const;

export class SoundSettings {
  private patches: Patch[] = [];
  private packs: StoredBankMeta[] = [];
  private note: Note = null;
  private busy = false;

  constructor(private app: App) {
    const select = $<HTMLSelectElement>('instrument');
    select.addEventListener('change', () => {
      if (select.value === 'add') {
        select.value = this.app.settings.instrument;
        $('packFile').click();
        return;
      }
      void this.choose(select.value as Instrument);
    });
    const patch = $<HTMLSelectElement>('patch');
    patch.addEventListener('change', () => {
      const p = this.patches.find((x) => patchKey(x) === patch.value);
      if (!p) return;
      this.app.synth.selectPatch(p);
      this.app.settings.patches[this.app.settings.instrument] = patch.value;
      this.app.save();
    });
    const file = $<HTMLInputElement>('packFile');
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.add(f);
    });
    $('removePack').addEventListener('click', () => void this.remove());
  }

  /** At start: bring back the chosen sound when it is stored in this browser (no downloads). */
  async restore(): Promise<void> {
    const inst = this.app.settings.instrument;
    if (inst === 'simple') return;
    const bytes = await bankBytes(inst);
    if (!bytes) {
      this.app.settings.instrument = 'simple';
      this.app.save();
      return;
    }
    await this.apply(inst, bytes);
  }

  async render(): Promise<void> {
    const [packs, grandHere] = await Promise.all([listBanks(), hasGrand()]);
    this.packs = packs;
    const inst = this.app.settings.instrument;
    const select = $<HTMLSelectElement>('instrument');
    select.replaceChildren(
      el('option', { value: 'simple', text: t('sound.simple') }),
      el('option', { value: 'grand', text: grandHere || !GRAND.size ? t('sound.grandHere') : t('sound.grand', { size: formatSize(GRAND.size) }) }),
      ...packs.map((p) => el('option', { value: `pack:${p.id}`, text: t('sound.pack', { name: p.name, size: formatSize(p.size) }) })),
      el('option', { value: 'add', text: t('sound.add') }),
    );
    select.value = inst;
    select.disabled = this.busy;
    const patchRow = $('patchRow');
    patchRow.hidden = this.patches.length < 2 || inst === 'simple';
    if (!patchRow.hidden) {
      const ps = $<HTMLSelectElement>('patch');
      ps.replaceChildren(...this.patches.map((p) => el('option', { value: patchKey(p), text: p.name })));
      ps.value = this.app.settings.patches[inst] ?? patchKey(this.patches[0]);
    }
    $('packActions').hidden = !inst.startsWith('pack:') || this.busy;
    this.renderNote();
  }

  private renderNote(): void {
    const box = $('instrumentNote');
    const n = this.note;
    box.hidden = !n;
    box.classList.toggle('error', typeof n === 'object' && !!n?.error);
    if (!n) return;
    if (n === 'credit') {
      box.replaceChildren(
        `${GRAND.credit}, `,
        el('a', { href: GRAND.licenseUrl, target: '_blank', rel: 'noopener', text: GRAND.license }),
        `. ${t('sound.ready')}`,
      );
    } else box.textContent = n.text;
  }

  private setNote(n: Note): void {
    this.note = n;
    this.renderNote();
  }

  private async choose(inst: Instrument): Promise<void> {
    if (inst === 'simple') {
      await this.app.synth.useBank(null);
      this.patches = [];
      this.note = null;
      this.app.settings.instrument = 'simple';
      this.app.save();
      void this.render();
      return;
    }
    this.busy = true;
    void this.render();
    try {
      let bytes = await bankBytes(inst);
      if (!bytes && inst === 'grand') {
        this.setNote({ text: t('sound.downloading', { pct: '0%' }) });
        bytes = await downloadGrand((d) => this.setNote({ text: t('sound.downloading', { pct: `${Math.round(d * 100)}%` }) }));
      }
      if (!bytes) throw new Error('missing');
      await this.apply(inst, bytes);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
      void this.render();
    }
  }

  /** Load a sound bank into the synth and pick the preset chosen last time. */
  private async apply(inst: Instrument, bytes: ArrayBuffer): Promise<void> {
    this.setNote({ text: t('sound.loading') });
    try {
      this.patches = await this.app.synth.useBank(bytes);
      const saved = this.patches.find((p) => patchKey(p) === this.app.settings.patches[inst]);
      if (saved) this.app.synth.selectPatch(saved);
      this.app.settings.instrument = inst;
      this.app.save();
      this.note = inst === 'grand' ? 'credit' : null;
      this.renderNote();
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    void this.app.synth.useBank(null);
    this.patches = [];
    this.app.settings.instrument = 'simple';
    this.app.save();
    const reason = e instanceof BankError ? t(BANK_ERRORS[e.code]) : (e as Error)?.message || String(e);
    this.setNote({ text: t('sound.failed', { reason }), error: true });
  }

  private async add(file: File): Promise<void> {
    try {
      const meta = await addPack(file);
      toast(t('sound.added', { name: meta.name }));
      await this.choose(`pack:${meta.id}`);
    } catch (e) {
      this.fail(e);
      void this.render();
    }
  }

  private async remove(): Promise<void> {
    const inst = this.app.settings.instrument;
    const pack = this.packs.find((p) => `pack:${p.id}` === inst);
    if (!pack || !confirm(t('sound.removeConfirm', { name: pack.name }))) return;
    await deleteBank(pack.id);
    delete this.app.settings.patches[inst];
    await this.choose('simple');
  }
}
