import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/700.css';
import './styles.css';
import { App } from './app';
import { setupPwa } from './pwa';

const app = new App();
setupPwa();
// handy for debugging and automated checks
(window as unknown as { koimidi: App }).koimidi = app;
