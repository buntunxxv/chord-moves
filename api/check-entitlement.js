import { createClient } from '@supabase/supabase-js'
import { lookupIsPro } from './_entitlement.js'

// Re-check an already-unlocked device: App.jsx calls this on load with the
// email it unlocked with, and downgrades only on a definite isPro: false.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email required' })

  const supabase = createClient(
    'https://lkkcmiywhwnquqysyghb.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    const isPro = await lookupIsPro(supabase, email.trim().toLowerCase())
    return res.status(200).json({ isPro })
  } catch {
    return res.status(500).json({ error: 'Database error' })
  }
}
