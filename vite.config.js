import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // relative base keeps the build working from a GitHub Pages project path
  base: './',
  plugins: [svelte()]
});
