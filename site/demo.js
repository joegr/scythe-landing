// The demo: fetch a source, cut a card from it and mark it, the way the app does, entirely in the
// browser. Nothing is sent anywhere but the site being read. A browser may read another site only
// when that site allows it, so the demo reads Wikipedia (which does) and any page that sends CORS
// headers; for anything else it asks for the text, as the app does for a paywalled article.
// The rules are the app's (scythe-web/frontend/src/lib): marks snap to whole words, a card is the
// source's exact words and at most 400 of them, and the read-aloud version is the marked words alone.

const CARD_WORDS = 400
const SOURCE_WORDS = 20_000
const STYLES = ['underline', 'highlight', 'emphasis'] // keys 1, 2 and 3
const CLASS = { underline: 't-u', highlight: 't-hl', emphasis: 't-em' }
const STOP = /^(see also|references|notes|external links|further reading|bibliography|sources|citations|footnotes)$/i

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const countWords = (text) => (text.match(/\S+/g) ?? []).length

// Word and punctuation tokens, as the app snaps them (lib/doc.ts roughTokens).
const tokens = (text) => [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu)].map((m) => [m.index, m.index + m[0].length])
function snap(text, start, end) {
  const toks = tokens(text).filter(([a, b]) => b > start && a < end)
  return toks.length ? [toks[0][0], toks[toks.length - 1][1]] : null
}

// ---------------------------------------------------------------- reading a source

const citeDate = (d) => (d ? `${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()}` : '')
const yy = (d) => (d ? String(d.getUTCFullYear()).slice(2) : 'nd')
const lastName = (name) => {
  const n = (name || '').trim()
  if (!n) return ''
  if (n.includes(',')) return n.split(',')[0].trim()
  return n.split(/\s+/).pop()
}
// "Lastname 24, Author Name, “Title”, Publication, 3-14-2024, link": the sample card's cite.
function draftCite({ author, title, publisher, date, url, by }) {
  const short = `${by || lastName(author) || publisher || 'Anonymous'} ${yy(date)}`
  return [short, author, title && `“${title}”`, publisher, citeDate(date), url].filter(Boolean).join(', ')
}

function clean(lines) {
  const out = []
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const heading = line.match(/^=+\s*(.*?)\s*=+$/)
    if (heading) { if (STOP.test(heading[1])) break; continue }
    out.push(line)
  }
  return out.join('\n')
}

async function fromWikipedia(url) {
  const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' ')
  const api = new URL('/w/api.php', url.origin)
  api.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1', titles: title,
    prop: 'extracts|revisions|info', explaintext: '1', exsectionformat: 'wiki', rvprop: 'timestamp', inprop: 'url',
  })
  const res = await fetch(api, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`)
  const page = (await res.json()).query?.pages?.[0]
  if (!page || page.missing || !page.extract) throw new Error('Wikipedia has no article at that link')
  const edited = page.revisions?.[0]?.timestamp
  return {
    text: clean(page.extract.split('\n')),
    head: { by: 'Wikipedia', author: 'Wikipedia contributors', title: page.title, publisher: 'Wikipedia', date: edited ? new Date(edited) : null, url: page.fullurl || url.href },
  }
}

const meta = (doc, ...names) => {
  for (const n of names) {
    const v = doc.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content')?.trim()
    if (v) return v
  }
  return ''
}

// Any other page: only if it allows being read. Its HTML is parsed, never run or shown: the demo
// takes the text of its paragraphs and a few meta tags.
async function fromPage(url) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error(`${url.hostname} doesn’t let other pages read it, so this demo can’t. Scythe reads any link from your team’s server. Here, try a Wikipedia link, or paste the text.`)
  }
  if (!res.ok) throw new Error(`${url.hostname} answered ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body
  const text = clean([...(root?.querySelectorAll('p') ?? [])].map((p) => p.textContent))
  if (!text) throw new Error('That page has no paragraphs to cut from. Paste the text instead.')
  const when = meta(doc, 'article:published_time', 'date', 'pubdate', 'citation_publication_date') || doc.querySelector('time[datetime]')?.getAttribute('datetime')
  const date = when && !Number.isNaN(Date.parse(when)) ? new Date(when) : null
  return {
    text,
    head: {
      author: meta(doc, 'author', 'article:author', 'citation_author'),
      title: meta(doc, 'og:title', 'citation_title') || doc.title.trim(),
      publisher: meta(doc, 'og:site_name', 'citation_journal_title') || url.hostname.replace(/^www\./, ''),
      date, url: url.href,
    },
  }
}

