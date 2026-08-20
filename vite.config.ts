import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative, so the build works from a subpath such as GitHub Pages without
  // rewriting asset URLs.
  base: './',
});
