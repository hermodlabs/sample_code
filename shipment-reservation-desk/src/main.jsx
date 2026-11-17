import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserExecutor } from '@decision-lab/sdk/browser';
import { createShipmentService } from './sdk.mjs';
import { createDeskController } from './controller.mjs';
import App from './App.jsx';
import './styles.css';

const configURL = new URL(`${import.meta.env.BASE_URL}data/config.json`, document.baseURI);
async function read(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}.`);
  return response.text();
}
let config;
const controller = createDeskController({
  service: createShipmentService({ executor: createBrowserExecutor() }),
  async loadDefinition() {
    config = JSON.parse(await read(configURL));
    return { config, appPackage: JSON.parse(await read(new URL(config.appUrl, configURL))) };
  },
  loadCase: async entry => JSON.parse(await read(new URL(entry.url, configURL))),
  saveFile(filename, source) {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
});
createRoot(document.getElementById('root')).render(<App controller={controller} />);
void controller.initialize();
window.addEventListener('pagehide', () => void controller.dispose(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => void controller.dispose());
