// The round timer, alone, for trying on this page. It keeps time the way the app does (scythe-web, lib/round.ts):
// the round lives in this browser's storage as start times and elapsed time, never a ticking count, so a reload
// loses nothing and the clock needs no connection. The NSDA's times for LD, PF and Policy, or custom times you
// name and keep. What the app adds (what was opened during which speech, and saving the round to the team's
// record) needs the team's Scythe, so here a finished round is copied as text instead.

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const b = (short, name, minutes) => ({ name, short, seconds: Math.round(minutes * 60) })

/** The NSDA's times. PF's speeches are named first and second: a coin flip decides which side speaks first. */
const FORMATS = [
  { name: 'LD', prep: { sides: ['Affirmative', 'Negative'], seconds: 240 }, blocks: [
    b('1AC', 'Affirmative Constructive', 6), b('CX', 'Cross-Examination of the Affirmative', 3),
    b('1NC', 'Negative Constructive', 7), b('CX', 'Cross-Examination of the Negative', 3),
    b('1AR', 'First Affirmative Rebuttal', 4), b('NR', 'Negative Rebuttal', 6), b('2AR', 'Second Affirmative Rebuttal', 3)] },
  { name: 'PF', prep: { sides: ['Pro', 'Con'], seconds: 180 }, blocks: [
    b('C1', 'First Constructive', 4), b('C2', 'Second Constructive', 4), b('CF', 'First Crossfire', 3),
    b('R1', 'First Rebuttal', 4), b('R2', 'Second Rebuttal', 4), b('CF', 'Second Crossfire', 3),
    b('S1', 'First Summary', 3), b('S2', 'Second Summary', 3), b('GCF', 'Grand Crossfire', 3),
    b('FF1', 'First Final Focus', 2), b('FF2', 'Second Final Focus', 2)] },
  { name: 'Policy', prep: { sides: ['Affirmative', 'Negative'], seconds: 480 }, blocks: [
    b('1AC', 'First Affirmative Constructive', 8), b('CX', 'Cross-Examination of the 1AC', 3),
    b('1NC', 'First Negative Constructive', 8), b('CX', 'Cross-Examination of the 1NC', 3),
    b('2AC', 'Second Affirmative Constructive', 8), b('CX', 'Cross-Examination of the 2AC', 3),
    b('2NC', 'Second Negative Constructive', 8), b('CX', 'Cross-Examination of the 2NC', 3),
    b('1NR', 'First Negative Rebuttal', 5), b('1AR', 'First Affirmative Rebuttal', 5),
    b('2NR', 'Second Negative Rebuttal', 5), b('2AR', 'Second Affirmative Rebuttal', 5)] },
]

// ---------------------------------------------------------------- storage: this browser only

const ROUND = 'scythe-landing:round'
const CUSTOM = 'scythe-landing:formats'

function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
function keep(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked: the round lives as long as the page */ }
}
const valid = (r) => (r && Array.isArray(r.format?.blocks) && r.format.blocks.length && Array.isArray(r.used) ? r : null)

let round = valid(load(ROUND, null))
let customs = load(CUSTOM, []).filter((f) => f && f.name && Array.isArray(f.blocks) && f.blocks.length)
function set(next) { round = next; keep(ROUND, next); draw() }

// ---------------------------------------------------------------- the clock's arithmetic

/** Milliseconds `what` ('speech', 0 or 1 for a side's prep) has run, counting a run in progress. */
function ran(r, what, now = Date.now()) {
  const before = what === 'speech' ? r.used[r.current] ?? 0 : r.prepUsed[what]
  return before + (r.running && r.running.what === what ? Math.max(0, now - r.running.since) : 0)
}
const speechLeft = (r, now) => r.format.blocks[r.current].seconds * 1000 - ran(r, 'speech', now)
const prepLeft = (r, side, now) => r.format.prep.seconds * 1000 - ran(r, side, now)

/** "6:00", "0:05", or "0:05 over" once the time's gone. Rounded so a fresh speech reads its full length. */
function clock(ms) {
  const over = ms < 0
  const s = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000)
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return over && s > 0 ? `${text} over` : text
}
/** "4:00" from 240 seconds, and back: how a custom block's length is written. */
const lengthOf = (text) => { const m = /^\s*(\d{1,3})(?::([0-5]\d))?\s*$/.exec(text); return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null }
const written = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// ---------------------------------------------------------------- what the debater does

