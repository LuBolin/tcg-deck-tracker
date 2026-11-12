import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Builds are served from GitHub Pages at /tcg-deck-tracker/; the dev server stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tcg-deck-tracker/' : '/',
  plugins: [react()],
}))
