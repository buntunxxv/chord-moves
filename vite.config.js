import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { metaKeyForPath, withMeta } from './src/app/siteMeta.js'

// Renders each page's title, link previews, manifest and Home Screen name
// from src/app/siteMeta.js. The build ships two pages from the one
// index.html: index.html (Kynda Learning Tools) and chordmoves.html (Chord
// Moves), which vercel.json serves for /chordmoves/*. The dev server picks
// by the requested path, so both can be checked locally.
function siteMeta() {
  return {
    name: 'kynda-site-meta',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      const path = ctx.server ? new URL(ctx.originalUrl ?? ctx.path, 'http://x').pathname : '/'
      return withMeta(html, metaKeyForPath(path))
    },
    generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index) return
      this.emitFile({ type: 'asset', fileName: 'chordmoves.html', source: withMeta(String(index.source), 'chordmoves') })
    },
  }
}

export default defineConfig({
  plugins: [react(), siteMeta()],
})
