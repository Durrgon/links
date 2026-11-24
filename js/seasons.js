// Seasonal touches, on every route (js/router.js loads it):
//   winter: soft, blurry snow drifting slowly behind the card;
//   fall:   now and then a few red/orange leaves blow across behind the card;
//   hat:    a Santa hat on the avatar, on by itself in December.
// Winter is on by default for now; the lighting panel (js/lit.js, "Season" and
// "Santa hat") switches them, and so do the flags #fall, #nosnow, #hat and #nohat.
// window.seasons.set({ season, hat }) changes them; window.seasons.state reads them.
// Both sit inside the background layer (.--site-bg), behind the card. Snow is three
// tiles of flakes (far, mid, near) made once from a fixed seed, so it is the same pattern
// on every visit, and moved by CSS animations (falling, swaying), so the browser's
// compositor does the work: no drawing per frame. Leaves are drawn on a canvas, only while
// fall is on. With reduced motion, snow stands still and leaves are off.
(() => {
  "use strict";
  const flags = window.route ? window.route.flags : new Set();
  const state = {
    season: flags.has("fall") ? "fall" : flags.has("nosnow") ? "none" : "winter",   // winter for now
    hat: flags.has("nohat") ? false : flags.has("hat") || new Date().getMonth() === 11,
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // =====================================================================================
  // Santa hat: fixed above everything (the lit ring is drawn on a canvas over the page),
  // following the avatar every frame, since on phones the card scrolls.
  // =====================================================================================
  const hat = document.createElement("img");
  hat.src = "images/santa-hat.svg";
  hat.alt = "";
  hat.setAttribute("aria-hidden", "true");
  hat.draggable = false;
  hat.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:12;display:none;" +
    "filter:saturate(.62) brightness(.96) drop-shadow(0 2px 2px rgba(0,0,0,.45));transform-origin:0 0";
  let frameEl = null, hatKey = "";
  function placeHat() {
    const on = state.hat && frameEl && !document.documentElement.classList.contains("loading");
    hat.style.display = on ? "block" : "none";
    if (!on) return;
    const r = frameEl.getBoundingClientRect();
    // sits on the top left of the ring, tipped to the left; the hat is 100 x 80
    const w = r.width * 0.78, x = r.left + r.width * 0.03, y = r.top - r.width * 0.17;
    const key = `${w.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    if (key === hatKey) return;
    hatKey = key;
    hat.style.width = w + "px";
    hat.style.transform = `translate(${x}px, ${y}px) rotate(-14deg)`;
  }

  // =====================================================================================
  // Snow and leaves
  // =====================================================================================
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3;" +
    "opacity:0;transition:opacity .5s ease-out";
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, last = 0, drawn = true;
  const SCALE = 0.5;               // drawn at half resolution: cheaper, and softer anyway

  // Snow. A small seeded random generator, so the flakes land in the same places every time.
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // far to near: tile size (CSS px), flakes per tile, radius and opacity ranges, softness,
  // fall speed (px/s), sway (px, s), and how much phone tilt shifts it
  const SNOW = [
    { tile: 420, n: 36, r: [2, 3.6], a: [0.35, 0.6], soft: 0.55, speed: 16, sway: [8, 7], tilt: 4 },
    { tile: 560, n: 20, r: [4.5, 7], a: [0.45, 0.75], soft: 0.65, speed: 27, sway: [14, 9], tilt: 9 },
    { tile: 760, n: 9, r: [8, 13], a: [0.5, 0.8], soft: 0.8, speed: 40, sway: [22, 11], tilt: 15 },
  ];
  function snowTile(layer, rnd) {
    const c = document.createElement("canvas"), T = layer.tile;
    c.width = c.height = T;
    const x = c.getContext("2d");
    for (let i = 0; i < layer.n; i++) {
      const fx = rnd() * T, fy = rnd() * T;
      const r = layer.r[0] + rnd() * (layer.r[1] - layer.r[0]);
      const a = layer.a[0] + rnd() * (layer.a[1] - layer.a[0]);
      // drawn again across the tile's edges, so it repeats without seams
      for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
        const cx = fx + ox, cy = fy + oy;
        if (cx < -r || cx > T + r || cy < -r || cy > T + r) continue;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1 - layer.soft * 0.6, `rgba(255,255,255,${a * 0.7})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g;
        x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    return c.toDataURL();
  }
  const snow = document.createElement("div");
  snow.setAttribute("aria-hidden", "true");
  snow.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;display:none;" +
    "opacity:0;transition:opacity .5s ease-out";          // faded in once the background is up
  const snowLayers = [];
  let snowMade = false;
  function makeSnow() {
    if (snowMade) return;
    snowMade = true;
    const rnd = seeded(20261124);
    SNOW.forEach((layer, i) => {
      const tilt = document.createElement("div"), sway = document.createElement("div"), fall = document.createElement("div");
      tilt.style.cssText = sway.style.cssText = "position:absolute;inset:0";
      sway.style.animation = `snow-sway ${layer.sway[1]}s ease-in-out ${-i * 2.3}s infinite alternate`;
      sway.style.setProperty("--sway", layer.sway[0] + "px");
      fall.style.cssText = `position:absolute;left:-${layer.sway[0] + 20}px;right:-${layer.sway[0] + 20}px;` +
        `top:-${layer.tile}px;bottom:0;background:url(${snowTile(layer, rnd)}) 0 0 / ${layer.tile}px ${layer.tile}px repeat;` +
        `animation:snow-fall ${(layer.tile / layer.speed).toFixed(2)}s linear infinite`;
      fall.style.setProperty("--tile", layer.tile + "px");
      sway.append(fall); tilt.append(sway); snow.append(tilt);
      snowLayers.push({ el: tilt, tilt: layer.tilt, key: "" });
    });
  }
  const snowStyle = document.createElement("style");
  snowStyle.textContent = `
    @keyframes snow-fall { from { transform: translateY(0) } to { transform: translateY(var(--tile)) } }
    @keyframes snow-sway { from { transform: translateX(calc(-1 * var(--sway))) } to { transform: translateX(var(--sway)) } }
    @media (prefers-reduced-motion: reduce) { .--site-bg [style*="snow-"] { animation: none !important } }`;
  // phone tilt (js/lit.js shares its joystick as window.litMotion): nearer layers shift more
  function tiltSnow() {
    const m = window.litMotion, on = m && m.active;
    for (const l of snowLayers) {
      const t = on ? `translate(${(m.x * l.tilt).toFixed(1)}px, ${(m.y * l.tilt * 0.7).toFixed(1)}px)` : "";
      if (t !== l.key) { l.key = t; l.el.style.transform = t; }
    }
  }

  // leaves: a few shapes, drawn once per colour
  const LEAF_COLOURS = ["#d8402a", "#ec5a22", "#f47a24", "#f6a12e", "#c4471f", "#e2662a"];
  const SHAPES = {
    maple(c) {   // five lobes
      c.beginPath();
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const lobe = i % 2 === 0 ? 1 : 0.48;
        const squash = i === 5 ? 0.3 : 1;            // the notch for the stem
        pts.push([Math.cos(a) * 30 * lobe * squash, Math.sin(a) * 30 * lobe * squash]);
      }
      c.moveTo(...pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1], [x, y] = pts[i];
        c.quadraticCurveTo((px + x) / 2 * 1.15, (py + y) / 2 * 1.15, x, y);
      }
      c.closePath();
    },
    oval(c) {
      c.beginPath();
      c.moveTo(0, -32);
      c.bezierCurveTo(22, -18, 22, 18, 0, 30);
      c.bezierCurveTo(-22, 18, -22, -18, 0, -32);
      c.closePath();
    },
    birch(c) {   // pointed, a little lopsided
      c.beginPath();
      c.moveTo(0, -30);
      c.bezierCurveTo(16, -14, 20, 10, 2, 28);
      c.bezierCurveTo(-18, 12, -18, -12, 0, -30);
      c.closePath();
    },
  };
  const sprites = [];
  for (const shape of Object.values(SHAPES)) for (const col of LEAF_COLOURS) {
    const s = document.createElement("canvas");
    s.width = s.height = 72;
    const c = s.getContext("2d");
    c.translate(36, 36);
    shape(c);
    const g = c.createLinearGradient(-30, -30, 30, 30);
    g.addColorStop(0, col);
    g.addColorStop(1, "#7a2a10");
    c.fillStyle = col;
    c.fill();
    c.globalAlpha = 0.45;
    c.fillStyle = g;
    c.fill();
    c.globalAlpha = 0.5;                       // midrib and stem
    c.strokeStyle = "#4a1708";
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(0, -24); c.lineTo(0, 34); c.stroke();
    sprites.push(s);
  }
  let leaves = [], nextGust = 0;
  function gust(now) {
    const dir = Math.random() < 0.5 ? 1 : -1, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const z = rand(0.45, 1);
      leaves.push({
        delay: now + rand(0, 1600),
        x: dir > 0 ? -60 : W + 60, y: rand(H * 0.05, H * 0.65),
        vx: dir * rand(70, 150) * (0.6 + 0.6 * z), vy: rand(12, 40),
        size: rand(16, 30) * (0.7 + 0.5 * z), z,
        spin: rand(-2.2, 2.2), rot: rand(0, 6.3),
        flip: rand(0, 6.3), flipSpeed: rand(1.5, 4),
        flutter: rand(14, 40), freq: rand(0.8, 1.8), phase: rand(0, 7),
        sprite: pick(sprites),
      });
    }
    nextGust = now + rand(8000, 25000);
  }

  // phone tilt (js/lit.js shares its joystick as window.litMotion): nearer things shift more
  const tiltShift = z => {
    const m = window.litMotion;
    return m && m.active ? [m.x * 14 * z, m.y * 10 * z] : [0, 0];
  };

  function draw(time) {
    const dt = Math.min(0.05, Math.max(0, (time - (last || time)) / 1000));
    last = time;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== W || h !== H) {
      W = w; H = h;
      canvas.width = Math.max(1, Math.round(W * SCALE));
      canvas.height = Math.max(1, Math.round(H * SCALE));
    }
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (drawn) ctx.clearRect(0, 0, W, H);           // nothing to clear between gusts
    drawn = false;
    const t = time / 1000;
    if (state.season === "fall" && !reduceMotion) {
      if (!nextGust) nextGust = time + rand(1500, 5000);   // the first one fairly soon
      if (time > nextGust) gust(time);
      leaves = leaves.filter(l => l.x > -120 && l.x < W + 120 && l.y < H + 120);
      for (const l of leaves) {
        if (time < l.delay) continue;
        l.x += l.vx * dt;
        l.y += (l.vy + Math.sin(t * l.freq * 6.28 + l.phase) * l.flutter) * dt;
        l.rot += l.spin * dt;
        l.flip += l.flipSpeed * dt;
        const [sx, sy] = tiltShift(l.z);
        const turn = Math.cos(l.flip);              // 3D flip: thin when edge-on
        ctx.save();
        ctx.globalAlpha = 0.75 + 0.25 * l.z;
        ctx.translate(l.x + sx, l.y + sy);
        ctx.rotate(l.rot);
        ctx.scale(Math.max(0.12, Math.abs(turn)), 1);
        ctx.filter = turn < 0 ? "brightness(.7)" : "none";   // the back is darker
        const s = l.size;
        ctx.drawImage(l.sprite, -s, -s, s * 2, s * 2);
        ctx.restore();
        drawn = true;
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(time) {
    placeHat();
    if (state.season === "fall") draw(time);
    if (state.season === "winter") tiltSnow();
    requestAnimationFrame(frame);
  }

  function set(opts) {
    Object.assign(state, opts);
    hatKey = "";
    canvas.style.display = state.season === "fall" ? "block" : "none";
    snow.style.display = state.season === "winter" ? "block" : "none";
    if (state.season === "winter") makeSnow();
    if (state.season === "fall") { leaves = []; nextGust = 0; }
    if (state.season !== "fall") { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; }
  }
  window.seasons = { state, set };

  function start() {
    frameEl = document.querySelector(".avatar-frame");
    const bg = document.querySelector(".--site-bg");
    if (bg) bg.append(snow, canvas);
    // only once the background is showing: never snow over a blank screen
    Promise.resolve(window.bgReady).then(() => { snow.style.opacity = canvas.style.opacity = "1"; });
    document.head.append(snowStyle);
    document.body.append(hat);
    set({});
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
