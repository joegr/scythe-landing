// What the relay keeps for each signup. Every signup that reaches the relay came from the landing
// page's form, so each is attributed to it: source "landing". `campaign` keeps only the utm_* tags
// of the page's query string. Anything else riding on the link (click IDs, an email someone pasted
// into it) is dropped, so the email is the only personal data kept.
export const SOURCE = 'landing'

export function campaign(query) {
  const kept = new URLSearchParams()
  for (const [k, v] of new URLSearchParams(String(query || ''))) {
    if (/^utm_[a-z]{1,20}$/.test(k)) kept.append(k, v.slice(0, 60))
  }
  return kept.toString().slice(0, 200) || null
}

export function record(email, query, now = new Date()) {
  return { email, source: SOURCE, campaign: campaign(query), created_at: now.toISOString() }
}
