// What each part of the site calls itself: <title>, description, link
// previews, Home Screen name and web app manifest (26 Nov 2026).
//
// One origin serves the whole Kynda Learning tools suite, so the suite has
// its own identity ("Kynda Learning Tools") and Chord Moves keeps its own
// on /chordmoves only.
//
// Link previews (iMessage, WhatsApp, Threads...) never run JavaScript, so
// the tags must already be in the HTML the server sends. vite.config.js
// renders them from this file into two pages: index.html (the suite) and
// chordmoves.html, which vercel.json serves for /chordmoves/*. RouteMeta
// (src/app/RouteMeta.jsx) keeps them right after in-app navigation, which
// is what Safari's share sheet, bookmarks and Add to Home Screen read.
//
// Plain data and string helpers only: vite.config.js imports this in Node.

import { CHORD_MOVES_PATH, TOOLS_ORIGIN } from './sites.js'

export const SITE_META = {
  tools: {
    title: 'Kynda Learning Tools',
    description: 'Small, browser-based tools for making more sense of music: Chord Moves, Rhythm Dice, Chord Dice, a metronome, an interval ear trainer and more. From Kynda Learning.',
    ogTitle: 'Kynda Learning Tools',
    ogDescription: 'Small tools for making more sense of music. Free to try in your browser.',
    path: '/',
    image: '/og-tools.png',
    imageAlt: 'Kynda Learning Tools on a phone: the tools directory, and Chord Dice and Rhythm Dice.',
    // iOS labels Home Screen icons with this, and truncates past ~12
    // characters, so the full name would read "Kynda Learni…".
    homeScreenName: 'Kynda Tools',
    manifest: '/manifest.webmanifest',
  },
  chordmoves: {
    title: 'Chord Moves — Kynda Learning',
    description: 'Build a chord, hear where it can go next, and name the shapes under your fingers. A free chord tool from Kynda Learning.',
    ogTitle: 'Chord Moves — find the next chord',
    ogDescription: 'Build a chord, hear where it can go next, and name the shapes under your fingers.',
    path: CHORD_MOVES_PATH,
    image: '/og-image.png',
    imageAlt: 'Chord Moves on a phone: next-chord suggestions from E flat, and a Badd sharp 11 guitar shape.',
    homeScreenName: 'Chord Moves',
    manifest: '/chordmoves.webmanifest',
  },
}

// Which identity a path belongs to. Only Chord Moves' own pages
// (/chordmoves and below) are Chord Moves; /upgrade is the suite's.
export function metaKeyForPath(pathname) {
  return pathname === CHORD_MOVES_PATH || pathname.startsWith(CHORD_MOVES_PATH + '/') ? 'chordmoves' : 'tools'
}

const escape = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The <head> tags for one identity, as HTML.
export function renderMetaTags(key) {
  const m = SITE_META[key]
  const url = TOOLS_ORIGIN + m.path
  const image = TOOLS_ORIGIN + m.image
  return [
    `<title>${escape(m.title)}</title>`,
    `<meta name="description" content="${escape(m.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Kynda Learning" />`,
    `<meta property="og:title" content="${escape(m.ogTitle)}" />`,
    `<meta property="og:description" content="${escape(m.ogDescription)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escape(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(m.ogTitle)}" />`,
    `<meta name="twitter:description" content="${escape(m.ogDescription)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<link rel="manifest" href="${m.manifest}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escape(m.homeScreenName)}" />`,
  ].join('\n    ')
}

export const META_START = '<!-- site-meta:start -->'
export const META_END = '<!-- site-meta:end -->'

// Replaces the marked block in an HTML page with `key`'s tags.
export function withMeta(html, key) {
  const start = html.indexOf(META_START)
  const end = html.indexOf(META_END)
  if (start === -1 || end === -1) throw new Error('index.html is missing the site-meta markers')
  return html.slice(0, start) + META_START + '\n    ' + renderMetaTags(key) + '\n    ' + html.slice(end)
}
