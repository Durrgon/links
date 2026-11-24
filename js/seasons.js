// Seasonal touches, on every route (js/router.js loads it):
//   winter: soft, blurry snow drifting slowly behind the card;
//   fall:   now and then a few red/orange leaves blow across behind the card;
//   hat:    a Santa hat on the avatar, on by itself in December.
// Winter is on by default for now; the lighting panel (js/lit.js, "Season" and
// "Santa hat") switches them, and so do the flags #fall, #nosnow, #hat and #nohat.
// window.seasons.set({ season, hat }) changes them; window.seasons.state reads them.
// Snow and leaves are drawn on one canvas inside the background layer (.--site-bg), so
// they sit behind the card; with reduced motion, snow is a still scatter and leaves are off.
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
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3";
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, last = 0;
  const SCALE = 0.5;               // drawn at half resolution: cheaper, and softer anyway

  // a soft round flake, drawn once and stamped
  const flake = document.createElement("canvas");
  flake.width = flake.height = 64;
  {
    const f = flake.getContext("2d"), g = f.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    f.fillStyle = g;
    f.fillRect(0, 0, 64, 64);
  }
  let flakes = [];
  function makeFlake(anywhere) {
    const z = Math.pow(Math.random(), 1.6);        // more far flakes than near ones
    return {
      z, x: rand(0, W), y: anywhere ? rand(0, H) : rand(-40, -10),
      r: 3 + 13 * z,                               // radius of the soft stamp, CSS px
      speed: 10 + 32 * z,                          // px/s down
      sway: rand(6, 22) * (0.4 + z), freq: rand(0.15, 0.45), phase: rand(0, 7),
      alpha: 0.32 + 0.6 * z,
    };
  }
  function fillSnow() {
    const want = Math.round(Math.min(320, W * H / 4200));
    while (flakes.length < want) flakes.push(makeFlake(true));
    flakes.length = want;
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
      if (state.season === "winter") fillSnow();
    }
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = time / 1000;
    if (state.season === "winter") {
      for (const f of flakes) {
        if (!reduceMotion) {
          f.y += f.speed * dt;
          if (f.y - f.r > H) Object.assign(f, makeFlake(false));
        }
        const [sx, sy] = tiltShift(f.z);
        const x = f.x + Math.sin(t * f.freq * 6.28 + f.phase) * f.sway + sx;
        ctx.globalAlpha = f.alpha;
        ctx.drawImage(flake, x - f.r, f.y + sy - f.r, f.r * 2, f.r * 2);
      }
    } else if (state.season === "fall" && !reduceMotion) {
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
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(time) {
    placeHat();
    if (state.season !== "none") draw(time);
    requestAnimationFrame(frame);
  }

  function set(opts) {
    Object.assign(state, opts);
    hatKey = "";
    canvas.style.display = state.season === "none" ? "none" : "block";
    if (state.season === "winter") { flakes = []; W = H = 0; }
    if (state.season === "fall") { leaves = []; nextGust = 0; }
    if (state.season === "none") ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  window.seasons = { state, set };

  function start() {
    frameEl = document.querySelector(".avatar-frame");
    const bg = document.querySelector(".--site-bg");
    if (bg) bg.append(canvas);
    document.body.append(hat);
    set({});
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