function begin(format) {
  set({ format, started: new Date().toISOString(), current: 0, used: format.blocks.map(() => 0), prepUsed: [0, 0], running: null, notes: '', ended: null })
}
/** Stops whatever runs, banking its time. */
function stop(r, now = Date.now()) {
  if (!r.running) return r
  const ms = Math.max(0, now - r.running.since)
  const used = [...r.used], prepUsed = [...r.prepUsed]
  if (r.running.what === 'speech') used[r.current] = (used[r.current] ?? 0) + ms
  else prepUsed[r.running.what] += ms
  return { ...r, used, prepUsed, running: null }
}
function toggle(what) {
  if (!round || round.ended) return
  const now = Date.now()
  const r = stop(round, now)
  set(round.running && round.running.what === what ? r : { ...r, running: { what, since: now } })
}
function go(step) {
  if (!round || round.ended) return
  const r = stop(round)
  const current = Math.min(r.format.blocks.length - 1, Math.max(0, r.current + step))
  set({ ...r, current })
}
function end() {
  if (!round) return
  set({ ...stop(round), ended: new Date().toISOString() })
}

/** The finished round as text, the way the app writes rounds/<n>.md, minus what only the app knows. */
function asMarkdown(r) {
  const lines = [`# ${r.format.name} round`, '', `Started ${r.started}, ended ${r.ended ?? ''}.`, '', '| Speech | Length | Used |', '| --- | --- | --- |']
  r.format.blocks.forEach((blk, i) => lines.push(`| ${blk.name} | ${written(blk.seconds)} | ${clock(r.used[i] ?? 0)} |`))
  lines.push('', `Prep: ${r.format.prep.sides[0]} ${clock(r.prepUsed[0])} of ${written(r.format.prep.seconds)}, ${r.format.prep.sides[1]} ${clock(r.prepUsed[1])} of ${written(r.format.prep.seconds)}.`)
  if (r.notes.trim()) lines.push('', '## Notes', '', r.notes.trim())
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- drawing

const root = $('timer')
const say = (text) => { const s = $('timer-status'); s.hidden = !text; s.textContent = text ?? '' }

function drawChoices() {
  root.replaceChildren()
  const p = el('p', null, 'Choose the format. ')
  const row = el('div', 'row')
  for (const f of FORMATS) {
    const btn = el('button', 'link', f.name); btn.type = 'button'
    btn.addEventListener('click', () => { say(null); begin(f) })
    row.append(btn)
  }
  const custom = el('button', 'link', 'custom times'); custom.type = 'button'
  custom.addEventListener('click', () => drawCustom())
  row.append(custom)
  for (const f of customs) {
    const btn = el('button', 'link', f.name); btn.type = 'button'; btn.title = 'Custom times you kept'
    btn.addEventListener('click', () => { say(null); begin(f) })
    row.append(btn)
  }
  root.append(p, row)
}

function drawCustom() {
  root.replaceChildren()
  const form = el('form', 'gap')
  const lbl = el('label', 'timer-label', 'Blocks, one a line: a name, then a length as minutes or minutes:seconds'); lbl.htmlFor = 'timer-blocks'
  const blocks = el('textarea', 'field'); blocks.id = 'timer-blocks'; blocks.rows = 4; blocks.placeholder = 'Opening 5:00\nQuestions 2:00\nClosing 3:00'
  const row = el('div', 'row')
  const prepL = el('label', 'timer-label', 'Prep a side'); prepL.htmlFor = 'timer-prep'
  const prep = el('input', 'field'); prep.id = 'timer-prep'; prep.placeholder = '2:00'; prep.style.maxWidth = '6rem'
  const nameL = el('label', 'timer-label', 'Name these times'); nameL.htmlFor = 'timer-name'
  const name = el('input', 'field'); name.id = 'timer-name'; name.placeholder = 'Parli practice'; name.maxLength = 60
  row.append(prepL, prep, nameL, name)
  const actions = el('div', 'row')
  const start = el('button', 'action', 'Start'); start.type = 'submit'
  const back = el('button', 'link', 'back'); back.type = 'button'; back.addEventListener('click', () => { say(null); drawChoices() })
  actions.append(start, back)
  form.append(lbl, blocks, row, actions)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const parsed = []
    for (const line of blocks.value.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const m = /^(.*\S)\s+(\d{1,3}(?::[0-5]\d)?)$/.exec(line)
      const seconds = m && lengthOf(m[2])
      if (!m || !seconds) return say(`“${line}” needs a name, then a length such as 5:00.`)
      parsed.push({ name: m[1], short: m[1].split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4), seconds })
    }
    if (!parsed.length) return say('Write at least one block.')
    const prepSeconds = prep.value.trim() ? lengthOf(prep.value) : 0
    if (prepSeconds === null) return say('Prep is a length such as 2:00.')
    const format = { name: name.value.trim() || 'Custom times', prep: { sides: ['Affirmative', 'Negative'], seconds: prepSeconds }, blocks: parsed }
    customs = [format, ...customs.filter((f) => f.name !== format.name)].slice(0, 8)
    keep(CUSTOM, customs)
    say(null)
    begin(format)
  })
  root.append(form)
}

