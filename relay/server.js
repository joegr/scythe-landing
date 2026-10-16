// Signup relay for the landing page. GitHub Pages can't keep a secret, so this holds the GitHub
// token and writes each email as signups/<sha256(email)>.json in a private repo. The file name
// makes writes idempotent: a repeat signup hits "already exists" and is treated as success.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const { GITHUB_TOKEN, SIGNUPS_REPO, ALLOWED_ORIGINS = '', PORT = 8080 } = process.env
if (!GITHUB_TOKEN || !SIGNUPS_REPO) throw new Error('GITHUB_TOKEN and SIGNUPS_REPO must be set')

const allowed = ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 5 requests per IP per minute, kept in memory. Fine for one small machine.
const hits = new Map()
const limited = (ip) => {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 5
}
setInterval(() => hits.clear(), 10 * 60_000).unref()

// Where a signup came from: only the utm_* tags of the page's query string. Anything else riding
// on the link (click IDs, an email someone pasted into it) is dropped, so the email is all we keep.
export function campaign(query) {
  const kept = new URLSearchParams()
  for (const [k, v] of new URLSearchParams(String(query || ''))) {
    if (/^utm_[a-z]{1,20}$/.test(k)) kept.append(k, v.slice(0, 60))
  }
  return kept.toString().slice(0, 200) || null
}

async function store(email, source) {
  const id = createHash('sha256').update(email).digest('hex').slice(0, 32)
  const record = { email, source, created_at: new Date().toISOString() }
  const res = await fetch(`https://api.github.com/repos/${SIGNUPS_REPO}/contents/signups/${id}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'scythe-signup' },
    body: JSON.stringify({ message: 'signup', content: Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64') }),
  })
  // 422 without a sha means the file exists: a repeat signup.
  if (!res.ok && res.status !== 422) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
}

createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  const cors = allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {}
  const reply = (status, body) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

  if (req.url === '/health') return reply(200, { ok: true })
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })
  if (!cors['Access-Control-Allow-Origin']) return reply(403, { error: 'origin not allowed' })
  if (limited(req.headers['fly-client-ip'] || req.socket.remoteAddress)) return reply(429, { error: 'too many requests, try again in a minute' })

  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return reply(413, { error: 'too large' }) }
  let body
  try { body = JSON.parse(raw) } catch { return reply(400, { error: 'invalid JSON' }) }

  // Honeypot filled in: pretend it worked so bots don't retry.
  if (body.website) return reply(200, { ok: true })

  const email = String(body.email || '').trim().toLowerCase()
  if (email.length > 254 || !EMAIL.test(email)) return reply(400, { error: 'invalid email' })
  const source = campaign(body.source)

  try {
    await store(email, source)
  } catch (e) {
    console.error(e.message)
    return reply(502, { error: 'could not save, please try again' })
  }
  // Same answer for new and repeat emails, so the endpoint doesn't reveal who signed up.
  reply(200, { ok: true })
}).listen(PORT, () => console.log(`listening on ${PORT}`))
