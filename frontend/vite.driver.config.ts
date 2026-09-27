import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Builds the driver app on its own, for Capacitor to wrap.
 *
 * Deliberately separate from vite.config.ts rather than a second input on it:
 * that config carries the Figma preview tooling and the tunnel/proxy setup for
 * the staff app, none of which applies here — and a native build must not be
 * able to break the website's build by sharing its config.
 *
 * Output goes straight to driver-app/www, the folder Capacitor copies into the
 * Android and iOS projects.
 *
 *   npm run build:driver     from frontend/
 */

/**
 * The entry is driver.html so it can sit beside index.html in frontend/
 * without clashing, but Capacitor loads index.html and nothing else — so the
 * built file is renamed once it is on disk.
 *
 * Renaming in `closeBundle` rather than rewriting Rollup's `bundle` object:
 * Vite 8 runs on Rolldown, which ignores assignments to that object and warns
 * that it will.
 */
function emitEntryAsIndexHtml(outDir: string): Plugin {
  return {
    name: 'driver-entry-as-index-html',
    enforce: 'post',
    closeBundle() {
      const from = path.join(outDir, 'driver.html')
      const to = path.join(outDir, 'index.html')
      if (!fs.existsSync(from)) return
      fs.renameSync(from, to)
    },
  }
}

const OUT_DIR = path.resolve(import.meta.dirname, '../driver-app/www')

export default defineConfig({
  // Capacitor serves the bundle off the filesystem, so asset URLs must be
  // relative — an absolute /assets/… resolves outside the app container.
  base: './',
  // One root .env serves both apps.
  envDir: path.resolve(import.meta.dirname, '..'),
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'driver.html'),
    },
  },
  plugins: [react(), tailwindcss(), emitEntryAsIndexHtml(OUT_DIR)],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
