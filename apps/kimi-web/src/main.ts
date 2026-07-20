import { createApp } from 'vue';
import App from './App.vue';
import i18n from './i18n';
import { initBrand, applyBrandAccent } from './brand';
import { installClientErrorCapture } from './debug/trace';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/inter/opsz-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './style.css';

// Always retain bounded metadata for uncaught failures. With ?debug=1 / the
// debug flag, console output is included too; HMR restores listeners/wrappers.
installClientErrorCapture();

// Load white-label brand config before mounting the app.
initBrand().then((cfg) => {
  // Apply brand accent colors to CSS custom properties (both light + dark).
  applyBrandAccent();

  // Set the HTML <title> from the brand config
  document.title = cfg.htmlTitle;

  // Update favicon link if overridden
  if (cfg.favicon !== '/favicon.ico') {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = cfg.favicon;
  }

  createApp(App).use(i18n).mount('#app');
});
