// Live-lit avatar ring and rune border (experimental; the page loads this only with ?lit).
//
// A WebGL2 canvas over the page draws the ring and the card's rune border from packed
// masks (images/lit/*.png: R runes, G carved lines, A shape; see scripts/make_lit_maps.py)
// and lights them per pixel: height from the masks plus stone grain, normals from the
// height, diffuse + specular from a list of lights (point lights or spotlights). The static
// images stay underneath as the fallback and are only hidden once this has started.
//
// Lights ("video" mode): key lights are the two brightest, well-separated spots of the
// background video, as spotlights aimed at one point (the card's centre, or Shift+click);
// a 4 x 3 grid of softer fill lights comes from the rest of the frame. Alt+click pins a
// key light's source. "Guides" draws their lines. Night mode keys the sky out of the
// video (images/lit/sky-mask.png; the camera doesn't move), replaces it with a night sky
// and a moon, darkens the scene, and makes the moon the key light.
(() => {
  "use strict";
  const MAX_LIGHTS = 16;
  const BORDER = { src: "images/lit/border.png", size: 944, slice: 104, tile: 736 };
  const RING = { src: "images/lit/ring.png" };
  const SKY_MASK = "images/lit/sky-mask.png";

  // Colours in sRGB 0..1
  const STONES = {
    slate: [[0.35, 0.37, 0.40], [0.60, 0.62, 0.66]],
    blackslate: [[0.05, 0.055, 0.065], [0.16, 0.17, 0.19]],
  };
  const METALS = {
    gold: [1.0, 0.80, 0.45],
    silver: [0.92, 0.92, 0.94],
    red: [0.62, 0.10, 0.08],
  };
  const settings = {
    ring: { stone: "slate", metal: "gold" },
    border: { stone: "blackslate", metal: "silver" },
    light: "video",            // video | pointer | orbit
    scene: "day",              // day | night (video mode)
    guides: false,
    height: 320,               // light height above the page, CSS px
    strength: 1.0,
    key: 1.0,                  // key lights vs fill lights
    fill: 1.0,                 // even light (ambient) multiplier
    bump: 1.6,
  };
  const aim = { x: null, y: null };          // null = the card's centre
  const pinned = { x: null, y: null };       // null = brightest spot of the video

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const video = document.querySelector(".bg-video");
  const card = document.querySelector(".--site-main .--container-component.--instance-container02");
  const ring = document.querySelector(".avatar-frame");

  // =====================================================================================
  // Shared WebGL helpers
  // =====================================================================================
  const QUAD_VERT = `#version 300 es
  uniform vec4 uRect;      // x, y, w, h in device px (top-left origin)
  uniform vec2 uCanvas;    // canvas size, device px
  out vec2 vLocal;         // position inside the rect, device px
  void main() {
    vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1);
    vLocal = c * uRect.zw;
    vec2 p = uRect.xy + vLocal;
    gl_Position = vec4(p / uCanvas * 2.0 - 1.0, 0.0, 1.0) * vec4(1, -1, 1, 1);
  }`;

  function program(gl, vert, frag) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    gl.bindVertexArray(gl.createVertexArray());
    return new Proxy({}, { get: (c, k) => c[k] ?? (c[k] = gl.getUniformLocation(p, k)) });
  }

  function newTexture(gl, source, filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // Where the background video is on screen (CSS px). It keeps its aspect and covers the width.
  function videoRect() {
    const r = video && video.getBoundingClientRect();
    return r && r.width ? r : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  const uvToScreen = (u, v) => {
    const r = videoRect();
    return [r.left + u * r.width, r.top + v * r.height];
  };

  // =====================================================================================
  // Frame canvas: ring and rune border
  // =====================================================================================
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10";
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  if (!gl) return;   // static version stays

  const FRAME_FRAG = `#version 300 es
  precision highp float;
  in vec2 vLocal;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform int uMode;              // 0 = border (9-slice), 1 = ring (whole texture)
  uniform vec4 uRect;             // device px
  uniform float uBW;              // border width, device px
  uniform float uSlice;           // slice as a fraction of the texture
  uniform float uTileRatio;       // tile length / slice (source)
  uniform float uDpr;
  uniform float uBump;
  uniform vec3 uStoneDark, uStoneLight, uMetal;
  uniform float uMetalRough;
  uniform int uLightCount;
  uniform vec3 uLightPos[${MAX_LIGHTS}];   // device px, z = height
  uniform vec3 uLightCol[${MAX_LIGHTS}];
  uniform vec3 uLightDir[${MAX_LIGHTS}];   // spotlights: unit direction (light -> aim)
  uniform vec2 uLightCone[${MAX_LIGHTS}];  // spotlights: cos(outer), cos(inner); x < -1 = point light
  uniform vec3 uAmbient;
  uniform vec3 uEnv;               // what the metal reflects

  // One axis of CSS border-image (round): returns source coord and its derivative per px.
  vec2 mapAxis(float x, float W) {
    float s = uSlice, bw = uBW;
    if (x < bw) return vec2(x / bw * s, s / bw);
    if (x > W - bw) return vec2(1.0 - s + (x - (W - bw)) / bw * s, s / bw);
    float inner = W - 2.0 * bw;
    float n = max(1.0, floor(inner / (bw * uTileRatio) + 0.5));
    float t = fract((x - bw) / inner * n);
    return vec2(s + t * (1.0 - 2.0 * s), n * (1.0 - 2.0 * s) / inner);
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float grain(vec2 screen) {            // stone grain in CSS px, so it stays seamless
    vec2 p = screen / uDpr * 0.55;
    return 0.55 * noise(p) + 0.3 * noise(p * 2.3) + 0.15 * noise(p * 5.1);
  }

  void main() {
    vec2 uv, du, dv;
    if (uMode == 0) {
      vec2 mx = mapAxis(vLocal.x, uRect.z), my = mapAxis(vLocal.y, uRect.w);
      bool midX = vLocal.x > uBW && vLocal.x < uRect.z - uBW;
      bool midY = vLocal.y > uBW && vLocal.y < uRect.w - uBW;
      if (midX && midY) discard;
      uv = vec2(mx.x, my.x); du = vec2(mx.y, 0.0); dv = vec2(0.0, my.y);
    } else {
      uv = vLocal / uRect.zw; du = vec2(1.0 / uRect.z, 0.0); dv = vec2(0.0, 1.0 / uRect.w);
    }
    vec4 m = texture(uTex, uv);
    if (m.a < 0.004) discard;
    vec2 screen = uRect.xy + vLocal;

    // Height: runes raised, grooves sunk, a little grain; normals from neighbouring samples.
    float g0 = grain(screen);
    float h0 = m.r - 0.7 * m.g + 0.12 * g0;
    vec4 mx1 = texture(uTex, uv + du), my1 = texture(uTex, uv + dv);
    float hx = mx1.r - 0.7 * mx1.g + 0.12 * grain(screen + vec2(1, 0));
    float hy = my1.r - 0.7 * my1.g + 0.12 * grain(screen + vec2(0, 1));
    vec3 n = normalize(vec3(-(hx - h0) * uBump * uDpr, -(hy - h0) * uBump * uDpr, 1.0));

    float metal = smoothstep(0.2, 0.8, m.r);
    float groove = m.g * (1.0 - metal);
    vec3 stone = mix(uStoneDark, uStoneLight, smoothstep(0.25, 0.75, g0));
    vec3 base = mix(stone, uStoneDark * 0.35, groove);
    float rough = mix(0.8, uMetalRough, metal);
    vec3 diffCol = base * (1.0 - metal);
    vec3 specCol = mix(vec3(0.04), uMetal, metal);
    float shin = mix(6.0, 90.0, 1.0 - rough);

    vec3 pos = vec3(screen, h0 * 6.0 * uDpr);
    vec3 v = vec3(0.0, 0.0, 1.0);
    // Fill light, plus a stand-in for the sky the metal reflects (Blender used an HDRI):
    // bright where the surface faces the viewer, a little darker on the bevels.
    vec3 col = uAmbient * diffCol + uEnv * specCol * mix(0.45, 1.0, pow(n.z, 4.0));
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 L = uLightPos[i] - pos;
      float dist = length(L);
      L /= dist;
      float spot = uLightCone[i].x < -1.0 ? 1.0
                 : smoothstep(uLightCone[i].x, uLightCone[i].y, dot(-L, uLightDir[i]));
      if (spot <= 0.0) continue;
      float ndl = max(dot(n, L), 0.0);
      float wrap = max((dot(n, L) + 0.45) / 1.45, 0.0);   // diffuse wraps a little past the shadow line
      vec3 h = normalize(L + v);
      float spec = pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 40.0;
      col += spot * uLightCol[i] * (diffCol * wrap + specCol * spec * ndl);
    }
    col = col / (1.0 + col * 0.45);      // soft tone curve so highlights don't clip hard
    outColor = vec4(col * m.a, m.a);
  }`;

  let U;
  try {
    U = program(gl, QUAD_VERT, FRAME_FRAG);
  } catch (e) {
    console.warn("lit.js: shader failed, keeping the static version", e);
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // =====================================================================================
  // Night background: the video with its sky keyed out (separate canvas behind the card)
  // =====================================================================================
  const bg = document.createElement("canvas");
  bg.setAttribute("aria-hidden", "true");
  bg.style.cssText = "position:fixed;pointer-events:none;z-index:0;display:none";
  const bgl = bg.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
  let BU = null, bgVideoTex = null, bgMaskTex = null, bgPosterUploaded = false;
  const moon = { u: 0.62, v: 0.08 };        // replaced from the sky mask once it loads

  const NIGHT_FRAG = `#version 300 es
  precision highp float;
  in vec2 vLocal;
  out vec4 outColor;
  uniform vec4 uRect;
  uniform sampler2D uVideo, uMask;
  uniform vec2 uMoon;            // uv
  uniform float uTime, uAspect;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 uv = vLocal / uRect.zw;
    vec3 day = texture(uVideo, uv).rgb;
    float sky = texture(uMask, uv).r;
    // ground: darker, bluer, the bright snow kept a little brighter (moonlit)
    float lum = dot(day, vec3(0.299, 0.587, 0.114));
    vec3 ground = mix(vec3(lum), day, 0.3) * vec3(0.30, 0.38, 0.62) * (0.35 + 0.5 * lum * lum);
    // sky: dark gradient, stars, moon with a glow
    vec3 night = mix(vec3(0.015, 0.02, 0.05), vec3(0.06, 0.09, 0.18), smoothstep(0.0, 0.55, uv.y));
    vec2 grid = uv * vec2(220.0, 220.0 / uAspect);
    vec2 cell = floor(grid);
    float h = hash(cell);
    float star = step(0.985, h) * smoothstep(0.35, 0.0, length(fract(grid) - 0.5))
               * (0.6 + 0.4 * sin(uTime * 0.002 + h * 60.0));
    night += vec3(star);
    vec2 d = (uv - uMoon) * vec2(uAspect, 1.0);
    float r = length(d);
    float disc = smoothstep(0.028, 0.025, r);
    vec3 moonCol = vec3(0.96, 0.95, 0.88) * (0.85 + 0.15 * smoothstep(0.03, 0.0, length(d - vec2(-0.006, -0.004))));
    float glow = exp(-r * 18.0) * 0.35;
    night = mix(night, moonCol, disc) + vec3(0.55, 0.62, 0.8) * glow;
    vec3 col = mix(ground + vec3(0.35, 0.4, 0.55) * glow * 0.4, night, sky);
    outColor = vec4(col, 1.0);
  }`;

  function initNight(maskImg) {
    if (!bgl) return;
    try {
      BU = program(bgl, QUAD_VERT, NIGHT_FRAG);
    } catch (e) {
      console.warn("lit.js: night shader failed", e);
      return;
    }
    bgMaskTex = newTexture(bgl, maskImg);
    bgVideoTex = newTexture(bgl, null);
    // moon: near the top of the sky, centred on its upper part
    const c = document.createElement("canvas");
    c.width = maskImg.width; c.height = maskImg.height;
    const x = c.getContext("2d");
    x.drawImage(maskImg, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let top = c.height;
    for (let i = 0; i < c.width * c.height; i++) if (d[i * 4] > 230) { top = Math.min(top, Math.floor(i / c.width)); }
    let sx = 0, n = 0;
    for (let y = top; y < Math.min(c.height, top + c.height * 0.12); y++)
      for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4] > 230) { sx += xx; n++; }
    if (n) { moon.u = sx / n / c.width + 0.04; moon.v = top / c.height + 0.09; }
    video.parentElement.append(bg);
  }

  function drawNight(time) {
    const on = settings.light === "video" && settings.scene === "night" && BU;
    bg.style.display = on ? "block" : "none";
    if (!on) return;
    const r = videoRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    Object.assign(bg.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; }
    bgl.viewport(0, 0, w, h);
    bgl.activeTexture(bgl.TEXTURE0);
    bgl.bindTexture(bgl.TEXTURE_2D, bgVideoTex);
    const playing = video.readyState >= 2 && video.currentSrc;
    if (playing) {
      bgl.texImage2D(bgl.TEXTURE_2D, 0, bgl.RGBA, bgl.RGBA, bgl.UNSIGNED_BYTE, video);
    } else if (!bgPosterUploaded && poster.complete && poster.naturalWidth) {
      bgl.texImage2D(bgl.TEXTURE_2D, 0, bgl.RGBA, bgl.RGBA, bgl.UNSIGNED_BYTE, poster);
      bgPosterUploaded = true;
    }
    bgl.activeTexture(bgl.TEXTURE1);
    bgl.bindTexture(bgl.TEXTURE_2D, bgMaskTex);
    bgl.uniform1i(BU.uVideo, 0);
    bgl.uniform1i(BU.uMask, 1);
    bgl.uniform4f(BU.uRect, 0, 0, w, h);
    bgl.uniform2f(BU.uCanvas, w, h);
    bgl.uniform2f(BU.uMoon, moon.u, moon.v);
    bgl.uniform1f(BU.uTime, time);
    bgl.uniform1f(BU.uAspect, r.width / r.height);
    bgl.drawArrays(bgl.TRIANGLE_STRIP, 0, 4);
  }

  // =====================================================================================
  // Lights
  // =====================================================================================
  const pointer = { x: innerWidth * 0.3, y: innerHeight * 0.2 };
  addEventListener("pointermove", e => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

  const AMBIENT = [0.35, 0.36, 0.42];
  const ENV = [0.62, 0.64, 0.70];
  const NIGHT_TINT = [0.30, 0.38, 0.62];
  const MOON_COL = [0.80, 0.88, 1.15];

  // The video (or its poster on phones) shrunk to SX x SY, ~10 times a second.
  const GRID_X = 4, GRID_Y = 3, SX = 32, SY = 18;
  const poster = new Image();
  if (video && video.poster) poster.src = video.poster;
  const sampler = document.createElement("canvas");
  sampler.width = SX; sampler.height = SY;
  const sctx = sampler.getContext("2d", { willReadFrequently: true });
  const blank = () => [0.6, 0.6, 0.65];
  const scene = {                       // eased values used for drawing
    cells: Array.from({ length: GRID_X * GRID_Y }, blank),
    keys: [{ u: 0.2, v: 0.15, col: [1, 1, 1] }, { u: 0.65, v: 0.1, col: [1, 1, 1] }],
    ambient: AMBIENT.slice(),
    env: ENV.slice(),
  };
  const target = JSON.parse(JSON.stringify(scene));
  let lastSample = -1e9;

  function sampleScene(time) {
    if (time - lastSample < 100) return;
    lastSample = time;
    const playing = video && video.readyState >= 2 && video.currentSrc;
    const source = playing ? video : poster.complete && poster.naturalWidth ? poster : null;
    if (!source) return;
    let px;
    try {
      sctx.drawImage(source, 0, 0, SX, SY);
      px = sctx.getImageData(0, 0, SX, SY).data;
    } catch (e) { return; }
    const at = (x, y) => { const i = (y * SX + x) * 4; return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]; };
    // fill grid: average of each cell
    const cw = SX / GRID_X, ch = SY / GRID_Y, sum = [0, 0, 0];
    for (let gy = 0; gy < GRID_Y; gy++) for (let gx = 0; gx < GRID_X; gx++) {
      const c = [0, 0, 0];
      for (let y = gy * ch; y < (gy + 1) * ch; y++) for (let x = gx * cw; x < (gx + 1) * cw; x++) {
        const p = at(x, y);
        for (let k = 0; k < 3; k++) c[k] += p[k] / (cw * ch);
      }
      target.cells[gy * GRID_X + gx] = c;
      for (let k = 0; k < 3; k++) sum[k] += c[k] / (GRID_X * GRID_Y);
    }
    target.ambient = sum.map((c, k) => 0.22 + c * 0.55 + AMBIENT[k] * 0.1);
    target.env = sum.map(c => 0.35 + c * 0.75);
    // key lights: the two brightest spots (upper part of the frame counts more), at least
    // a third of the frame apart
    const spots = [];
    for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const p = at(x, y);
      const lum = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      spots.push({ u: (x + 0.5) / SX, v: (y + 0.5) / SY, col: p, score: lum * (1.15 - 0.7 * y / SY) });
    }
    spots.sort((a, b) => b.score - a.score);
    const keys = [spots[0]];
    for (const s of spots) if (Math.hypot(s.u - keys[0].u, (s.v - keys[0].v) * 0.56) > 0.33) { keys.push(s); break; }
    keys.forEach((k, i) => { if (target.keys[i]) Object.assign(target.keys[i], { u: k.u, v: k.v, col: k.col }); });
  }

  function ease(cur, tgt, a) { for (let k = 0; k < cur.length; k++) cur[k] += (tgt[k] - cur[k]) * a; }
  function easeScene() {
    scene.cells.forEach((c, i) => ease(c, target.cells[i], 0.08));
    scene.keys.forEach((k, i) => {
      const t = target.keys[i];
      k.u += (t.u - k.u) * 0.04; k.v += (t.v - k.v) * 0.04;
      ease(k.col, t.col, 0.08);
    });
    ease(scene.ambient, target.ambient, 0.08);
    ease(scene.env, target.env, 0.08);
  }

  function aimPoint() {
    if (aim.x !== null) return [aim.x, aim.y];
    const r = card ? card.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  // A spotlight from (x, y, height) aimed at the aim point on the page.
  function spot(x, y, col) {
    const [ax, ay] = aimPoint();
    const d = [ax - x, ay - y, -settings.height];
    const len = Math.hypot(...d);
    return { pos: [x, y, settings.height], col, dir: d.map(c => c / len),
             cone: [Math.cos(50 * Math.PI / 180), Math.cos(22 * Math.PI / 180)] };
  }

  // Returns [{pos:[x,y,z] CSS px, col:[r,g,b], dir?, cone?}] and sets the fill/env.
  const keySources = [];      // screen positions of the key lights, for the guides
  function lights(time) {
    keySources.length = 0;
    if (settings.light === "video") {
      sampleScene(time);
      easeScene();
      const night = settings.scene === "night";
      const fillK = settings.strength * 1.6 / (GRID_X * GRID_Y);
      const out = scene.cells.map((c, i) => {
        const gx = i % GRID_X, gy = Math.floor(i / GRID_X);
        const [x, y] = uvToScreen((gx + 0.5) / GRID_X, (gy + 0.5) / GRID_Y);
        const col = night ? c.map((v, k) => v * v * NIGHT_TINT[k] * 0.35) : c.map(v => v * v);
        return { pos: [x, y, settings.height], col: col.map(v => v * fillK * 3) };
      });
      const keyK = settings.strength * settings.key;
      if (night) {
        const [x, y] = pinned.x !== null ? [pinned.x, pinned.y] : uvToScreen(moon.u, moon.v);
        keySources.push([x, y]);
        out.push(spot(x, y, MOON_COL.map(v => v * keyK * 1.1)));
        scene.ambient = [0.07, 0.09, 0.16];
        scene.env = [0.18, 0.22, 0.34];
      } else {
        scene.keys.forEach((k, i) => {
          const [x, y] = i === 0 && pinned.x !== null ? [pinned.x, pinned.y] : uvToScreen(k.u, k.v);
          keySources.push([x, y]);
          const lum = 0.299 * k.col[0] + 0.587 * k.col[1] + 0.114 * k.col[2];
          out.push(spot(x, y, k.col.map(v => (0.5 * v + 0.5 * lum) * keyK * (i ? 0.8 : 1.1))));
        });
      }
      return out;
    }
    ease(scene.ambient, AMBIENT, 0.08);
    ease(scene.env, ENV, 0.08);
    let x = pointer.x, y = pointer.y;
    if (settings.light === "orbit" && !reduceMotion) {
      const a = time / 4000;
      x = innerWidth / 2 + Math.cos(a) * innerWidth * 0.35;
      y = innerHeight / 2 + Math.sin(a) * innerHeight * 0.35;
    }
    keySources.push([x, y]);
    const k = settings.strength;
    return [{ pos: [x, y, settings.height], col: [1.15 * k, 1.1 * k, 1.0 * k] }];
  }

  // Shift+click aims the key lights; Alt+click pins the (first) key light's source.
  addEventListener("click", e => {
    if (!(e.shiftKey || e.altKey) || e.target.closest(".lit-panel")) return;
    e.preventDefault();
    if (e.shiftKey) { aim.x = e.clientX; aim.y = e.clientY; }
    else { pinned.x = e.clientX; pinned.y = e.clientY; }
  }, true);

  // =====================================================================================
  // Guides: each key light's line from its source through the aim point
  // =====================================================================================
  const NS = "http://www.w3.org/2000/svg";
  const guides = document.createElementNS(NS, "svg");
  guides.setAttribute("aria-hidden", "true");
  guides.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:11;display:none";
  function drawGuides() {
    guides.style.display = settings.guides ? "block" : "none";
    if (!settings.guides) return;
    const [ax, ay] = aimPoint();
    const far = Math.hypot(innerWidth, innerHeight);
    let svg = "";
    for (const [x, y] of keySources) {
      const len = Math.hypot(ax - x, ay - y) || 1;
      const ex = x + (ax - x) / len * far, ey = y + (ay - y) / len * far;
      svg += `<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" stroke="#fff" stroke-width="1" opacity=".7"/>` +
             `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#fff" stroke-width="1.5"/>`;
    }
    svg += `<circle cx="${ax}" cy="${ay}" r="5" fill="none" stroke="#ffd36b" stroke-width="1.5"/>` +
           `<path d="M${ax - 10},${ay}H${ax + 10}M${ax},${ay - 10}V${ay + 10}" stroke="#ffd36b"/>`;
    guides.innerHTML = svg;
  }

  // =====================================================================================
  // Drawing
  // =====================================================================================
  let texBorder, texRing;

  function setMaterial(which) {
    const m = settings[which];
    gl.uniform3fv(U.uStoneDark, STONES[m.stone][0]);
    gl.uniform3fv(U.uStoneLight, STONES[m.stone][1]);
    gl.uniform3fv(U.uMetal, METALS[m.metal]);
    gl.uniform1f(U.uMetalRough, m.metal === "red" ? 0.65 : 0.38);
  }

  function rectOf(el, dpr) {
    const r = el.getBoundingClientRect();
    return [r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr];
  }

  function frame(time) {
    drawNight(time);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uCanvas, w, h);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uBump, settings.bump);
    const ls = lights(time).slice(0, MAX_LIGHTS);
    gl.uniform3fv(U.uAmbient, scene.ambient.map(c => c * settings.fill));
    gl.uniform3fv(U.uEnv, scene.env);
    gl.uniform1i(U.uLightCount, ls.length);
    gl.uniform3fv(U["uLightPos[0]"], ls.flatMap(l => [l.pos[0] * dpr, l.pos[1] * dpr, l.pos[2] * dpr]));
    gl.uniform3fv(U["uLightCol[0]"], ls.flatMap(l => l.col));
    gl.uniform3fv(U["uLightDir[0]"], ls.flatMap(l => l.dir || [0, 0, -1]));
    gl.uniform2fv(U["uLightCone[0]"], ls.flatMap(l => l.cone || [-2, -2]));
    drawGuides();

    if (card && texBorder) {
      const bw = parseFloat(getComputedStyle(card).borderTopWidth) * dpr;
      gl.bindTexture(gl.TEXTURE_2D, texBorder);
      setMaterial("border");
      gl.uniform1i(U.uMode, 0);
      gl.uniform4fv(U.uRect, rectOf(card, dpr));
      gl.uniform1f(U.uBW, bw);
      gl.uniform1f(U.uSlice, BORDER.slice / BORDER.size);
      gl.uniform1f(U.uTileRatio, BORDER.tile / BORDER.slice);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (ring && texRing) {
      gl.bindTexture(gl.TEXTURE_2D, texRing);
      setMaterial("ring");
      gl.uniform1i(U.uMode, 1);
      gl.uniform4fv(U.uRect, rectOf(ring, dpr));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
  }

  // =====================================================================================
  // Control panel
  // =====================================================================================
  function panel() {
    const p = document.createElement("div");
    p.className = "lit-panel";
    const select = (label, value, options, set) => {
      const id = "lit-" + label.replace(/\W+/g, "-").toLowerCase();
      return `<label for="${id}">${label}</label><select id="${id}" data-set="${set}">` +
        options.map(o => `<option${o === value ? " selected" : ""}>${o}</option>`).join("") + "</select>";
    };
    const range = (label, set, min, max, step) => {
      const id = "lit-" + set;
      return `<label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[set]}" data-set="${set}">`;
    };
    p.innerHTML =
      `<strong>Live lighting</strong>` +
      select("Light", settings.light, ["video", "pointer", "orbit"], "light") +
      select("Scene", settings.scene, ["day", "night"], "scene") +
      `<label for="lit-guides">Guides</label><input id="lit-guides" type="checkbox" data-set="guides">` +
      range("Height", "height", 60, 900, 10) +
      range("Strength", "strength", 0.2, 2.5, 0.05) +
      range("Key light", "key", 0, 3, 0.05) +
      range("Fill", "fill", 0, 2.5, 0.05) +
      range("Depth", "bump", 0, 6, 0.1) +
      select("Ring metal", settings.ring.metal, Object.keys(METALS), "ring.metal") +
      select("Ring stone", settings.ring.stone, Object.keys(STONES), "ring.stone") +
      select("Border metal", settings.border.metal, Object.keys(METALS), "border.metal") +
      select("Border stone", settings.border.stone, Object.keys(STONES), "border.stone") +
      `<small>Shift+click: aim · Alt+click: pin light · <button type="button" data-reset>reset</button></small>` +
      `<a href="${location.pathname}">Static version</a>`;
    p.addEventListener("input", e => {
      const key = e.target.dataset.set;
      if (!key) return;
      const value = e.target.type === "range" ? parseFloat(e.target.value)
                  : e.target.type === "checkbox" ? e.target.checked : e.target.value;
      const [a, b] = key.split(".");
      if (b) settings[a][b] = value; else settings[a] = value;
    });
    p.querySelector("[data-reset]").addEventListener("click", () => {
      aim.x = aim.y = pinned.x = pinned.y = null;
    });
    const style = document.createElement("style");
    style.textContent = `
      .lit-panel { position: fixed; left: 12px; bottom: 12px; z-index: 20; display: grid;
        grid-template-columns: auto auto; gap: 4px 10px; align-items: center; padding: 10px 12px;
        font: 12px/1.3 system-ui, sans-serif; color: #e6e6ea; background: rgba(20, 21, 27, .85);
        border-radius: 8px; max-width: calc(100vw - 24px) }
      .lit-panel strong, .lit-panel small, .lit-panel a { grid-column: 1 / -1 }
      .lit-panel small { color: #9a9cab }
      .lit-panel a { color: #9ab4ff }
      .lit-panel select, .lit-panel input, .lit-panel button { font: inherit; max-width: 130px }
      html.lit .avatar-ring { visibility: hidden }
      html.lit .--site-main .--container-component.--instance-container02 { border-image: none !important }`;
    document.head.append(style);
    document.body.append(p);
  }

  Promise.all([loadImage(BORDER.src), loadImage(RING.src)]).then(([b, r]) => {
    texBorder = newTexture(gl, b);
    texRing = newTexture(gl, r);
    document.body.append(canvas, guides);
    panel();
    document.documentElement.classList.add("lit");   // hide the static ring and border
    if (video) loadImage(SKY_MASK).then(initNight).catch(e => console.warn("lit.js: no sky mask, no night mode", e));
    requestAnimationFrame(frame);
  }).catch(e => console.warn("lit.js: textures failed, keeping the static version", e));
})();
