import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { userId, email } = req.body as { userId: string; email: string }
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' })

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'FABS Facial Analysis — Пожизненный доступ',
            description: 'Полный анализ лица · AI-рекомендации · Сохранение истории',
          },
          unit_amount: 15000, // $150.00
        },
        quantity: 1,
      },
    ],
    metadata: { userId },
    success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${req.headers.origin}/#pricing`,
  })

  res.json({ url: session.url })
}
