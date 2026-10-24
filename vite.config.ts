/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Emits sw.js from src/sw.js with the list of files to keep offline: the page,
 * every built asset except the .woff fallbacks of the fonts (browsers that run
 * service workers use .woff2), and the files in public/.
 */
function serviceWorker(): Plugin {
  return {
    name: 'koimidi-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.woff') && !f.endsWith('.map'));
      const pub = readdirSync(new URL('./public', import.meta.url));
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
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
