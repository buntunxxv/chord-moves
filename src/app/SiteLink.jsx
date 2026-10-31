import { Link } from 'react-router-dom'
import { CURRENT_SITE, resolveLink } from './sites'
import { buildHandoverUrl, collectAppState } from '../utils/domainHandover'

// A link to a logical app path ("/", "/tools", "/metronome"...) that works on
// either public site: a router <Link> when the target lives here, a plain
// <a> to the other domain when it doesn't (see sites.js).
//
// Going from the library to Chord Moves carries this browser's saved Chord
// Moves state across at click time (old tools.kyndalearning.co.uk visitors
// have it stored here). The href itself stays a clean URL, so "copy link"
// never copies someone's saved data or Pro email.
export default function SiteLink({ to, onClick, children, ...rest }) {
  const target = resolveLink(to, CURRENT_SITE)
  if (target.internal) {
    return <Link to={target.internal} onClick={onClick} {...rest}>{children}</Link>
  }

  function handleClick(e) {
    onClick?.(e)
    if (target.site !== 'chordmoves' || CURRENT_SITE !== 'tools') return
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    let state = {}
    try { state = collectAppState(window.localStorage) } catch { return /* plain link still works */ }
    e.preventDefault()
    window.location.assign(buildHandoverUrl({ pathname: to, search: '' }, state))
  }

  return <a href={target.external} onClick={handleClick} {...rest}>{children}</a>
}
