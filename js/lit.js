// Live-lit avatar ring and rune border (experimental; the page loads this only with ?lit).
//
// A WebGL2 canvas over the page draws the ring and the card's rune border from packed
// masks (images/lit/*.png: R runes, G carved lines, A shape; see scripts/make_lit_maps.py)
// and lights them per pixel: height from the masks plus stone grain, normals from the
// height, diffuse + specular from a list of lights. The static images stay underneath as
// the fallback and are only hidden once this has started.
//
// Lights: by default a 4 x 3 grid of lights taken from the background video (see
// sampleScene); or one point light that follows the pointer, or orbits.
(() => {
  "use strict";
  const MAX_LIGHTS = 16;
  const BORDER = { src: "images/lit/border.png", size: 944, slice: 104, tile: 736 };
  const RING = { src: "images/lit/ring.png" };

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
    height: 320,               // light height above the page, CSS px
    strength: 1.0,
    fill: 1.0,                 // even light (ambient) multiplier
    bump: 1.6,
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10";
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  if (!gl) return;   // static version stays

  const VERT = `#version 300 es
  uniform vec4 uRect;      // x, y, w, h in device px (top-left origin)
  uniform vec2 uCanvas;    // canvas size, device px
  out vec2 vLocal;         // position inside the rect, device px
  void main() {
    vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1);
    vLocal = c * uRect.zw;
    vec2 p = uRect.xy + vLocal;
    gl_Position = vec4(p / uCanvas * 2.0 - 1.0, 0.0, 1.0) * vec4(1, -1, 1, 1);
  }`;

  const FRAG = `#version 300 es
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
      float ndl = max(dot(n, L), 0.0);
      float wrap = max((dot(n, L) + 0.45) / 1.45, 0.0);   // diffuse wraps a little past the shadow line
      vec3 h = normalize(L + v);
      float spec = pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 40.0;
      col += uLightCol[i] * (diffCol * wrap + specCol * spec * ndl);
    }
    col = col / (1.0 + col * 0.45);      // soft tone curve so highlights don't clip hard
    outColor = vec4(col * m.a, m.a);
  }`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn("lit.js: shader failed, keeping the static version", e);
    return;
  }
  gl.useProgram(prog);
  const U = new Proxy({}, { get: (c, k) => c[k] ?? (c[k] = gl.getUniformLocation(prog, k)) });
  gl.bindVertexArray(gl.createVertexArray());
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function loadTexture(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        resolve(t);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---- lights -------------------------------------------------------------------------
  const pointer = { x: innerWidth * 0.3, y: innerHeight * 0.2, seen: false };
  addEventListener("pointermove", e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true; }, { passive: true });
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const AMBIENT = [0.35, 0.36, 0.42];
  const ENV = [0.62, 0.64, 0.70];

  // ---- video-driven lights --------------------------------------------------------------
  // The background video (or its poster on phones, where it doesn't play) is shrunk to a
  // GRID_X x GRID_Y grid ~10 times a second. Each cell becomes a coloured light placed over
  // that part of the screen; the frame's average colour becomes the fill light and what the
  // metal reflects. Values are eased over time so the lighting doesn't flicker.
  const GRID_X = 4, GRID_Y = 3;
  const video = document.querySelector(".bg-video");
  const poster = new Image();
  if (video && video.poster) poster.src = video.poster;
  const sampler = document.createElement("canvas");
  sampler.width = GRID_X * 4; sampler.height = GRID_Y * 4;
  const sctx = sampler.getContext("2d", { willReadFrequently: true });
  const scene = {                       // eased values used for drawing
    cells: Array.from({ length: GRID_X * GRID_Y }, () => [0.6, 0.6, 0.65]),
    ambient: AMBIENT.slice(),
    env: ENV.slice(),
  };
  const target = { cells: scene.cells.map(c => c.slice()), ambient: AMBIENT.slice(), env: ENV.slice() };
  let lastSample = -1e9;

  function sampleScene(time) {
    if (time - lastSample < 100) return;
    lastSample = time;
    const playing = video && video.readyState >= 2 && video.currentSrc;
    const source = playing ? video : poster.complete && poster.naturalWidth ? poster : null;
    if (!source) return;
    try {
      sctx.drawImage(source, 0, 0, sampler.width, sampler.height);
      const px = sctx.getImageData(0, 0, sampler.width, sampler.height).data;
      const sum = [0, 0, 0];
      for (let gy = 0; gy < GRID_Y; gy++) for (let gx = 0; gx < GRID_X; gx++) {
        const c = [0, 0, 0];
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const i = ((gy * 4 + y) * sampler.width + gx * 4 + x) * 4;
          for (let k = 0; k < 3; k++) c[k] += px[i + k] / 255 / 16;
        }
        target.cells[gy * GRID_X + gx] = c;
        for (let k = 0; k < 3; k++) sum[k] += c[k] / (GRID_X * GRID_Y);
      }
      target.ambient = sum.map((c, k) => 0.22 + c * 0.55 + AMBIENT[k] * 0.1);
      target.env = sum.map(c => 0.35 + c * 0.75);
    } catch (e) { /* frame not ready */ }
  }

  function ease(cur, tgt, a) { for (let k = 0; k < cur.length; k++) cur[k] += (tgt[k] - cur[k]) * a; }
  function easeScene() {
    scene.cells.forEach((c, i) => ease(c, target.cells[i], 0.08));
    ease(scene.ambient, target.ambient, 0.08);
    ease(scene.env, target.env, 0.08);
  }

  // Returns [{pos:[x,y,z] CSS px, col:[r,g,b]}].
  function lights(time) {
    if (settings.light === "video") {
      sampleScene(time);
      easeScene();
      const k = settings.strength * 3.2 / (GRID_X * GRID_Y);
      return scene.cells.map((c, i) => {
        const gx = i % GRID_X, gy = Math.floor(i / GRID_X);
        // brighter parts of the scene count for more (sky vs trees), so square the colour
        return {
          pos: [(gx + 0.5) / GRID_X * innerWidth, (gy + 0.5) / GRID_Y * innerHeight, settings.height],
          col: c.map(v => v * v * k * 3),
        };
      });
    }
    ease(scene.ambient, AMBIENT, 0.08);
    ease(scene.env, ENV, 0.08);
    let x = pointer.x, y = pointer.y;
    if (settings.light === "orbit" && !reduceMotion) {
      const a = time / 4000;
      x = innerWidth / 2 + Math.cos(a) * innerWidth * 0.35;
      y = innerHeight / 2 + Math.sin(a) * innerHeight * 0.35;
    }
    const k = settings.strength;
    return [{ pos: [x, y, settings.height], col: [1.15 * k, 1.1 * k, 1.0 * k] }];
  }

  // ---- drawing --------------------------------------------------------------------------
  let texBorder, texRing;
  const card = document.querySelector(".--site-main .--container-component.--instance-container02");
  const ring = document.querySelector(".avatar-frame");

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

  // ---- small control panel ---------------------------------------------------------------
  function panel() {
    const p = document.createElement("div");
    p.className = "lit-panel";
    const select = (label, value, options, set) => {
      const id = "lit-" + label.replace(/\W+/g, "-").toLowerCase();
      return `<label for="${id}">${label}</label><select id="${id}" data-set="${set}">` +
        options.map(o => `<option${o === value ? " selected" : ""}>${o}</option>`).join("") + "</select>";
    };
    p.innerHTML =
      `<strong>Live lighting</strong>` +
      select("Light", settings.light, ["video", "pointer", "orbit"], "light") +
      `<label for="lit-height">Height</label><input id="lit-height" type="range" min="60" max="800" value="${settings.height}" data-set="height">` +
      `<label for="lit-strength">Strength</label><input id="lit-strength" type="range" min="0.2" max="2.5" step="0.05" value="${settings.strength}" data-set="strength">` +
      `<label for="lit-fill">Fill</label><input id="lit-fill" type="range" min="0" max="2.5" step="0.05" value="${settings.fill}" data-set="fill">` +
      `<label for="lit-bump">Depth</label><input id="lit-bump" type="range" min="0" max="6" step="0.1" value="${settings.bump}" data-set="bump">` +
      select("Ring metal", settings.ring.metal, Object.keys(METALS), "ring.metal") +
      select("Ring stone", settings.ring.stone, Object.keys(STONES), "ring.stone") +
      select("Border metal", settings.border.metal, Object.keys(METALS), "border.metal") +
      select("Border stone", settings.border.stone, Object.keys(STONES), "border.stone") +
      `<a href="${location.pathname}">Static version</a>`;
    p.addEventListener("input", e => {
      const key = e.target.dataset.set;
      if (!key) return;
      const value = e.target.type === "range" ? parseFloat(e.target.value) : e.target.value;
      const [a, b] = key.split(".");
      if (b) settings[a][b] = value; else settings[a] = value;
    });
    const style = document.createElement("style");
    style.textContent = `
      .lit-panel { position: fixed; left: 12px; bottom: 12px; z-index: 20; display: grid;
        grid-template-columns: auto auto; gap: 4px 10px; align-items: center; padding: 10px 12px;
        font: 12px/1.3 system-ui, sans-serif; color: #e6e6ea; background: rgba(20, 21, 27, .85);
        border-radius: 8px; max-width: calc(100vw - 24px) }
      .lit-panel strong { grid-column: 1 / -1 }
      .lit-panel a { grid-column: 1 / -1; color: #9ab4ff }
      .lit-panel select, .lit-panel input { font: inherit; max-width: 130px }
      html.lit .avatar-ring { visibility: hidden }
      html.lit .--site-main .--container-component.--instance-container02 { border-image: none !important }`;
    document.head.append(style);
    document.body.append(p);
  }

  Promise.all([loadTexture(BORDER.src), loadTexture(RING.src)]).then(([b, r]) => {
    texBorder = b; texRing = r;
    document.body.append(canvas);
    panel();
    document.documentElement.classList.add("lit");   // hide the static ring and border
    requestAnimationFrame(frame);
  }).catch(e => console.warn("lit.js: textures failed, keeping the static version", e));
})();