let ticking = null
function drawRound() {
  const r = round
  root.replaceChildren()
  const blk = r.format.blocks[r.current]
  const head = el('p', 'timer-speech')
  head.append(el('strong', null, blk.short), ' ', el('span', null, blk.name), ' ', el('span', 'timer-count', `${r.current + 1} of ${r.format.blocks.length}`))
  const face = el('p', 'timer-clock'); face.id = 'timer-clock'; face.setAttribute('role', 'timer'); face.setAttribute('aria-live', 'off')
  const controls = el('div', 'row')
  const startStop = el('button', 'action'); startStop.type = 'button'; startStop.id = 'timer-start'
  startStop.addEventListener('click', () => toggle('speech'))
  const prev = el('button', 'link', 'previous'); prev.type = 'button'; prev.disabled = r.current === 0; prev.addEventListener('click', () => go(-1))
  const next = el('button', 'link', 'next speech'); next.type = 'button'; next.disabled = r.current === r.format.blocks.length - 1; next.addEventListener('click', () => go(1))
  controls.append(startStop, prev, next)
  const prepRow = el('div', 'row timer-prep')
  const prepEls = [0, 1].map((side) => {
    const span = el('span')
    const label = el('span', null, `${r.format.prep.sides[side]} prep `)
    const left = el('strong'); left.id = `timer-prep-${side}`
    const btn = el('button', 'link'); btn.type = 'button'; btn.id = `timer-prep-btn-${side}`
    btn.addEventListener('click', () => toggle(side))
    span.append(label, left, ' ', btn)
    prepRow.append(span)
    return { left, btn }
  })
  const finish = el('div', 'row')
  const endBtn = el('button', 'link', 'end the round'); endBtn.type = 'button'; endBtn.addEventListener('click', end)
  finish.append(endBtn)
  root.append(head, face, controls, r.format.prep.seconds ? prepRow : el('span'), finish)

  const tick = () => {
    const now = Date.now()
    const left = speechLeft(r, now)
    face.textContent = clock(left)
    face.classList.toggle('over', left < 0)
    face.classList.toggle('running', !!r.running && r.running.what === 'speech')
    startStop.textContent = r.running && r.running.what === 'speech' ? 'Stop' : ran(r, 'speech', now) ? 'Resume' : 'Start'
    prepEls.forEach(({ left: l, btn }, side) => {
      const pl = prepLeft(r, side, now)
      l.textContent = clock(pl)
      l.classList.toggle('over', pl < 0)
      btn.textContent = r.running && r.running.what === side ? 'stop' : 'start'
    })
  }
  tick()
  clearInterval(ticking)
  ticking = r.running ? setInterval(tick, 250) : null
}

function drawEnded() {
  const r = round
  root.replaceChildren()
  const p = el('p', null, `${r.format.name}: the round is over. Add notes, then copy it.`)
  const table = el('table', 'timer-table')
  const thead = el('thead'); const hr = el('tr'); ['Speech', 'Length', 'Used'].forEach((h) => hr.append(el('th', null, h))); thead.append(hr)
  const tbody = el('tbody')
  r.format.blocks.forEach((blk, i) => {
    const tr = el('tr')
    tr.append(el('td', null, blk.name), el('td', null, written(blk.seconds)), el('td', (r.used[i] ?? 0) > blk.seconds * 1000 ? 'over' : null, clock(r.used[i] ?? 0)))
    tbody.append(tr)
  })
  table.append(thead, tbody)
  const prep = el('p', null, `Prep used: ${r.format.prep.sides[0]} ${clock(r.prepUsed[0])}, ${r.format.prep.sides[1]} ${clock(r.prepUsed[1])}, of ${written(r.format.prep.seconds)} each.`)
  const lbl = el('label', 'timer-label', 'Notes'); lbl.htmlFor = 'timer-notes'
  const notes = el('textarea', 'field'); notes.id = 'timer-notes'; notes.rows = 3; notes.value = r.notes; notes.placeholder = 'What happened, what to cut next'
  notes.addEventListener('input', () => { round = { ...round, notes: notes.value }; keep(ROUND, round) })
  const row = el('div', 'row')
  const copy = el('button', 'action', 'Copy the round'); copy.type = 'button'
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(asMarkdown(round)); say('Copied. In the app this is saved to the team’s record instead.') }
    catch { say('Couldn’t copy. Select the table and copy it yourself.') }
  })
  const again = el('button', 'link', 'new round'); again.type = 'button'; again.addEventListener('click', () => { say(null); set(null) })
  row.append(copy, again)
  root.append(p, table, r.format.prep.seconds ? prep : el('span'), lbl, notes, row)
}

function draw() {
  clearInterval(ticking); ticking = null
  if (!round) drawChoices()
  else if (round.ended) drawEnded()
  else drawRound()
}

// Another tab changed the round: read it again.
window.addEventListener('storage', (e) => { if (e.key === ROUND) { round = valid(load(ROUND, null)); draw() } })
draw()
