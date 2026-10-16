// The undertaker: a Quixote-thin stick figure in a top hat, scythe over his shoulder. The big
// "scythe" letters are his ground: he walks along the tops of the glyphs themselves, stepping up
// onto the tall 't' and 'h' and down onto the short letters like stairs. Every so often he picks a
// letter, walks to it, slows to a stop, bends his knees and sits right on its top edge, his legs
// swinging round toward you and hanging down over the face of the letter, the scythe held upright
// beside him like a staff. After a while he stands back up and strolls on. Nothing ever snaps:
// steps are eased, the stride shrinks to nothing as he stops, and sitting and standing are one
// continuous motion. Reach for him and he springs up and bolts. With reduced motion he just sits
// on the 'h'.
;(() => {
  const svgEl = document.getElementById('undertaker')
  const banner = svgEl && svgEl.closest('.banner')
  const wordmark = document.getElementById('wordmark')
  if (!svgEl || !banner || !wordmark || !window.d3) return
  const d3 = window.d3

  // ---------------------------------------------------------------- body plan (local units, facing right)
  const THIGH = 27, SHIN = 28, TORSO = 36, NECK = 5, HEAD = 6.5
  const UPPER = 20, FORE = 19
  const LEGS = THIGH + SHIN // hip height when standing
  const SCALE = 1.5

  let width = banner.clientWidth, HEIGHT = banner.clientHeight || 800
  const svg = d3.select(svgEl)
  const fig = svg.append('g').attr('class', 'figure')
  const coat = fig.append('path').attr('class', 'stroke thin')
  const body = fig.append('path').attr('class', 'stroke')
  const headEl = fig.append('circle').attr('class', 'stroke').attr('r', HEAD)
  const hat = fig.append('path').attr('class', 'solid')
  const snath = fig.append('path').attr('class', 'stroke')
  const blade = fig.append('path').attr('class', 'solid')

  // ---------------------------------------------------------------- the letters: where he walks and sits
  // A range's box is the whole line box, well above a lowercase letter. The ink's real top edge is
  // the baseline minus the glyph's own ascent, measured on a canvas in the wordmark's font.
  let letters = [] // {cx, left, right, top} in banner coordinates; top is the top of the ink
  let span = [0, 0], plainTop = 0 // the word's extent, and the x-height line used off the word
  const ctx = document.createElement('canvas').getContext('2d')

  function measureLetters() {
    const tn = wordmark.firstChild
    if (!tn || tn.nodeType !== Node.TEXT_NODE) return
    const bR = banner.getBoundingClientRect()
    const probe = document.createElement('span') // sits on the baseline
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    wordmark.appendChild(probe)
    const baseline = probe.getBoundingClientRect().top - bR.top
    probe.remove()
    const cs = getComputedStyle(wordmark)
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const text = tn.textContent
    const range = document.createRange()
    letters = []
    for (let i = 0; i < tn.length; i++) {
      range.setStart(tn, i); range.setEnd(tn, i + 1)
      const r = range.getBoundingClientRect()
      if (r.width < 2) continue
      const ascent = ctx.measureText(text[i]).actualBoundingBoxAscent
      letters.push({ cx: r.left - bR.left + r.width / 2, left: r.left - bR.left, right: r.right - bR.left, top: baseline - ascent })
    }
    if (!letters.length) return
    span = [letters[0].left, letters[letters.length - 1].right]
    plainTop = Math.max(...letters.map((l) => l.top))
  }

  // The surface under x: the letter he is over (nearest in the gaps), or the x-height line off the word.
  function surface(px) {
    if (!letters.length) return HEIGHT * 0.4
    if (px < span[0] || px > span[1]) return plainTop
    let best = letters[0]
    for (const l of letters) if (Math.abs(l.cx - px) < Math.abs(best.cx - px)) best = l
    return best.top
  }

  // ---------------------------------------------------------------- state
  let x, gy, dir = 1, phase = 0, speed = 0, fleeUntil = 0
  let runBlend = 0   // 0 walking … 1 running
  let sitBlend = 0   // 0 standing … 1 seated
  let target = null  // the letter he is walking to, or sitting on
  const S = { STROLL: 0, APPROACH: 1, SITTING: 2, SEATED: 3, RISING: 4, RUN: 5 }
  let state = S.STROLL, timer = 3 + Math.random() * 3

  const WALK = { speed: 34, hz: 0.75, stride: 0.42, knee: 0.55, lean: 0.06, arm: 0.35 }
  const RUN = { speed: 230, hz: 2.6, stride: 0.95, knee: 1.35, lean: 0.42, arm: 1.0 }

  function layout() {
    width = banner.clientWidth; HEIGHT = banner.clientHeight || 800
    svg.attr('width', width).attr('height', HEIGHT)
    measureLetters()
    if (target) target = letters.reduce((a, l) => (Math.abs(l.cx - x) < Math.abs(a.cx - x) ? l : a), letters[0])
    if (x === undefined) x = letters.length ? letters[0].cx : width * 0.1
    gy = surface(x)
  }
  new ResizeObserver(layout).observe(banner)
  if (document.fonts) document.fonts.ready.then(layout) // the web font changes every glyph's size
  layout()

  // ---------------------------------------------------------------- geometry helpers
  const at = (p, a, l) => [p[0] + Math.sin(a) * l, p[1] + Math.cos(a) * l] // angle from straight down
  const up = (p, a, l) => [p[0] + Math.sin(a) * l, p[1] - Math.cos(a) * l] // angle from straight up
  const ln = (...pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')
  const mx = (a, b, t) => a + (b - a) * t
  const lerpP = (a, b, t) => [mx(a[0], b[0], t), mx(a[1], b[1], t)]
  const smooth = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v))

  // A crescent blade hung forward off the top of the snath.
  function crescent(top, tilt) {
    const ux = Math.sin(tilt), uy = -Math.cos(tilt), px = -uy, py = ux, L = 46
    const tip = [top[0] + px * L - ux * 6, top[1] + py * L - uy * 6]
    const outer = [top[0] + px * L * 0.55 + ux * 16, top[1] + py * L * 0.55 + uy * 16]
    const inner = [top[0] + px * L * 0.5 + ux * 5, top[1] + py * L * 0.5 + uy * 5]
    return `M${top}Q${outer} ${tip}Q${inner} ${top}Z`
  }
  function topHat(hd, tilt, t) {
    const ht = tilt - 0.18 * t, cb = up(hd, ht, HEAD - 1)
    const ax = Math.cos(ht), ay = Math.sin(ht), sd = (p, s) => [p[0] + ax * s, p[1] + ay * s]
    const ct = up(cb, ht, 15)
    return ln(sd(cb, -9), sd(cb, 9), sd(cb, 5), sd(ct, 5), sd(ct, -5), sd(cb, -5)) + 'Z'
  }

  // ---------------------------------------------------------------- walking / running
  // t: 0 walking … 1 running. m: how much of the stride is left (shrinks to 0 as he stops).
  function walkPose(t, m) {
    const g = (k) => mx(WALK[k], RUN[k], t)
    const lean = g('lean') * m
    const bob = Math.abs(Math.cos(phase)) * mx(2, 5, t) * m
    const hip = [0, -bob]
    const legs = [0, Math.PI].map((off) => {
      const q = phase + off
      const thigh = g('stride') * m * Math.sin(q)
      const bend = g('knee') * m * Math.max(0, Math.sin(q + Math.PI / 2))
      const knee = at(hip, thigh, THIGH), foot = at(knee, thigh - bend, SHIN)
      return { knee, foot, toe: [foot[0] + 5, foot[1]] }
    })
    const shoulder = up(hip, lean, TORSO), neck = up(shoulder, lean, NECK), hd = up(neck, lean, HEAD)
    const swing = g('arm') * m * Math.sin(phase + Math.PI)
    const bElbow = at(shoulder, swing - 0.1, UPPER), bHand = at(bElbow, swing + mx(0.3, 1.4, t), FORE)
    const fElbow = at(shoulder, mx(0.75, 1.15, t) + 0.08 * m * Math.sin(phase * 2), UPPER)
    const hand = at(fElbow, mx(1.9, 2.5, t), FORE)
    const tilt = mx(-0.38, -1.25, t) + 0.05 * m * Math.sin(phase * 2)
    const top = up(hand, tilt, mx(78, 70, t)), butt = up(hand, tilt + Math.PI, 20)
    const flap = Math.sin(phase * 2) * mx(0.08, 0.25, t) * m
    const tailA = at(hip, -mx(0.35, 1.05, t) - flap, 30), tailB = at(hip, -mx(0.2, 0.85, t) + flap, 26)
    return {
      body: ln(legs[0].toe, legs[0].foot, legs[0].knee, hip, legs[1].knee, legs[1].foot, legs[1].toe) +
        ln(hip, shoulder, neck) + ln(bHand, bElbow, shoulder, fElbow, hand),
      coat: ln(tailA, hip, tailB), hd, hatD: topHat(hd, lean, t), snath: ln(butt, top), blade: crescent(top, tilt),
      hipHeight: LEGS,
    }
  }

  // ---------------------------------------------------------------- sitting down (s: 0 standing … 1 seated)
  // Leg keyframes, hip at the origin: standing straight; crouched in profile with the knees bent;
  // seated on the letter's top edge with the thighs swung toward you (foreshortened to a stub) and
  // the shins hanging straight down over the face of the letter, a little apart.
  const LEG_KEYS = {
    stand:  [{ knee: [1, THIGH], foot: [1, LEGS], toe: [6, LEGS] }, { knee: [-1, THIGH], foot: [-1, LEGS], toe: [4, LEGS] }],
    crouch: [{ knee: [22, 15], foot: [6, 26], toe: [11, 26] }, { knee: [19, 17], foot: [2, 26], toe: [7, 26] }],
    seated: [{ knee: [7, 6], foot: [8, 6 + SHIN], toe: [12, 5 + SHIN] }, { knee: [-3, 7], foot: [-3, 7 + SHIN], toe: [1, 6 + SHIN] }],
  }
  const KEY = {
    stand:  { hip: LEGS, lean: 0.06, handA: 0.75, handB: 1.9, tilt: -0.38, tail: 0 },
    crouch: { hip: 26,   lean: 0.38, handA: 0.95, handB: 1.7, tilt: -0.2,  tail: 0.5 },
    seated: { hip: -2,   lean: 0.02, handA: 0.6,  handB: 2.2,  tilt: 0.12, tail: 1 },
  }
  function sitPose(s) {
    const e = smooth(s)
    const [from, to, t] = e < 0.5 ? ['stand', 'crouch', e * 2] : ['crouch', 'seated', (e - 0.5) * 2]
    const k = {}
    for (const key of Object.keys(KEY[from])) k[key] = mx(KEY[from][key], KEY[to][key], t)
    const hip = [0, 0]
    const legs = [0, 1].map((i) => {
      const a = LEG_KEYS[from][i], b = LEG_KEYS[to][i]
      return { knee: lerpP(a.knee, b.knee, t), foot: lerpP(a.foot, b.foot, t), toe: lerpP(a.toe, b.toe, t) }
    })
    const shoulder = up(hip, k.lean, TORSO), neck = up(shoulder, k.lean, NECK), hd = up(neck, k.lean, HEAD)
    // Back hand comes to rest on the near knee; the front hand keeps the scythe.
    const bElbow = at(shoulder, mx(-0.1, 0.6, e), UPPER), bHand = lerpP(at(bElbow, 0.3, FORE), legs[0].knee, e)
    const fElbow = at(shoulder, k.handA, UPPER), hand = at(fElbow, k.handB, FORE)
    // The snath swings from over the shoulder to upright, held like a staff while he sits.
    const top = up(hand, k.tilt, 78), butt = up(hand, k.tilt + Math.PI, 20)
    // Coat tails fall behind him, over the back of the letter.
    const tailA = at(hip, mx(-0.35, -0.5, k.tail), 30), tailB = at(hip, mx(-0.2, -0.3, k.tail), 26)
    return {
      body: ln(legs[0].toe, legs[0].foot, legs[0].knee, hip, legs[1].knee, legs[1].foot, legs[1].toe) +
        ln(hip, shoulder, neck) + ln(bHand, bElbow, shoulder, fElbow, hand),
      coat: ln(tailA, hip, tailB), hd, hatD: topHat(hd, k.lean, 0), snath: ln(butt, top), blade: crescent(top, k.tilt),
      hipHeight: k.hip,
    }
  }

  function draw() {
    const moving = Math.min(1, speed / WALK.speed)
    const p = sitBlend > 0 ? sitPose(sitBlend) : walkPose(runBlend, moving)
    const baseY = gy - p.hipHeight * SCALE
    fig.attr('transform', `translate(${x.toFixed(1)},${baseY.toFixed(1)}) scale(${dir * SCALE},${SCALE})`)
    body.attr('d', p.body); coat.attr('d', p.coat)
    headEl.attr('cx', p.hd[0]).attr('cy', p.hd[1])
    hat.attr('d', p.hatD); snath.attr('d', p.snath); blade.attr('d', p.blade)
  }

  // ---------------------------------------------------------------- startled
  function threat(px, py) {
    const r = svgEl.getBoundingClientRect()
    const fy = r.top + gy - LEGS * SCALE * 0.5
    if (Math.abs(py - fy) > 120 || Math.abs(px - (r.left + x)) > 95) return
    if (performance.now() > fleeUntil) dir = px < r.left + x ? 1 : -1 // away from the hand
    fleeUntil = performance.now() + 2200
    state = S.RUN
  }
  banner.addEventListener('pointermove', (e) => threat(e.clientX, e.clientY))
  banner.addEventListener('pointerdown', (e) => threat(e.clientX, e.clientY))

  // ---------------------------------------------------------------- reduced motion: seated on the 'h', still
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const still = () => {
      const l = letters[4] || letters[letters.length - 1]
      if (l) { x = l.cx; gy = l.top; sitBlend = 1 }
      draw()
    }
    if (document.fonts) document.fonts.ready.then(still)
    still()
    return
  }

  // ---------------------------------------------------------------- the loop
  let last = performance.now()
  d3.timer(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const fleeing = now < fleeUntil

    if (!fleeing && state === S.RUN) { state = S.STROLL; timer = 2 + Math.random() * 3 }

    let wantSpeed = 0 // where the gait is heading; speed eases toward it
    switch (state) {
      case S.STROLL:
        wantSpeed = WALK.speed
        timer -= dt
        if (timer <= 0 && letters.length) { target = letters[Math.floor(Math.random() * letters.length)]; state = S.APPROACH }
        break
      case S.APPROACH: {
        const d = target.cx - x
        dir = d < 0 ? -1 : 1
        wantSpeed = WALK.speed * Math.min(1, Math.abs(d) / 24) // decelerate onto the spot
        if (Math.abs(d) < 1.5 && speed < 2) { x = target.cx; speed = 0; state = S.SITTING }
        break
      }
      case S.SITTING:
        sitBlend = Math.min(1, sitBlend + dt / 1.4)
        if (sitBlend >= 1) { state = S.SEATED; timer = 4 + Math.random() * 5 }
        break
      case S.SEATED:
        timer -= dt
        if (timer <= 0) state = S.RISING
        break
      case S.RISING:
        sitBlend = Math.max(0, sitBlend - dt / 1.1)
        if (sitBlend <= 0) { state = S.STROLL; timer = 3 + Math.random() * 4 }
        break
      case S.RUN:
        if (sitBlend > 0) sitBlend = Math.max(0, sitBlend - dt / 0.3) // up in a hurry, then run
        else wantSpeed = RUN.speed
        break
    }

    runBlend += ((state === S.RUN ? 1 : 0) - runBlend) * Math.min(1, dt * (state === S.RUN ? 7 : 1.6))
    speed += (wantSpeed - speed) * Math.min(1, dt * 5)
    phase += dt * Math.PI * 2 * mx(WALK.hz, RUN.hz, runBlend) * Math.min(1, speed / 12)
    const before = x
    x += dir * speed * dt
    if (state === S.APPROACH && (target.cx - before) * (target.cx - x) < 0) x = target.cx // never overshoot

    if (state === S.STROLL) { // pace the word, turning at its ends
      if (x > span[1] - 8 && dir > 0) dir = -1
      if (x < span[0] + 8 && dir < 0) dir = 1
    } else if (state === S.RUN) { // leave one side, come back in from the other
      if (x > width + 90) x = -90
      if (x < -90) x = width + 90
    }

    // Step up and down between letters of different heights, eased so he never jumps.
    gy += (surface(x) - gy) * Math.min(1, dt * 9)
    draw()
  })
})()
