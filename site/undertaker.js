// The undertaker: a Quixote-thin stick figure in a top hat, scythe over his shoulder, pacing the
// bottom of the header in white d3 strokes, without a sound. Reach for him and he bolts, scythe in
// hand, off one edge and back in from the other. With reduced motion he just stands there, waiting.
;(() => {
  const svgEl = document.getElementById('undertaker')
  const banner = svgEl && svgEl.closest('.banner')
  if (!svgEl || !banner || !window.d3) return
  const d3 = window.d3

  // ---------------------------------------------------------------- body plan (local units, facing right)
  const THIGH = 27, SHIN = 28, TORSO = 36, NECK = 5, HEAD = 6.5
  const UPPER = 20, FORE = 19
  const LEGS = THIGH + SHIN // hip height above the ground when the legs are straight
  const SCALE = 1.15        // how big he is on screen
  const HEIGHT = 230        // the strip he walks in: tall enough for the scythe blade over his hat
  const GROUND = HEIGHT - 14

  const svg = d3.select(svgEl).attr('height', HEIGHT)
  const fig = svg.append('g').attr('class', 'figure')
  const coat = fig.append('path').attr('class', 'stroke thin')
  const body = fig.append('path').attr('class', 'stroke')
  const head = fig.append('circle').attr('class', 'stroke').attr('r', HEAD)
  const hat = fig.append('path').attr('class', 'solid')
  const snath = fig.append('path').attr('class', 'stroke')
  const blade = fig.append('path').attr('class', 'solid')

  // ---------------------------------------------------------------- state
  let width = banner.clientWidth
  let x = width * 0.18
  let dir = 1                  // 1 walking right, -1 walking left
  let phase = 0
  let speed = 0                // eases toward the gait's speed
  let fleeUntil = 0
  const WALK = { speed: 34, hz: 0.75, stride: 0.42, knee: 0.55, lean: 0.06, arm: 0.35 }
  const RUN = { speed: 230, hz: 2.6, stride: 0.95, knee: 1.35, lean: 0.42, arm: 1.0 }

  new ResizeObserver(() => { width = banner.clientWidth; svg.attr('width', width) }).observe(banner)
  svg.attr('width', width)

  // ---------------------------------------------------------------- geometry helpers
  const at = (p, angle, len) => [p[0] + Math.sin(angle) * len, p[1] + Math.cos(angle) * len] // angle from straight down
  const up = (p, angle, len) => [p[0] + Math.sin(angle) * len, p[1] - Math.cos(angle) * len] // angle from straight up
  const line = (...pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')
  const mix = (a, b, t) => a + (b - a) * t


  // ---------------------------------------------------------------- one frame of the figure
  // t: 0 walking … 1 running (blended so he never snaps between gaits)
  function pose(t) {
    const g = (k) => mix(WALK[k], RUN[k], t)
    const lean = g('lean')
    const bob = Math.abs(Math.cos(phase)) * mix(2, 5, t)
    const hip = [0, -bob]

    const legs = [0, Math.PI].map((off) => {
      const q = phase + off
      const thigh = g('stride') * Math.sin(q)
      const bend = g('knee') * Math.max(0, Math.sin(q + Math.PI / 2)) // knee folds as the leg swings through
      const knee = at(hip, thigh, THIGH)
      const foot = at(knee, thigh - bend, SHIN)
      return { knee, foot, toe: [foot[0] + 5, foot[1]] }
    })

    const shoulder = up(hip, lean, TORSO)
    const neck = up(shoulder, lean, NECK)
    const headC = up(neck, lean, HEAD)

    // Back arm swings; front arm carries the scythe.
    const swing = g('arm') * Math.sin(phase + Math.PI)
    const backElbow = at(shoulder, swing - 0.1, UPPER)
    const backHand = at(backElbow, swing + mix(0.3, 1.4, t), FORE)
    const frontElbow = at(shoulder, mix(0.75, 1.15, t) + 0.08 * Math.sin(phase * 2), UPPER)
    const hand = at(frontElbow, mix(1.9, 2.5, t), FORE)

    // Scythe: walking, over the shoulder; running, carried low and trailing.
    const tilt = mix(-0.38, -1.25, t) + 0.05 * Math.sin(phase * 2)
    const top = up(hand, tilt, mix(78, 70, t))
    const butt = up(hand, tilt + Math.PI, 20)
    const bladeD = (() => {
      // A crescent hung forward off the top of the snath.
      const ux = Math.sin(tilt), uy = -Math.cos(tilt)   // along the snath
      const px = uy * -1, py = -ux * -1                  // across it, toward the front
      const L = 46
      const tip = [top[0] + px * L - ux * 6, top[1] + py * L - uy * 6]
      const outer = [top[0] + px * L * 0.55 + ux * 16, top[1] + py * L * 0.55 + uy * 16]
      const inner = [top[0] + px * L * 0.5 + ux * 5, top[1] + py * L * 0.5 + uy * 5]
      return { d: `M${top}Q${outer} ${tip}Q${inner} ${top}Z`, tip }
    })()

    // Coat tails flap behind; the faster he goes the higher they fly.
    const flap = Math.sin(phase * 2) * mix(0.08, 0.25, t)
    const tailA = at(hip, -mix(0.35, 1.05, t) - flap, 30)
    const tailB = at(hip, -mix(0.2, 0.85, t) + flap, 26)

    // Top hat: brim and a tall crown, tipped with the lean (and pushed back when he runs).
    const hatTilt = lean - 0.18 * t
    const crownBase = up(headC, hatTilt, HEAD - 1)
    const ax = Math.cos(hatTilt), ay = Math.sin(hatTilt)
    const side = (p, s) => [p[0] + ax * s, p[1] + ay * s]
    const crownTop = up(crownBase, hatTilt, 15)
    const hatD = line(side(crownBase, -9), side(crownBase, 9), side(crownBase, 5), side(crownTop, 5), side(crownTop, -5), side(crownBase, -5)) + 'Z'

    return {
      body: line(legs[0].toe, legs[0].foot, legs[0].knee, hip, legs[1].knee, legs[1].foot, legs[1].toe) +
        line(hip, shoulder, neck) + line(backHand, backElbow, shoulder, frontElbow, hand),
      coat: line(tailA, hip, tailB),
      head: headC,
      hat: hatD,
      snath: line(butt, top),
      blade: bladeD.d,
    }
  }

  function draw(t) {
    const p = pose(t)
    const baseY = GROUND - LEGS * SCALE
    fig.attr('transform', `translate(${x.toFixed(1)},${baseY.toFixed(1)}) scale(${dir * SCALE},${SCALE})`)
    body.attr('d', p.body)
    coat.attr('d', p.coat)
    head.attr('cx', p.head[0]).attr('cy', p.head[1])
    hat.attr('d', p.hat)
    snath.attr('d', p.snath)
    blade.attr('d', p.blade)

  }

  // ---------------------------------------------------------------- startled
  function threat(px, py) {
    const r = svgEl.getBoundingClientRect()
    if (py < r.top - 40 || py > r.bottom + 10) return
    const fx = r.left + x
    if (Math.abs(px - fx) > 95) return
    if (performance.now() > fleeUntil) dir = px < fx ? 1 : -1 // run away from the hand
    fleeUntil = performance.now() + 2200
  }
  banner.addEventListener('pointermove', (e) => threat(e.clientX, e.clientY))
  banner.addEventListener('pointerdown', (e) => threat(e.clientX, e.clientY))

  // ---------------------------------------------------------------- reduced motion: he stands still
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    phase = Math.PI / 2
    draw(0)
    return
  }

  // ---------------------------------------------------------------- the walk
  let last = performance.now()
  let blend = 0
  d3.timer(() => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    const fleeing = now < fleeUntil
    blend += ((fleeing ? 1 : 0) - blend) * Math.min(1, dt * (fleeing ? 7 : 1.6))
    const gait = { speed: mix(WALK.speed, RUN.speed, blend), hz: mix(WALK.hz, RUN.hz, blend) }
    speed += (gait.speed - speed) * Math.min(1, dt * 5)
    phase += dt * Math.PI * 2 * gait.hz
    x += dir * speed * dt

    // Walking, he turns around at the edges. Running, he leaves and comes back in from the other side.
    if (blend < 0.5) {
      if (x > width - 50 && dir > 0) dir = -1
      if (x < 50 && dir < 0) dir = 1
    } else {
      if (x > width + 90) x = -90
      if (x < -90) x = width + 90
    }

    draw(blend)
  })
})()