// ---------------------------------------------------------------- state

let source = '' // the source's text, as fetched or pasted
let card = null // { text, spans: [{ style, start, end }] }
let condensed = false
let last = null // the last selection in the source or the card: { where, range: [start, end] }

const sourceEl = $('demo-source')
const bodyEl = $('demo-body')
const say = (text, isError) => {
  const s = $('demo-status')
  s.hidden = !text
  s.textContent = text || ''
  s.className = isError ? 'error' : 'note'
}

// Character offset of a selection boundary, in a tree whose text sits in elements tagged data-start.
function offset(node, off) {
  let e = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  if (node.nodeType !== Node.TEXT_NODE && e?.dataset.start === undefined) {
    const child = e?.childNodes[off]
    if (child?.dataset?.start !== undefined) return Number(child.dataset.start)
    const before = e?.childNodes[off - 1]
    if (before?.dataset?.start !== undefined) return Number(before.dataset.start) + before.textContent.length
  }
  while (e && e.dataset.start === undefined) e = e.parentElement
  if (!e) return null
  return node.nodeType === Node.TEXT_NODE ? Number(e.dataset.start) + off : Number(e.dataset.start) + (off > 0 ? e.textContent.length : 0)
}

function selectionIn(container) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null
  const a = offset(r.startContainer, r.startOffset), b = offset(r.endContainer, r.endOffset)
  return a === null || b === null || a === b ? null : [Math.min(a, b), Math.max(a, b)]
}

// Buttons take the selection made just before them, so a tap on a phone doesn't lose it.
document.addEventListener('selectionchange', () => {
  for (const [where, box] of [['source', sourceEl], ['card', bodyEl]]) {
    const range = selectionIn(box)
    if (range) { last = { where, range }; return }
  }
})

// ---------------------------------------------------------------- drawing

function drawSource() {
  sourceEl.replaceChildren()
  let pos = 0
  for (const line of source.split('\n')) {
    if (line.trim()) {
      const p = el('p', null, line)
      p.dataset.start = pos
      sourceEl.append(p)
    }
    pos += line.length + 1
  }
  $('demo-cut-row').hidden = !source
  $('demo-source-wrap').hidden = !source
}

// The styles on each character of the card.
const flags = () => {
  const f = Array.from({ length: card.text.length }, () => new Set())
  for (const s of card.spans) for (let i = s.start; i < s.end; i++) f[i].add(s.style)
  return f.map((set) => STYLES.filter((x) => set.has(x)))
}

function drawCard() {
  $('demo-card').hidden = !card
  if (!card) return
  bodyEl.replaceChildren()
  const f = flags()
  let pos = 0
  for (const line of card.text.split('\n')) {
    const p = el('p')
    let i = pos, gap = false
    const end = pos + line.length
    while (i < end) {
      let j = i
      while (j < end && f[j].join() === f[i].join()) j++
      const styles = f[i], text = card.text.slice(i, j)
      if (condensed && !styles.length && text.trim()) {
        // Read aloud: the unmarked words drop out, and a gap shows where they were.
        if (p.childNodes.length && !gap) p.append(' … ')
        gap = true
      } else if (condensed && !styles.length) {
        if (!gap) p.append(text)
      } else {
        const run = el('span', styles.map((s) => CLASS[s]).join(' ') || null, text)
        if (!condensed) run.dataset.start = i
        // Emphasis sits on top of the highlight, as in the app.
        if (styles.includes('emphasis')) run.classList.add('t-hl')
        p.append(run)
        gap = false
      }
      i = j
    }
    if (gap && p.lastChild?.nodeType === Node.TEXT_NODE) p.lastChild.remove()
    if (p.textContent.trim()) bodyEl.append(p)
    pos += line.length + 1
  }
  bodyEl.classList.toggle('condensed', condensed)
  $('demo-read').classList.toggle('on', condensed)
  $('demo-full').classList.toggle('on', !condensed)
  for (const b of document.querySelectorAll('[data-style]')) b.disabled = condensed
  const marked = new Set(card.spans.flatMap((s) => Array.from({ length: s.end - s.start }, (_, k) => s.start + k)))
  const read = tokens(card.text).filter(([a]) => marked.has(a)).length
  drawHead()
  $('demo-count').textContent = `${countWords(card.text)} words; ${read ? `${read} marked to read` : 'none marked yet'}`
}

