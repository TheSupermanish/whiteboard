import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo>/, so assets need that prefix. Any
// other host serves from the root, hence the environment switch rather than a
// hard-coded base.
const base = process.env.PUBLIC_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 1447, strictPort: true },
  preview: { port: 1447, strictPort: true },
  build: { outDir: 'dist' },
});
