import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// The Python API the dev server proxies to; override with LML_DEV_API when it runs on another port.
const apiTarget = process.env.LML_DEV_API ?? 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': apiTarget,
      '/media': apiTarget,
    },
  },
});