// ---------------------------------------------------------------- actions

async function fetchSource(e) {
  e.preventDefault()
  let url
  try {
    url = new URL($('demo-url').value.trim())
    if (!/^https?:$/.test(url.protocol)) throw new Error()
  } catch {
    return say('A link starts with http:// or https:// and names a site.', true)
  }
  const button = $('demo-fetch')
  button.disabled = true
  say('Reading the source…')
  try {
    const got = /\.wikipedia\.org$/.test(url.hostname) && url.pathname.startsWith('/wiki/') ? await fromWikipedia(url) : await fromPage(url)
    useSource(got.text, draftCite(got.head))
  } catch (err) {
    say(err.name === 'TimeoutError' ? 'The site took too long to answer. Try again, or paste the text.' : err.message, true)
  } finally {
    button.disabled = false
  }
}

function useSource(text, cite) {
  const n = countWords(text)
  if (n > SOURCE_WORDS) {
    // The app refuses a source this long; the demo keeps the start of it.
    let words = 0, end = 0
    for (const m of text.matchAll(/\S+/g)) { if (++words > SOURCE_WORDS) break; end = m.index + m[0].length }
    text = text.slice(0, end)
  }
  source = text
  card = null
  $('demo-cite').value = cite
  drawSource()
  drawCard()
  say(`Source read: ${countWords(text).toLocaleString()} words. Select the passage to cut, or double-click a paragraph to take all of it.`)
}

