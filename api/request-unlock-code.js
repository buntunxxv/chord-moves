import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CODE_TTL_MINUTES = 10
// A handful per email per hour -- enough for a genuine buyer who mistypes
// or waits for stripe-webhook.js to have already written the entitlement,
// not enough to use this endpoint to spam someone else's inbox.
const RATE_LIMIT_MAX_REQUESTS = 5
const RATE_LIMIT_WINDOW_MINUTES = 60

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured')
    return res.status(500).json({ error: 'Email sending is not configured' })
  }

  const { email } = req.body
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email required' })

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail.includes('@')) return res.status(400).json({ error: 'Enter a valid email address' })

  const supabase = createClient(
    'https://lkkcmiywhwnquqysyghb.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('chord_moves_unlock_codes')
    .select('id', { count: 'exact', head: true })
    .eq('email', normalizedEmail)
    .gte('created_at', windowStart)

  if (countError) {
    console.error('Supabase count error:', countError)
    return res.status(500).json({ error: 'Database error' })
  }

  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests for this email — try again later.' })
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

  const { error: insertError } = await supabase
    .from('chord_moves_unlock_codes')
    .insert({ email: normalizedEmail, code, expires_at: expiresAt, used: false })

  if (insertError) {
    console.error('Supabase insert error:', insertError)
    return res.status(500).json({ error: 'Database error' })
  }

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Kynda Learning <hello@kyndalearning.co.uk>',
      to: normalizedEmail,
      subject: `Your Kynda Learning Tools Pro unlock code: ${code}`,
      text: `Your Kynda Learning Tools Pro unlock code is ${code}. It unlocks Pro in every Kynda Learning tool.\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
    }),
  })

  if (!emailResponse.ok) {
    const body = await emailResponse.text()
    console.error('Resend send error:', emailResponse.status, body)
    return res.status(502).json({ error: 'Could not send the code email — try again shortly.' })
  }

  return res.status(200).json({ sent: true })
}
