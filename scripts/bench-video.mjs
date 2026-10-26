#!/usr/bin/env node
/**
 * Benchmark of the video recognition on real video files, run with Node:
 *
 *   node scripts/bench-video.mjs <video.mp4> --piece ode-to-joy [--out dir]
 *   node scripts/bench-video.mjs --manifest videos.json [--out dir] [--only id,id]
 *   node scripts/bench-video.mjs --compare before/summary.json after/summary.json [--labels video,ear]
 *   node scripts/bench-video.mjs --audio --manifest videos.json [--out dir] [--shard 0/4] [--vs-picture dir]
 *   node scripts/bench-video.mjs --piano --manifest videos.json [--out dir] [--shard 0/4] [--vs-picture dir]
 *   node scripts/bench-video.mjs --notes heard/ --manifest videos.json [--out dir] [--vs-picture dir]
 *
 * --audio measures recognition by ear with Basic Pitch on the video's sound
 * (about real time on the CPU) instead of the picture, --piano with the app's
 * Onsets and Frames (four times slower than real time on the CPU); --shard
 * k/n takes every n-th video from the k-th, to run several processes side by
 * side. --notes
 * scores what another transcription model heard (<id>.json: pitch, on, off in
 * seconds) the same way; --vs-picture also checks every heard note against the
 * picture's run (its summary.json and raw notes) where the picture is trusted.
 *
 * The recognition itself is TypeScript under src/, so it is loaded through
 * Vite's SSR loader; see scripts/bench/video-bench.ts for what is measured.
 * Needs ffmpeg and ffprobe on the PATH. Videos are never part of the repository.
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  // Node cannot see the named exports of this CommonJS package: a shim requires it instead
  resolve: {
    alias: {
      '@tonejs/midi': fileURLToPath(new URL('./bench/tonejs-midi-node.ts', import.meta.url)),
      '@spotify/basic-pitch': fileURLToPath(new URL('./bench/basic-pitch-cjs.ts', import.meta.url)),
    },
  },
});
try {
  const { main } = await server.ssrLoadModule('/scripts/bench/video-bench.ts');
  process.exitCode = await main(process.argv.slice(2));
} finally {
  await server.close();
}
