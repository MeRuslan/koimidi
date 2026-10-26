/**
 * Editing notes on the waterfall. With editing on, the stage is a piano roll
 * that stands still: a click in an empty lane puts a note there, a bar is
 * dragged to another key or time, its top edge drags its length, and the
 * wheel or a drag on the paper scrolls. Times snap to the grid the stage
 * draws, or to a note starting or ending nearby, so chords line up with what
 * is already there.
 */
import type { Engine } from '../practice/engine';
import type { Stage } from '../render/stage';
import { EPS, type Score, type ScoreNote } from '../score/model';
import { guessHand, roomUntil, snapBeat, type PieceEditor } from '../score/note-edits';

export interface EditHost {
  /** the open piece, or null */
  piece(): { score: Score; engine: Engine; editor: PieceEditor } | null;
  /** the notes changed: store them and redraw, keeping `sel` selected */
  edited(sel: ScoreNote | null): void;
  /** a click on a bar */
  pick(n: ScoreNote): void;
  /** is the note picker open? */
  picking(): boolean;
  unpick(): void;
  /** play a note briefly, to check it by ear */
  audition(pitch: number, beats: number): void;
  redraw(): void;
}

/** a press that moves less than this is a click */
const CLICK_PX = 4;
/** the top of a bar this deep drags its length */
const EDGE_PX = 7;
/** a note starting or ending this close catches the time */
const MAGNET_PX = 8;
/** beats of lead-in the paper scrolls back to before the first bar */
const BEFORE = 2;

interface NoteDrag {
  kind: 'move' | 'size';
  id: number;
  x0: number;
  y0: number;
  moved: boolean;
  note: ScoreNote;
  orig: { pitch: number; t: number; dur: number };
  /** where other notes start and end */
  marks: number[];
}

interface PaperDrag {
  kind: 'paper';
  id: number;
  x0: number;
  y0: number;
  moved: boolean;
  pos0: number;
}

export class NoteEditing {
  on = false;
  private drag: NoteDrag | PaperDrag | null = null;
  /** length of the next new note in beats: the last one set by hand */
  private newDur: number | null = null;

  constructor(
    private host: EditHost,
    private stage: Stage,
    private canvas: HTMLCanvasElement,
  ) {}

  setOn(on: boolean): void {
    this.on = on;
    this.drag = null;
    this.stage.editing = on;
    this.stage.ghost = null;
    this.canvas.style.cursor = '';
  }

  /** A press on the stage; true when editing took it. */
  down(e: PointerEvent, x: number, y: number): boolean {
    const p = this.host.piece();
    if (!this.on || !p || y >= this.stage.waterY) return false;
    this.canvas.setPointerCapture(e.pointerId);
    this.stage.ghost = null;
    const n = this.stage.noteAt(x, y);
    if (n) {
      const box = this.stage.box(n);
      const size = !!box && box.bot - box.top > 14 && y <= box.top + EDGE_PX;
      const marks = p.score.notes.filter((m) => m !== n).flatMap((m) => [m.t, m.t + m.dur]);
      this.drag = { kind: size ? 'size' : 'move', id: e.pointerId, x0: x, y0: y, moved: false, note: n, orig: { pitch: n.pitch, t: n.t, dur: n.dur }, marks };
    } else this.drag = { kind: 'paper', id: e.pointerId, x0: x, y0: y, moved: false, pos0: p.engine.pos };
    return true;
  }

  move(e: PointerEvent, x: number, y: number): void {
    const p = this.host.piece();
    const d = this.drag;
    if (!this.on || !p) return;
    if (!d || d.id !== e.pointerId) {
      this.hover(x, y);
      return;
    }
    if (!d.moved) {
      if (Math.hypot(x - d.x0, y - d.y0) < CLICK_PX) return;
      d.moved = true;
      this.host.unpick();
    }
    const ppb = this.stage.pxPerBeat;
    if (d.kind === 'paper') {
      // the paper follows the pointer: dragged down, the music comes down towards the keys
      this.scrollTo(p, d.pos0 + (y - d.y0) / ppb);
      return;
    }
    const { score } = p;
    const n = d.note;
    const grid = this.stage.editGrid();
    const magnet = MAGNET_PX / ppb;
    if (d.kind === 'move') {
      const t = snapBeat(d.orig.t + (d.y0 - y) / ppb, grid, d.marks, magnet);
      const pitch = this.stage.laneAt(x);
      if (pitch !== n.pitch) this.host.audition(pitch, 0.5);
      n.pitch = pitch;
      n.t = Math.max(0, Math.min(score.end - Math.min(grid, d.orig.dur), t));
      n.dur = Math.min(d.orig.dur, score.end - n.t);
    } else {
      const end = snapBeat(d.orig.t + d.orig.dur + (d.y0 - y) / ppb, grid, d.marks, magnet);
      n.dur = Math.max(Math.min(grid, d.orig.dur), Math.min(score.end, end) - n.t);
    }
    this.canvas.style.cursor = d.kind === 'size' ? 'ns-resize' : 'grabbing';
    this.stage.selected = n;
    this.host.redraw();
  }

