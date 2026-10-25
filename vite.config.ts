/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Basic Pitch's network, served at models/basic-pitch/ in dev and copied there by the build. */
const MODEL_DIR = new URL('./node_modules/@spotify/basic-pitch/model/', import.meta.url);
const MODEL_FILES = ['model.json', 'group1-shard1of1.bin'];

function basicPitchModel(): Plugin {
  return {
    name: 'koimidi-basic-pitch-model',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/models\/basic-pitch\/([\w.-]+)$/);
        if (!m || !MODEL_FILES.includes(m[1])) return next();
        res.setHeader('Content-Type', m[1].endsWith('.json') ? 'application/json' : 'application/octet-stream');
        createReadStream(new URL(m[1], MODEL_DIR)).pipe(res);
      });
    },
    generateBundle() {
      for (const f of MODEL_FILES) this.emitFile({ type: 'asset', fileName: `models/basic-pitch/${f}`, source: readFileSync(new URL(f, MODEL_DIR)) });
    },
  };
}

/**
 * Emits sw.js from src/sw.js with the list of files to keep offline: the page,
 * every built asset except the .woff fallbacks of the fonts (browsers that run
 * service workers use .woff2) and the listening fallback (TensorFlow.js and
 * Basic Pitch's network, a few MB, kept once used), and the files in public/
 * except the sounds.
 */
function serviceWorker(): Plugin {
  return {
    name: 'koimidi-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const listening = (f: string) => {
        const item = bundle[f];
        return f.startsWith('models/') || (item.type === 'chunk' && item.moduleIds.some((id) => id.includes('@tensorflow') || id.includes('basic-pitch')));
      };
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.woff') && !f.endsWith('.map') && !listening(f));
      // public/sounds holds the optional grand piano: downloaded on demand, not with the app
      const pub = readdirSync(new URL('./public', import.meta.url)).filter((f) => f !== 'sounds');
      const files = ['./', ...built.filter((f) => f !== 'index.html'), ...pub].sort();
      const template = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(pkg.version).update(template).update(files.join('\n')).digest('hex').slice(0, 12);
      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative base: the built site works at any path (user.github.io/koimidi/, a custom domain, or file://).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [basicPitchModel(), serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // TensorFlow.js with Basic Pitch (about 1 MB) is one chunk, loaded only to recognise a video by ear
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // the video tests track synthetic frames: a few seconds on a laptop, two to three times that on a CI runner
    testTimeout: 30000,
  },
});
