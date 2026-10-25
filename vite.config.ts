import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this site from /cards/. CI sets VITE_BASE=/cards/;
// locally it stays '/'. No PWA and no router yet, so this is the only place
// the base path lives. Add both later and they must use the same value
// (see the firebase-github-pages-app skill).
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
})
