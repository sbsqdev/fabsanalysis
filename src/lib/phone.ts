/**
 * Normalize a KZ/RU phone number to 11-digit format starting with "7".
 * "+7 (701) 017-77-10"  → "77010177710"
 * "8 701 017 7710"      → "77010177710"
 * "701 017 7710"        → "77010177710"
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  // 8xxxxxxxxxx → 7xxxxxxxxxx
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.slice(1)
  }
  // 10-digit number (no country code) → add 7
  if (digits.length === 10) {
    digits = '7' + digits
  }
  return digits
}

/** Convert phone number to a synthetic email for Supabase email-auth. */
export function phoneToEmail(phone: string): string {
  const digits = normalizePhone(phone)
  return `u${digits}@proface.app`
}

/** Format phone for display: 77010177710 → +7 (701) 017-77-10 */
export function formatPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone)
  if (d.length !== 11) return phone
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
}
