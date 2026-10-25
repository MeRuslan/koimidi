/**
 * @spotify/basic-pitch for the benchmark under Node: the package is CommonJS
 * and Node cannot see its named exports, so the runner aliases it to this file.
 */
import { createRequire } from 'node:module';

const m = createRequire(import.meta.url)('@spotify/basic-pitch') as typeof import('@spotify/basic-pitch');
export const { BasicPitch, outputToNotesPoly, noteFramesToTime, addPitchBendsToNoteEvents } = m;
