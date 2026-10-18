import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function verifyStripeWebhook(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(',')
  let timestamp = ''
  const v1Sigs = []
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    const key = part.slice(0, eqIdx)
    const val = part.slice(eqIdx + 1)
    if (key === 't') timestamp = val
    else if (key === 'v1') v1Sigs.push(val)
  }
  if (!timestamp || v1Sigs.length === 0) throw new Error('Invalid signature header')
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error('Timestamp too old')
  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  const valid = v1Sigs.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      return false
    }
  })
  if (!valid) throw new Error('Signature mismatch')
  return JSON.parse(rawBody.toString('utf8'))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const rawBody = await getRawBody(req)
  const sigHeader = req.headers['stripe-signature']
  if (!sigHeader) return res.status(400).json({ error: 'Missing Stripe-Signature header' })

  let event
  try {
    event = verifyStripeWebhook(rawBody, sigHeader, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    // Only Chord Moves' own payment link should grant a Chord Moves
    // entitlement -- other Kynda Stripe payments (e.g. 1:1 lesson bookings)
    // flow through this same account and would otherwise accidentally
    // unlock Pro for an unrelated purchase.
    if (session.payment_link !== 'plink_1TtvPlLfFLqligjkwk3HdZKE') {
      return res.status(200).json({ received: true })
    }

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim()
    if (!email) return res.status(200).json({ received: true })

    const supabase = createClient(
      'https://lkkcmiywhwnquqysyghb.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { error } = await supabase.from('chord_moves_entitlements').upsert(
      {
        email,
        stripe_customer_id: session.customer || null,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent || null,
        amount_paid: session.amount_total,
        currency: session.currency,
        // A purchase is permanent; it also upgrades an existing student or
        // comp row, so access survives the student's lessons ending.
        source: 'purchase',
      },
      { onConflict: 'email' }
    )

    if (error) {
      console.error('Supabase upsert error:', error)
      return res.status(500).json({ error: 'Database error' })
    }
  }

  return res.status(200).json({ received: true })
}
