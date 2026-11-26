import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { TOOLS_ORIGIN } from './sites'
import { SITE_META, metaKeyForPath } from './siteMeta'

function setAttr(selector, attr, value) {
  document.querySelector(selector)?.setAttribute(attr, value)
}

// The server sends the right tags for the page first opened (see
// siteMeta.js). Moving between Chord Moves and the rest of the suite in the
// app changes neither, so this keeps the title, Home Screen name, manifest
// and canonical/og:url in step with the current route: those are what
// Safari's share sheet, bookmarks and Add to Home Screen read.
export default function RouteMeta() {
  const { pathname } = useLocation()
  useEffect(() => {
    const m = SITE_META[metaKeyForPath(pathname)]
    const path = pathname.replace(/\/+$/, '') || '/'
    document.title = m.title
    setAttr('meta[name="description"]', 'content', m.description)
    setAttr('meta[name="apple-mobile-web-app-title"]', 'content', m.homeScreenName)
    setAttr('link[rel="manifest"]', 'href', m.manifest)
    setAttr('link[rel="canonical"]', 'href', TOOLS_ORIGIN + path)
    setAttr('meta[property="og:url"]', 'content', TOOLS_ORIGIN + path)
    setAttr('meta[property="og:title"]', 'content', m.ogTitle)
    setAttr('meta[property="og:description"]', 'content', m.ogDescription)
    setAttr('meta[property="og:image"]', 'content', TOOLS_ORIGIN + m.image)
  }, [pathname])
  return null
}