function pasteSource() {
  const text = $('demo-paste').value.replace(/\r\n?/g, '\n').replace(/[ \t]*\n[ \t]*(?=\S)/g, (m, i, s) => (/[.!?:”"’)]$/.test(s.slice(0, i).trimEnd()) ? '\n' : ' ')).trim()
  if (!text) return say('Paste the article’s text first.', true)
  useSource(text, $('demo-cite').value || 'Lastname 24, Author Name, “Article Title”, Publication, 3-14-2024, link')
}

function cut() {
  if (!last || last.where !== 'source') return say('Select the words to cut in the source first.', true)
  const range = snap(source, ...last.range)
  if (!range) return say('Select at least one word.', true)
  const text = source.slice(...range)
  const n = countWords(text)
  if (n > CARD_WORDS) return say(`A card can be ${CARD_WORDS} words at most. This one is ${n}: cut it to the words that matter.`, true)
  card = { text, spans: [] }
  condensed = false
  last = null
  window.getSelection()?.removeAllRanges()
  if (!$('demo-tag').value.trim()) $('demo-tag').focus({ preventScroll: true })
  drawCard()
  say('Cut. Write the tag, then select words in the card and press 1, 2 or 3.')
  $('demo-card').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

// Marks toggle: the style comes off a selection that already has it everywhere, and goes on otherwise.
function mark(style) {
  if (!card || condensed) return
  if (!last || last.where !== 'card') return say('Select words in the card to mark them.', true)
  const range = snap(card.text, ...last.range)
  if (!range) return
  const [a, b] = range
  const f = flags()
  const has = f.slice(a, b).every((s, k) => s.includes(style) || !card.text[a + k].trim())
  const keep = []
  for (const s of card.spans) {
    if (s.style !== style || s.end <= a || s.start >= b) { keep.push(s); continue }
    if (s.start < a) keep.push({ ...s, end: a })
    if (s.end > b) keep.push({ ...s, start: b })
  }
  if (!has) {
    // Merge with any touching span of the same style so the card stays a few clean runs.
    let lo = a, hi = b
    for (let k = keep.length - 1; k >= 0; k--) {
      const s = keep[k]
      if (s.style === style && s.end >= lo && s.start <= hi) { lo = Math.min(lo, s.start); hi = Math.max(hi, s.end); keep.splice(k, 1) }
    }
    keep.push({ style, start: lo, end: hi })
  }
  card.spans = keep
  drawCard()
  say('')
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Copy for Word, with Verbatim's formatting, as the app's copy does (lib/render.ts copyCard).
async function copy() {
  if (!card) return
  const f = flags()
  const tag = $('demo-tag').value.trim() || 'Untagged'
  const cite = $('demo-cite').value.trim()
  const paras = []
  let pos = 0
  for (const line of card.text.split('\n')) {
    const runs = []
    let i = pos
    while (i < pos + line.length) {
      let j = i
      while (j < pos + line.length && f[j].join() === f[i].join()) j++
      const st = f[i], css = []
      if (st.includes('underline') || st.includes('emphasis')) css.push('text-decoration:underline')
      if (st.includes('highlight')) css.push('background:#00ffff')
      if (st.includes('emphasis')) css.push('font-weight:bold', 'border:1px solid #000')
      if (!st.length) css.push('font-size:8pt')
      runs.push(`<span style="${css.join(';')}">${esc(card.text.slice(i, j))}</span>`)
      i = j
    }
    if (line.trim()) paras.push(`<p style="font-family:Calibri,sans-serif;font-size:11pt">${runs.join('')}</p>`)
    pos += line.length + 1
  }
  const c = cite.indexOf(',')
  const citeHtml = cite ? `<p style="font-family:Calibri,sans-serif;font-size:11pt"><b style="font-size:13pt">${esc(c < 0 ? cite : cite.slice(0, c))}</b>${esc(c < 0 ? '' : cite.slice(c))}</p>` : ''
  const html = `<h4 style="font-family:Calibri,sans-serif;font-size:13pt">${esc(tag)}</h4>${citeHtml}${paras.join('')}`
  const text = [tag, cite, card.text].filter(Boolean).join('\n\n')
  try {
    if ('ClipboardItem' in window) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    } else await navigator.clipboard.writeText(text)
    say('Copied. Paste it into Word.')
  } catch {
    say('Your browser didn’t allow copying from this page.', true)
  }
}

// ---------------------------------------------------------------- wiring

$('demo-form').addEventListener('submit', fetchSource)
$('demo-paste-go').addEventListener('click', pasteSource)
$('demo-cut').addEventListener('click', cut)
$('demo-copy').addEventListener('click', copy)
$('demo-full').addEventListener('click', () => { condensed = false; drawCard() })
$('demo-read').addEventListener('click', () => { condensed = true; drawCard() })
$('demo-tag').addEventListener('input', drawHead)
$('demo-cite').addEventListener('input', drawHead)
for (const b of document.querySelectorAll('[data-style]')) b.addEventListener('click', () => mark(b.dataset.style))
// Keep the selection when a button is pressed.
for (const b of document.querySelectorAll('#demo button')) b.addEventListener('pointerdown', (e) => e.preventDefault())

// Double-click a paragraph of the source to take all of it.
sourceEl.addEventListener('dblclick', (e) => {
  const p = e.target.closest('p[data-start]')
  if (!p) return
  const r = document.createRange()
  r.selectNodeContents(p)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
})

// 1, 2 and 3 mark the card's selected words; Enter in the source cuts.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return
  const style = STYLES[Number(e.key) - 1]
  if (style && last?.where === 'card' && selectionIn(bodyEl)) { e.preventDefault(); mark(style) }
  else if (e.key === 'Enter' && last?.where === 'source' && selectionIn(sourceEl)) { e.preventDefault(); cut() }
})

// The tag and cite as the card shows them: the cite's first part, before the comma, in bold.
function drawHead() {
  $('demo-tag-out').textContent = $('demo-tag').value.trim() || 'Untagged'
  const out = $('demo-cite-out')
  const cite = $('demo-cite').value.trim()
  const c = cite.indexOf(',')
  out.replaceChildren()
  if (!cite) return
  out.append(el('strong', null, c < 0 ? cite : cite.slice(0, c)), c < 0 ? '' : cite.slice(c))
}
