/**
 * @tonejs/midi for the benchmark under Node: the package is CommonJS and Node
 * cannot see its named exports, so the runner aliases it to this file.
 */
import { createRequire } from 'node:module';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');
export { Midi };