  /** The press ended; true when editing took it. */
  up(e: PointerEvent, x: number, y: number): boolean {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return false;
    this.drag = null;
    const p = this.host.piece();
    if (!p) return true;
    if (d.kind === 'paper') {
      if (!d.moved) this.addAt(p, x, y);
      this.hover(x, y);
      return true;
    }
    const n = d.note;
    if (!d.moved) {
      this.host.pick(n);
      this.host.audition(n.pitch, n.dur);
      return true;
    }
    const to = { pitch: n.pitch, t: n.t, dur: n.dur };
    Object.assign(n, d.orig);
    // a note keeps clear of the next one on its key
    to.dur = Math.min(to.dur, roomUntil(p.score, to.pitch, to.t, n) - to.t);
    if (to.dur < EPS) {
      this.host.edited(n);
      return true;
    }
    if (d.kind === 'size') this.newDur = to.dur;
    this.host.edited(p.editor.change(n, to));
    this.hover(x, y);
    return true;
  }

  /** The press was taken away (a touch turned into a gesture, the window lost focus): put the note back. */
  cancel(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.kind !== 'paper') Object.assign(d.note, d.orig);
    this.host.redraw();
  }

  leave(): void {
    if (!this.stage.ghost) return;
    this.stage.ghost = null;
    this.host.redraw();
  }

  wheel(e: WheelEvent): void {
    const p = this.host.piece();
    if (!this.on || !p) return;
    e.preventDefault();
    // the picker stands by its bar: it goes when the bars move
    this.host.unpick();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * this.stage.h : e.deltaY;
    // like a page: scrolling down shows what is below, here the bars already played
    this.scrollTo(p, p.engine.pos - px / this.stage.pxPerBeat);
  }

  /** Arrow keys: the note a few keys or beats further, still on the stage. */
  nudge(n: ScoreNote, keys: number, beats: number): ScoreNote | null {
    const p = this.host.piece();
    if (!p) return null;
    const pitch = n.pitch + keys;
    const t = n.t + beats;
    if (pitch < this.stage.low || pitch > this.stage.high || t < -EPS || t > p.score.end - Math.min(n.dur, 0.25) + EPS) return null;
    const dur = Math.min(n.dur, roomUntil(p.score, pitch, t, n) - t, p.score.end - t);
    if (dur < EPS) return null;
    const m = p.editor.change(n, { pitch, t: Math.max(0, t), dur });
    if (keys) this.host.audition(m.pitch, Math.min(m.dur, 1));
    this.host.edited(m);
    return m;
  }

  private scrollTo(p: { score: Score; engine: Engine }, pos: number): void {
    p.engine.pos = Math.max(-BEFORE, Math.min(p.score.end, pos));
    this.host.redraw();
  }

  /** A click on empty paper: a new note there, chosen. The first click after the picker was open only closes it. */
  private addAt(p: { score: Score; engine: Engine; editor: PieceEditor }, x: number, y: number): void {
    if (this.host.picking()) {
      this.host.unpick();
      return;
    }
    const g = this.place(p.score, x, y);
    if (!g) return;
    // the hand being practised, or with both hands the one playing nearby
    const sel = p.engine.hand;
    const n = p.editor.add({ ...g, hand: sel === 'both' ? guessHand(p.score, g.pitch, g.t) : sel });
    this.host.audition(n.pitch, n.dur);
    this.host.edited(n);
  }

  /** The note a click at (x, y) would put in: in the cell under the pointer, or null where there is no room. */
  private place(score: Score, x: number, y: number): { pitch: number; t: number; dur: number } | null {
    const grid = this.stage.editGrid();
    const at = this.stage.beatAt(y);
    if (at < 0 || at >= score.end) return null;
    const marks = score.notes.flatMap((m) => [m.t, m.t + m.dur]);
    const t = Math.max(0, snapBeat(at - grid / 2, grid, marks, MAGNET_PX / this.stage.pxPerBeat));
    const pitch = this.stage.laneAt(x);
    // not on top of a note sounding on that key (one of the other hand's, when it is not shown)
    if (score.notes.some((m) => m.pitch === pitch && m.t <= t + EPS && m.t + m.dur > t + EPS)) return null;
    const want = this.newDur ?? 4 / score.timeSig[1];
    const dur = Math.min(want, roomUntil(score, pitch, t) - t);
    return dur >= Math.min(grid, want) / 2 ? { pitch, t, dur } : null;
  }

  /** Under a mouse: where a new note would go, and what a press would do. */
  private hover(x: number, y: number): void {
    const p = this.host.piece();
    if (!this.on || !p) return;
    let ghost: { pitch: number; t: number; dur: number } | null = null;
    let cursor = '';
    if (y < this.stage.waterY) {
      const n = this.stage.noteAt(x, y);
      if (n) {
        const box = this.stage.box(n);
        cursor = box && box.bot - box.top > 14 && y <= box.top + EDGE_PX ? 'ns-resize' : 'grab';
      } else if (!this.host.picking()) {
        ghost = this.place(p.score, x, y);
        cursor = ghost ? 'copy' : '';
      }
    }
    this.canvas.style.cursor = cursor;
    const old = this.stage.ghost;
    if (old?.pitch === ghost?.pitch && old?.t === ghost?.t && old?.dur === ghost?.dur) return;
    this.stage.ghost = ghost;
    this.host.redraw();
  }
}
