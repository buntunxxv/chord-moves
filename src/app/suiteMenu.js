import { TOOLS } from './tools'

// The single list behind every "hamburger" menu across the suite (Chord
// Compass's own header and ToolShell, which the 3 companion tools share) --
// one source means the menus can no longer drift apart the way Chord
// Compass's hand-rolled copy once did.
//
// "All tools" stays a real link to the directory page (it's still one tap
// to /tools), but each individual tool is flagged `child: true` so it
// renders indented beneath it -- a parent/child grouping rather than 6 flat
// peers. Portal sits outside that group, same as before.
export const SUITE_MENU_ITEMS = [
  { key: 'all-tools', label: 'All tools', to: '/' },
  ...TOOLS.map(tool => ({ key: tool.path, label: tool.name, to: tool.path, child: true })),
  { key: 'portal', label: 'Portal', href: 'https://www.kyndalearning.co.uk/portal' },
]
