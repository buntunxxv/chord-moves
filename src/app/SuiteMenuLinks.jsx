import { Link, useLocation } from 'react-router-dom'
import { SUITE_MENU_ITEMS } from './suiteMenu'

// Renders the shared suite menu items (see suiteMenu.js) as a flat list of
// link elements, styled by the caller's own className so Chord Moves'
// header and ToolShell's mobile menu can keep their existing look while
// drawing from the one shared list. The item matching the current route
// renders as inert text instead of a link to itself -- a tap that would
// silently do nothing is worse than no link at all -- highlighted via
// currentClassName rather than a visible label; aria-current="page" still
// carries that to screen readers. Items flagged `child` (the 4 tools,
// nested under "All tools") get childClassName added on top, so the caller
// can indent/de-emphasize them without this component needing to know what
// that should look like.
export default function SuiteMenuLinks({ className, currentClassName, childClassName, onNavigate }) {
  const { pathname } = useLocation()

  return SUITE_MENU_ITEMS.map(item => {
    const itemClassName = item.child ? `${className} ${childClassName}` : className

    if (item.href) {
      return (
        <a key={item.key} href={item.href} className={itemClassName} onClick={onNavigate}>
          {item.label}
        </a>
      )
    }

    if (item.to === pathname) {
      return (
        <span key={item.key} className={`${itemClassName} ${currentClassName}`} aria-current="page">
          {item.label}
        </span>
      )
    }

    return (
      <Link key={item.key} to={item.to} className={itemClassName} onClick={onNavigate}>
        {item.label}
      </Link>
    )
  })
}
