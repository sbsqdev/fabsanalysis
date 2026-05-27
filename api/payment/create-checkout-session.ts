import type { IncomingMessage, ServerResponse } from 'http'

// Stripe checkout is not active — payments are handled via Kaspi receipt upload.
export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not implemented. Use Kaspi payment flow.' }))
}
