/**
 * Offline support: registers the service worker (production builds only),
 * says once when the app has been saved for offline use, offers a reload when
 * a new version has been downloaded, and shows an Install button where the
 * browser allows installing the site as an app.
 */
import { t } from './i18n';
import { $, toast } from './ui/dom';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

export function setupPwa(): void {
  setupInstall();
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) return;
    reloading = false;
    location.reload();
  });
  const offerUpdate = (reg: ServiceWorkerRegistration) =>
    toast(t('update.ready'), {
      ms: Infinity,
      action: {
        label: t('update.reload'),
        run: () => {
          reloading = true;
          reg.waiting?.postMessage('skip-waiting');
        },
      },
    });
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state !== 'installed') return;
            if (navigator.serviceWorker.controller) offerUpdate(reg);
            else toast(t('offline.ready'), { ms: 4000 });
          });
        });
        // a practice session can last for hours: look for a new version now and then
        setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
      },
      () => undefined,
    );
  });
}

function setupInstall(): void {
  const btn = $('installBtn');
  let deferred: InstallPrompt | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    btn.hidden = false;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
  });
  btn.addEventListener('click', () => {
    btn.hidden = true;
    void deferred?.prompt();
    deferred = null;
  });
}
