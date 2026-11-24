// Live-lit avatar ring and rune border. js/router.js loads it for the site itself (/links/)
// and the older /lit/ route; /static/ is the plain page.
//
// A WebGL2 canvas over the page draws the ring and the card's rune border from packed
// masks (images/lit/*.png: R runes, G carved lines, A shape; see scripts/make_lit_maps.py)
// and lights them per pixel: height from the masks plus stone grain, normals from the
// height, diffuse + specular from a list of lights (point lights or spotlights). The static
// images stay underneath as the fallback and are only hidden once this has started.
//
// Lights ("video" mode), by default placed in front of the screen as if lighting the card
// from the viewer's side, tilted towards where they are in the scene ("Light from").
// Key lights are the two brightest, well-separated spots of the
// background video, as spotlights aimed at one point (the card's centre, or Shift+click);
// a 4 x 3 grid of softer fill lights comes from the rest of the frame. Alt+click pins a
// key light's source. "Guides" draws their lines. Night mode keys the sky out of the
// video (images/lit/sky-mask.png; the camera doesn't move), replaces it with a night sky
// and a moon, darkens the scene, and makes the moon the key light.
(() => {
  "use strict";
  const MAX_LIGHTS = 20;
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
    border: { stone: "blackslate", metal: "gold" },
    light: "video",            // video | pointer | orbit
    scene: "auto",             // auto (viewer's local time) | day | sunset | night | custom
    hour: 12,                  // custom: hour of the day, 0..24
    guides: false,
    from: "scene",             // viewer: lights sit in front of the screen, tilted towards
                               //   their spot in the scene; scene: right over the spot
    distance: 900,             // viewer mode: how far in front of the screen, CSS px
    spread: 0.6,               // viewer mode: how far the tilt follows the scene spot (0..1)
    height: 320,               // scene mode: light height above the page, CSS px
    strength: 1.0,
    key: 1.0,                  // key lights vs fill lights
    fill: 1.0,                 // even light (ambient) multiplier
    bump: 1.6,
    sparkle: 1.0,              // glints on the metal
    extreme: true,             // big, frequent, bright glints
    goldEdges: true,           // the band's edge lines as raised gold inlay instead of grooves
    cursor: true,              // the mouse is a small light near the frame
    motion: true,              // phones: tilting the phone moves a light and the viewing angle
    tilt: false,               // WASD tilts the card (debugging)
  };
  if (window.route && window.route.flags.has("goldedges")) settings.goldEdges = true;   // #goldedges
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
  // Where the picture is drawn: the video element is object-fit: cover, positioned 50% 0%
  // (css/carrd-canvas.css), so the picture can be larger than the element and cropped.
  // Returns {left, top, width, height} relative to the element's own box.
  function pictureInElement(w, h) {
    const iw = video.videoWidth || poster.naturalWidth || 1920;
    const ih = video.videoHeight || poster.naturalHeight || 1080;
    const scale = Math.max(w / iw, h / ih);
    const pw = iw * scale, ph = ih * scale;
    return { left: (w - pw) * 0.5, top: 0, width: pw, height: ph };
  }
  function videoRect() {             // on screen, CSS px
    const r = video && video.getBoundingClientRect();
    if (!r || !r.width) return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const p = pictureInElement(r.width, r.height);
    return { left: r.left + p.left, top: r.top + p.top, width: p.width, height: p.height };
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
  // sized to the visible window in px every frame (frame()): on phones 100vh is taller than
  // the visible area, which stretched the canvas and drew everything too low
  canvas.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:10;" +
    "opacity:0;transition:opacity 90ms ease-out";   // fades in with the card (css/main.css)
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  const giveUp = () => document.documentElement.classList.remove("lit-pending", "loading");   // static stays
  let revealed = false, pageReady = !window.pageReady;
  if (window.pageReady) window.pageReady.then(() => { pageReady = true; });
  if (!gl) { giveUp(); return; }

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
  uniform float uSparkle;          // strength of the glints on the metal
  uniform vec4 uGlint;             // cell size (CSS px), chance threshold, sharpness, gain
  uniform float uGoldEdges;        // 1: the band's edge lines (texture B) are raised gold
  uniform vec3 uView;              // direction to the viewer, in the card's own frame
  uniform float uTime;

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

  // Height: runes raised, grooves sunk, a little stone grain; with gold edges the edge
  // lines (texture B) are raised like the runes instead.
  float heightOf(vec4 t, float stoneGrain) {
    return t.r - 0.7 * t.g + 1.3 * t.b * uGoldEdges + 0.12 * stoneGrain;
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
    float h0 = heightOf(m, g0);
    vec4 mx1 = texture(uTex, uv + du), my1 = texture(uTex, uv + dv);
    float hx = heightOf(mx1, grain(screen + vec2(1, 0)));
    float hy = heightOf(my1, grain(screen + vec2(0, 1)));
    vec3 n = normalize(vec3(-(hx - h0) * uBump * uDpr, -(hy - h0) * uBump * uDpr, 1.0));

    float metal = smoothstep(0.2, 0.8, max(m.r, m.b * uGoldEdges));
    float groove = m.g * (1.0 - metal);
    vec3 stone = mix(uStoneDark, uStoneLight, smoothstep(0.25, 0.75, g0));
    vec3 base = mix(stone, uStoneDark * 0.35, groove);
    float rough = mix(0.8, uMetalRough, metal);
    vec3 diffCol = base * (1.0 - metal);
    vec3 specCol = mix(vec3(0.04), uMetal, metal);
    float shin = mix(6.0, 90.0, 1.0 - rough);

    vec3 pos = vec3(screen, h0 * 6.0 * uDpr);

    // Glint facets: screen cells of ~2.5 CSS px; about 1 in 6 can sparkle, only on metal.
    vec2 gp = screen / (uGlint.x * uDpr);
    vec2 gcell = floor(gp);
    float gr = hash(gcell);
    float glintCell = 0.0;
    vec3 facet = n;
    if (metal > 0.35 && gr > uGlint.y && uSparkle > 0.0) {
      float point = smoothstep(0.5, 0.0, length(fract(gp) - 0.5));         // a small round point
      float twinkle = 0.8 + 0.2 * sin(uTime * 0.0013 + gr * 90.0);          // very slight
      glintCell = point * twinkle;
      facet = normalize(n + vec3(hash(gcell + 7.1) - 0.5, hash(gcell + 3.7) - 0.5, 0.0) * 0.5);
    }
    vec3 v = uView;
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
      // Glints: a few tiny facets on the metal, each tilted a little at random, flash when a
      // light lines up with them, so they come and go as the lights drift.
      if (glintCell > 0.0) {
        float g = pow(max(dot(facet, h), 0.0), uGlint.z) * glintCell * ndl;
        col += spot * uLightCol[i] * mix(uMetal, vec3(1.0), 0.4) * g * uSparkle * uGlint.w;
      }
    }
    col = col / (1.0 + col * 0.45);      // soft tone curve so highlights don't clip hard
    outColor = vec4(col * m.a, m.a);
  }`;

  let U;
  try {
    U = program(gl, QUAD_VERT, FRAME_FRAG);
  } catch (e) {
    console.warn("lit.js: shader failed, keeping the static version", e);
    giveUp();
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // =====================================================================================
  // Scene background: the video, graded towards golden hour and/or night, with its sky
  // keyed out and replaced (separate canvas behind the card)
  // =====================================================================================
  const bg = document.createElement("canvas");
  bg.setAttribute("aria-hidden", "true");
  bg.style.cssText = "position:absolute;pointer-events:none;z-index:0;display:none";
  const bgl = bg.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
  let BU = null, bgVideoTex = null, bgMaskTex = null, bgPosterUploaded = false;
  const moon = { u: 0.62, v: 0.08, up: 1 };  // placed along their paths by the hour
  const sun = { u: 0.6, v: 0.35, up: 1 };     // up: 0 below the horizon .. 1 well above it
  let skyBottom = 0.45;
  const path = { rise: { u: 0.1, v: 0.4 }, set: { u: 0.6, v: 0.45 }, apex: 0.08 };
  // Where a body is at fraction f of its trip across the sky (0 = rising, 1 = setting;
  // outside 0..1 it is below the horizon).
  function bodyAt(f, out) {
    const lerp = (a, b) => a + (b - a) * f;
    const arc = Math.sin(Math.PI * f);
    const base = lerp(path.rise.v, path.set.v);
    out.u = lerp(path.rise.u, path.set.u);
    out.v = base + (path.apex - base) * Math.max(arc, 0) + Math.min(arc, 0) * 0.15;
    out.up = Math.min(1, Math.max(0, (arc + 0.05) / 0.25));
  }

  const SCENE_FRAG = `#version 300 es
  precision highp float;
  in vec2 vLocal;
  out vec4 outColor;
  uniform vec4 uRect;
  uniform sampler2D uVideo, uMask;
  uniform vec2 uMoon, uSun;      // uv
  uniform float uSkyBottom;      // lowest v of the sky
  uniform float uGolden, uNight; // scene weights, 0..1
  uniform float uTime, uAspect;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // Draws a sun or moon disc with a glow into sky; returns the glow (to spill on the ground).
  vec3 body(vec2 uv, vec2 at, float radius, vec3 col, vec3 glowCol, float glowFall, inout vec3 sky) {
    vec2 d = (uv - at) * vec2(uAspect, 1.0);
    float r = length(d);
    sky = mix(sky, col, smoothstep(radius, radius * 0.88, r));
    vec3 glow = glowCol * exp(-r * glowFall);
    sky += glow;
    return glow;
  }
  void main() {
    vec2 uv = vLocal / uRect.zw;
    vec3 day = texture(uVideo, uv).rgb;
    float sky = texture(uMask, uv).r;
    float lum = dot(day, vec3(0.299, 0.587, 0.114));
    float toHorizon = smoothstep(0.0, uSkyBottom, uv.y);     // 0 at the top, 1 at the horizon

    // golden hour: warm, a bit darker ground; orange-to-violet sky; a low sun
    vec3 goldGround = mix(vec3(lum), day, 0.75) * vec3(1.18, 0.86, 0.64) * 0.82;
    vec3 goldSky = mix(vec3(0.30, 0.24, 0.48), vec3(1.0, 0.56, 0.26), pow(toHorizon, 1.6));
    vec3 sunGlow = body(uv, uSun, 0.03, vec3(1.0, 0.86, 0.6), vec3(1.0, 0.6, 0.3) * 0.55, 9.0, goldSky);
    vec3 golden = mix(goldGround + sunGlow * 0.25, goldSky, sky);

    // night: darker, bluer ground (the snow kept a little brighter); stars and the moon
    vec3 nightGround = mix(vec3(lum), day, 0.3) * vec3(0.30, 0.38, 0.62) * (0.35 + 0.5 * lum * lum);
    vec3 nightSky = mix(vec3(0.015, 0.02, 0.05), vec3(0.06, 0.09, 0.18), smoothstep(0.0, 0.55, uv.y));
    vec2 grid = uv * vec2(220.0, 220.0 / uAspect);
    float h = hash(floor(grid));
    nightSky += step(0.985, h) * smoothstep(0.35, 0.0, length(fract(grid) - 0.5))
              * (0.6 + 0.4 * sin(uTime * 0.002 + h * 60.0));
    vec3 moonGlow = body(uv, uMoon, 0.028, vec3(0.96, 0.95, 0.88), vec3(0.55, 0.62, 0.8) * 0.35, 18.0, nightSky);
    vec3 night = mix(nightGround + moonGlow * 0.4, nightSky, sky);

    vec3 col = mix(mix(day, golden, uGolden), night, uNight);
    outColor = vec4(col, 1.0);
  }`;

  function initNight(maskImg) {
    if (!bgl) return;
    try {
      BU = program(bgl, QUAD_VERT, SCENE_FRAG);
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
    // Paths for the sun and moon: they rise behind the mountain on the left (the sky's
    // leftmost point), arc up near the top of the sky and set into the gap between the
    // peaks (the sky's lowest point). The sky mask hides them behind the mountains.
    let bottom = 0, bx = 0, left = c.width, ly = 0;
    for (let i = 0; i < c.width * c.height; i++) if (d[i * 4] > 230) {
      const y = Math.floor(i / c.width), xx = i % c.width;
      if (y >= bottom) { bottom = y; bx = xx; }
      if (xx < left) { left = xx; ly = y; }
    }
    skyBottom = bottom / c.height;
    path.rise = { u: left / c.width - 0.04, v: ly / c.height + 0.1 };
    path.set = { u: bx / c.width, v: skyBottom + 0.015 };
    path.apex = top / c.height + 0.07;
    video.parentElement.append(bg);
  }

  function drawScene(time) {
    const on = settings.light === "video" && BU && (weights.golden > 0.004 || weights.night > 0.004);
    bg.style.display = on ? "block" : "none";
    if (!on) return;
    // laid over the video inside the same parent, so it moves with the background's tilt shift
    const p = pictureInElement(video.offsetWidth, video.offsetHeight);
    const r = { left: video.offsetLeft + p.left, top: video.offsetTop + p.top, width: p.width, height: p.height };
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
    bgl.uniform2f(BU.uSun, sun.u, sun.v);
    bgl.uniform1f(BU.uSkyBottom, skyBottom);
    bgl.uniform1f(BU.uGolden, weights.golden);
    bgl.uniform1f(BU.uNight, weights.night);
    bgl.uniform1f(BU.uTime, time);
    bgl.uniform1f(BU.uAspect, r.width / r.height);
    bgl.drawArrays(bgl.TRIANGLE_STRIP, 0, 4);
  }

  // =====================================================================================
  // Time of day: weights for golden hour and night
  // =====================================================================================
  // Today's sunrise and sunset for roughly where the visitor is, without asking for their
  // location: the browser's time zone gives approximate coordinates (a small table of
  // zones; otherwise longitude from the UTC offset and ~40° latitude), and the standard
  // sunrise equation gives the times, usually within 15-30 minutes. Golden hour is full
  // within ~45 min of sunrise/sunset and fades out over the next hour; night is fully in
  // from ~2 h after sunset to ~1.5 h before sunrise.
  const ZONES = {   // time zone: [latitude, longitude]
    "America/New_York": [40.7, -74.0], "America/Toronto": [43.7, -79.4], "America/Chicago": [41.9, -87.6],
    "America/Denver": [39.7, -105.0], "America/Phoenix": [33.4, -112.1], "America/Los_Angeles": [34.1, -118.2],
    "America/Vancouver": [49.3, -123.1], "America/Anchorage": [61.2, -149.9], "Pacific/Honolulu": [21.3, -157.9],
    "America/Halifax": [44.6, -63.6], "America/St_Johns": [47.6, -52.7], "America/Mexico_City": [19.4, -99.1],
    "America/Bogota": [4.7, -74.1], "America/Lima": [-12.0, -77.0], "America/Santiago": [-33.4, -70.7],
    "America/Sao_Paulo": [-23.5, -46.6], "America/Argentina/Buenos_Aires": [-34.6, -58.4],
    "Europe/London": [51.5, -0.1], "Europe/Dublin": [53.3, -6.3], "Europe/Lisbon": [38.7, -9.1],
    "Europe/Madrid": [40.4, -3.7], "Europe/Paris": [48.9, 2.4], "Europe/Brussels": [50.8, 4.4],
    "Europe/Amsterdam": [52.4, 4.9], "Europe/Berlin": [52.5, 13.4], "Europe/Rome": [41.9, 12.5],
    "Europe/Zurich": [47.4, 8.5], "Europe/Vienna": [48.2, 16.4], "Europe/Prague": [50.1, 14.4],
    "Europe/Warsaw": [52.2, 21.0], "Europe/Stockholm": [59.3, 18.1], "Europe/Oslo": [59.9, 10.8],
    "Europe/Copenhagen": [55.7, 12.6], "Europe/Helsinki": [60.2, 24.9], "Europe/Athens": [38.0, 23.7],
    "Europe/Istanbul": [41.0, 29.0], "Europe/Kyiv": [50.5, 30.5], "Europe/Moscow": [55.8, 37.6],
    "Atlantic/Reykjavik": [64.1, -21.9], "Africa/Cairo": [30.0, 31.2], "Africa/Lagos": [6.5, 3.4],
    "Africa/Nairobi": [-1.3, 36.8], "Africa/Johannesburg": [-26.2, 28.0], "Asia/Dubai": [25.2, 55.3],
    "Asia/Kolkata": [19.1, 72.9], "Asia/Bangkok": [13.8, 100.5], "Asia/Singapore": [1.35, 103.8],
    "Asia/Jakarta": [-6.2, 106.8], "Asia/Manila": [14.6, 121.0], "Asia/Shanghai": [31.2, 121.5],
    "Asia/Hong_Kong": [22.3, 114.2], "Asia/Taipei": [25.0, 121.6], "Asia/Seoul": [37.6, 127.0],
    "Asia/Tokyo": [35.7, 139.7], "Australia/Perth": [-31.95, 115.9], "Australia/Adelaide": [-34.9, 138.6],
    "Australia/Brisbane": [-27.5, 153.0], "Australia/Sydney": [-33.9, 151.2], "Australia/Melbourne": [-37.8, 145.0],
    "Pacific/Auckland": [-36.85, 174.8],
  };
  const sunTimes = { rise: 6.5, set: 19.0, where: "" };
  function estimateSunTimes(date = new Date()) {
    let zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* none */ }
    const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    const standard = Math.max(jan, jul);                      // minutes behind UTC, without DST
    let [lat, lon] = ZONES[zone] || [NaN, -standard / 4];      // 15° of longitude per hour
    if (isNaN(lat)) lat = /^(Australia|Pacific\/(Auckland|Fiji)|America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion))/.test(zone) ? -30 : 40;
    // sunrise equation (declination and equation of time: standard approximations)
    const rad = Math.PI / 180;
    const day = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5;
    const g = 2 * Math.PI / 365 * (day - 1);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
               + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
                 - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));   // minutes
    const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    const halfDay = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad / 15;    // hours
    const noonUtc = 12 - lon / 15 - eqTime / 60;
    const noonLocal = noonUtc - date.getTimezoneOffset() / 60;                // today's offset (DST)
    // keep both inside the day, and leave room for golden hour even in polar summer/winter
    sunTimes.rise = Math.max(2, Math.min(11.5, noonLocal - halfDay));
    sunTimes.set = Math.min(22, Math.max(12.5, noonLocal + halfDay));
    sunTimes.where = (ZONES[zone] ? zone : (zone || "UTC offset") + " (rough)") + ` ${lat.toFixed(0)}°, ${lon.toFixed(0)}°`;
  }
  estimateSunTimes();
  setInterval(() => estimateSunTimes(), 30 * 60 * 1000);

  const SCENE_HOURS = { day: () => (sunTimes.rise + sunTimes.set) / 2, sunset: () => sunTimes.set, night: () => (sunTimes.set + 24 + sunTimes.rise) / 2 % 24 };
  const weights = { golden: 0, night: 0 };
  function sceneHour() {
    if (settings.scene === "custom") return settings.hour;
    if (settings.scene in SCENE_HOURS) return SCENE_HOURS[settings.scene]();
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function weightsAt(h) {
    const { rise, set } = sunTimes;
    const night = 1 - smooth(rise - 1.5, rise + 0.5, h) + smooth(set + 0.25, set + 2, h);
    // golden hour: full within 0.75 h of sunrise/sunset, gone 1.75 h away
    const near = Math.min(Math.abs(h - rise), Math.abs(h - set));
    const golden = 1 - smooth(0.75, 1.75, near);
    return { night: Math.min(1, Math.max(0, night)), golden };
  }
  // The shown time glides to the scene's hour (the short way round the clock, ~2 s), so
  // switching scenes moves the sun and moon along their paths instead of jumping.
  let shownHour = null, lastWeightsTime = 0;
  function updateWeights(time) {
    const dt = Math.min(1, Math.max(0, (time - lastWeightsTime) / 1000));
    lastWeightsTime = time;
    const goal = sceneHour();
    if (shownHour === null) shownHour = goal;
    const diff = ((goal - shownHour + 36) % 24) - 12;          // -12..12
    shownHour = (shownHour + diff * (1 - Math.exp(-dt * 2.2)) + 24) % 24;
    const w = weightsAt(shownHour);
    weights.golden = w.golden * intro.e;       // starts as day, eases into the scene
    weights.night = w.night * intro.e;
    const { rise, set } = sunTimes;
    bodyAt((shownHour - rise) / (set - rise), sun);
    const night = 24 - (set - rise) + 1;                       // the moon is up a little longer
    bodyAt((((shownHour - (set - 0.5)) % 24) + 24) % 24 / night, moon);
  }

  // =====================================================================================
  // Lights
  // =====================================================================================
  const pointer = { x: innerWidth * 0.3, y: innerHeight * 0.2 };
  addEventListener("pointermove", e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = performance.now(); pointer.inside = true;
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer.inside = false; });

  // The mouse as a small light: a soft pool around the pointer, bright while it moves and
  // fading out after a moment of stillness, so it can be raked across the metal.
  const cursorGlow = { level: 0, last: 0 };
  // Phones: tilting the phone (gyroscope/accelerometer via deviceorientation) moves a soft
  // light across the frame and shifts the viewing angle, so reflections and glints move.
  // The first reading is "neutral", whatever angle the phone is held at; neutral drifts
  // slowly towards the current angle so it settles if the phone is put down at a new angle.
  // iPhones ask for permission, which needs a tap, so the first tap asks.
  const motion = { active: false, gx: 0, gy: 0, x: 0, y: 0, base: null };
  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    const now = [e.gamma, e.beta];                 // left/right, front/back, degrees
    if (!motion.base) motion.base = now.slice();
    motion.base[0] += (now[0] - motion.base[0]) * 0.004;
    motion.base[1] += (now[1] - motion.base[1]) * 0.004;
    const clamp = v => Math.max(-1, Math.min(1, v));
    motion.gx = clamp((now[0] - motion.base[0]) / 25);
    motion.gy = clamp((now[1] - motion.base[1]) / 25);
    motion.active = true;
  }
  if ("DeviceOrientationEvent" in window) {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {   // iOS
      addEventListener("touchend", function ask() {
        removeEventListener("touchend", ask);
        DeviceOrientationEvent.requestPermission()
          .then(r => { if (r === "granted") addEventListener("deviceorientation", onOrientation); })
          .catch(() => {});
      });
    } else {
      addEventListener("deviceorientation", onOrientation);
    }
  }
  function motionLight() {
    if (!settings.motion || !motion.active) return null;
    motion.x += (motion.gx - motion.x) * 0.15;      // smooth out sensor jitter
    motion.y += (motion.gy - motion.y) * 0.15;
    const [ax, ay] = aimPoint();
    const k = 0.95 * settings.strength;
    return { pos: [ax + motion.x * innerWidth * 0.7, ay + motion.y * innerHeight * 0.45, 220],
             col: [1.1 * k, 1.05 * k, 0.95 * k] };
  }

  function cursorLight(time) {
    const dt = Math.min(0.1, Math.max(0, (time - cursorGlow.last) / 1000));
    cursorGlow.last = time;
    const active = settings.cursor && settings.light !== "pointer" && pointer.inside &&
                   performance.now() - (pointer.moved || -1e9) < 1500;
    cursorGlow.level += ((active ? 1 : 0) - cursorGlow.level) * (1 - Math.exp(-dt * (active ? 8 : 2)));
    if (cursorGlow.level < 0.01) return null;
    const k = 0.9 * cursorGlow.level * settings.strength;
    return { pos: [pointer.x, pointer.y, 150], col: [1.1 * k, 1.05 * k, 0.95 * k], dir: [0, 0, -1],
             cone: [Math.cos(55 * Math.PI / 180), Math.cos(10 * Math.PI / 180)] };   // ~210 px pool, softish edge
  }

  const AMBIENT = [0.35, 0.36, 0.42];
  const ENV = [0.62, 0.64, 0.70];
  const NIGHT_TINT = [0.30, 0.38, 0.62];
  const MOON_COL = [0.80, 0.88, 1.15];
  const SUN_COL = [1.30, 0.78, 0.45];
  const GOLD_TINT = [1.18, 0.86, 0.64];

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
    const r = card ? layout.get(card) || card.getBoundingClientRect()
                   : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  // Where a light whose scene spot is at screen (x, y) goes. Scene: right over the spot.
  // Viewer: out in front of the screen (towards whoever is looking at it), moved only part
  // of the way towards the spot, so the card is lit from the front with a tilt.
  function place(x, y) {
    if (settings.from === "scene") return [x, y, settings.height];
    const [ax, ay] = aimPoint();
    return [ax + (x - ax) * settings.spread, ay + (y - ay) * settings.spread, settings.distance];
  }

  // A spotlight for the scene spot (x, y), aimed at the aim point on the page.
  function spot(x, y, col) {
    const [ax, ay] = aimPoint();
    const pos = place(x, y);
    const d = [ax - pos[0], ay - pos[1], -pos[2]];
    const len = Math.hypot(...d);
    const [outer, inner] = settings.from === "scene" ? [50, 22] : [65, 35];
    return { pos, col, dir: d.map(c => c / len),
             cone: [Math.cos(outer * Math.PI / 180), Math.cos(inner * Math.PI / 180)] };
  }

  // Returns [{pos:[x,y,z] CSS px, col:[r,g,b], dir?, cone?}] and sets the fill/env.
  const keySources = [];      // screen positions of the key lights, for the guides
  function lights(time) {
    keySources.length = 0;
    if (settings.light === "video") {
      sampleScene(time);
      easeScene();
      const g = weights.golden, nt = weights.night, dy = Math.max(0, 1 - g - nt);
      const mixCol = (c, k) => c * c * (dy + g * GOLD_TINT[k] * 0.85 + nt * NIGHT_TINT[k] * 0.35);
      const fillK = settings.strength * 1.6 / (GRID_X * GRID_Y);
      const out = scene.cells.map((c, i) => {
        const gx = i % GRID_X, gy = Math.floor(i / GRID_X);
        const [x, y] = uvToScreen((gx + 0.5) / GRID_X, (gy + 0.5) / GRID_Y);
        return { pos: place(x, y), col: c.map((v, k) => mixCol(v, k) * fillK * 3) };
      });
      const keyK = settings.strength * settings.key;
      // day: the two brightest spots of the video
      if (dy > 0.01) scene.keys.forEach((k, i) => {
        const [x, y] = i === 0 && pinned.x !== null ? [pinned.x, pinned.y] : uvToScreen(k.u, k.v);
        keySources.push([x, y]);
        const lum = 0.299 * k.col[0] + 0.587 * k.col[1] + 0.114 * k.col[2];
        out.push(spot(x, y, k.col.map(v => (0.5 * v + 0.5 * lum) * keyK * (i ? 0.8 : 1.1) * dy)));
      });
      // golden hour: the low sun; night: the moon
      for (const [wt, body, col] of [[g, sun, SUN_COL], [nt, moon, MOON_COL]]) {
        const w = wt * (0.25 + 0.75 * body.up);   // dimmer once it is behind the horizon
        if (w <= 0.01) continue;
        const [x, y] = pinned.x !== null && dy <= 0.01 ? [pinned.x, pinned.y] : uvToScreen(body.u, body.v);
        keySources.push([x, y]);
        out.push(spot(x, y, col.map(v => v * keyK * 1.1 * w)));
      }
      const blend = (dayV, goldV, nightV) => dayV.map((v, k) => v * dy + goldV[k] * g + nightV[k] * nt);
      scene.ambient = blend(target.ambient, [0.32, 0.24, 0.22], [0.07, 0.09, 0.16]);
      scene.env = blend(target.env, [0.62, 0.46, 0.36], [0.18, 0.22, 0.34]);
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
  guides.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:11;display:none";
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
  let texBorder, texRing, clock = null, clockAt = -1e9;

  // Intro: the page starts as plain, fully lit daylight (like the static version) and the
  // whole scene, background and the frame's lights together, eases into the current time of
  // day over INTRO_MS (ease-in-out cubic); key lights glide in from above the card and the
  // sparkle comes last. Reduced motion: a short fade without the glide.
  const INTRO_MS = reduceMotion ? 400 : 2600;
  let introStart = null;
  const intro = { e: 0, glide: 0 };           // eased progress: lighting, key-light glide
  const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  function updateIntro(time) {
    if (introStart === null) introStart = time;
    const t = Math.min(1, (time - introStart) / INTRO_MS);
    intro.e = easeInOutCubic(t);
    intro.glide = reduceMotion ? 1 : easeOutCubic(Math.min(1, t * 1.25));
  }
  // Applied to the lights for this frame: dimmed by the intro, key lights gliding in.
  function introLights(ls) {
    if (intro.glide >= 1) return ls;
    const [ax, ay] = aimPoint();
    return ls.map(l => {
      const out = { ...l };
      if (l.dir) {                              // key light: from high above the card
        const from = [ax, ay - innerHeight * 0.7, l.pos[2] * 1.5];
        out.pos = l.pos.map((v, i) => from[i] + (v - from[i]) * intro.glide);
        const d = [ax - out.pos[0], ay - out.pos[1], -out.pos[2]];
        const len = Math.hypot(...d);
        out.dir = d.map(c => c / len);
      }
      return out;
    });
  }
  const fmt = h => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

  function setMaterial(which) {
    const m = settings[which];
    gl.uniform3fv(U.uStoneDark, STONES[m.stone][0]);
    gl.uniform3fv(U.uStoneLight, STONES[m.stone][1]);
    gl.uniform3fv(U.uMetal, METALS[m.metal]);
    gl.uniform1f(U.uMetalRough, m.metal === "red" ? 0.65 : 0.38);
  }

  // Rects as laid out, without the tilt (the canvas gets the same tilt as the card).
  const layout = new Map();
  function measure() {
    const t = card && card.style.transform;
    if (t) card.style.transform = "none";
    for (const el of [card, ring]) if (el) layout.set(el, el.getBoundingClientRect());
    if (t) card.style.transform = t;
  }
  function rectOf(el, dpr) {
    const r = layout.get(el) || el.getBoundingClientRect();
    return [r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr];
  }

  // =====================================================================================
  // WASD tilt (debugging): tilts the card in 3D; the frame canvas gets the same transform,
  // the shader the matching view direction, and the background shifts a little the other
  // way. R resets.
  // =====================================================================================
  const tilt = { yaw: 0, pitch: 0 };
  const held = new Set();
  const siteBg = video && video.closest(".--site-bg");
  addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(input|select|textarea)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (settings.tilt && "wasd".includes(k) && k.length === 1) held.add(k);
    if (k === "r") tilt.yaw = tilt.pitch = 0;
  });
  addEventListener("keyup", e => held.delete(e.key.toLowerCase()));
  addEventListener("blur", () => held.clear());
  let lastTime = 0;
  function applyTilt(time) {
    const dt = Math.min(0.25, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    const rate = 30;                          // degrees per second
    if (held.has("a")) tilt.yaw -= rate * dt;
    if (held.has("d")) tilt.yaw += rate * dt;
    if (held.has("w")) tilt.pitch += rate * dt;
    if (held.has("s")) tilt.pitch -= rate * dt;
    if (!settings.tilt) { held.clear(); tilt.yaw = tilt.pitch = 0; }
    tilt.yaw = Math.max(-30, Math.min(30, tilt.yaw));
    tilt.pitch = Math.max(-30, Math.min(30, tilt.pitch));
    const on = tilt.yaw || tilt.pitch;
    const transform = on ? `perspective(1400px) rotateX(${tilt.pitch}deg) rotateY(${tilt.yaw}deg)` : "";
    if (card) card.style.transform = transform;
    measure();
    const r = card && layout.get(card);
    canvas.style.transformOrigin = r ? `${r.left + r.width / 2}px ${r.top + r.height / 2}px` : "50% 50%";
    canvas.style.transform = transform;
    if (siteBg) {           // shift the background the other way, zoomed just enough to hide its edges
      const dx = -tilt.yaw * 5, dy = tilt.pitch * 5;
      const zoom = 1 + 2 * Math.max(Math.abs(dx) / innerWidth, Math.abs(dy) / innerHeight) + 0.01;
      siteBg.style.transformOrigin = "50% 50%";
      siteBg.style.transform = on ? `translate(${dx}px, ${dy}px) scale(${zoom.toFixed(4)})` : "";
    }
    // the viewer, seen from the card: the inverse of the card's rotation applied to (0, 0, 1)
    const tiltYaw = tilt.yaw + (settings.motion && motion.active ? motion.x * 12 : 0);
    const tiltPitch = tilt.pitch - (settings.motion && motion.active ? motion.y * 12 : 0);
    const y = tiltYaw * Math.PI / 180, x = tiltPitch * Math.PI / 180;
    const v = [-Math.sin(y), Math.sin(x) * Math.cos(y), Math.cos(x) * Math.cos(y)];
    const len = Math.hypot(...v);
    gl.uniform3f(U.uView, v[0] / len, v[1] / len, v[2] / len);
  }

  function frame(time) {
    updateIntro(time);
    applyTilt(time);
    updateWeights(time);
    drawScene(time);
    if (clock && !clock.closest("[hidden]") && time - clockAt > 500) {
      clockAt = time;
      const h = shownHour ?? sceneHour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      clock.textContent = `${String(hh).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}` +
        ` · golden ${weights.golden.toFixed(2)} · night ${weights.night.toFixed(2)}` +
        (settings.tilt ? ` · tilt ${tilt.yaw.toFixed(0)}°, ${tilt.pitch.toFixed(0)}°` : "") +
        `
Sun ${fmt(sunTimes.rise)}–${fmt(sunTimes.set)} · ${sunTimes.where}`;
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.style.width !== innerWidth + "px" || canvas.style.height !== innerHeight + "px") {
      canvas.style.width = innerWidth + "px";       // exactly the visible window (see above)
      canvas.style.height = innerHeight + "px";
    }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uCanvas, w, h);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uBump, settings.bump);
    gl.uniform1f(U.uSparkle, settings.sparkle * intro.e * intro.e);
    // normal: ~2.5 px points, 1 in 6, fairly exact; extreme: bigger, 1 in 2, easy to trigger
    gl.uniform4fv(U.uGlint, settings.extreme ? [4.5, 0.5, 40, 30] : [2.5, 0.84, 160, 6]);
    gl.uniform1f(U.uGoldEdges, settings.goldEdges ? 1 : 0);
    gl.uniform1f(U.uTime, time);
    const cur = cursorLight(time) || motionLight();
    const ls = introLights(lights(time).slice(0, MAX_LIGHTS - (cur ? 1 : 0))).concat(cur ? [cur] : []);
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
      // only inside the card's border: on phones the card's contents (and so the ring)
      // can scroll behind the border
      if (card) {
        const [cx, cy, cw, ch] = rectOf(card, dpr);
        const b = parseFloat(getComputedStyle(card).borderTopWidth) * dpr;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(Math.round(cx + b), Math.round(h - (cy + ch - b)),
                   Math.max(0, Math.round(cw - 2 * b)), Math.max(0, Math.round(ch - 2 * b)));
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
    }
    if (!revealed && pageReady) {               // the card and the lit frame appear together,
      revealed = true;                          // complete; then the scene's transition starts
      canvas.style.opacity = "1";
      document.documentElement.classList.remove("loading", "lit-pending");
      introStart = null;
    }
    requestAnimationFrame(frame);
  }

  // =====================================================================================
  // Control panel
  // =====================================================================================
  function panel() {
    const p = document.createElement("div");
    p.className = "lit-panel";
    const LABELS = { blackslate: "Black slate", red: "Red paint" };
    const nice = o => LABELS[o] || o[0].toUpperCase() + o.slice(1);
    const select = (label, value, options, set) => {
      const id = "lit-" + label.replace(/\W+/g, "-").toLowerCase();
      return `<label for="${id}">${label}</label><select id="${id}" data-set="${set}">` +
        options.map(o => `<option value="${o}"${o === value ? " selected" : ""}>${nice(o)}</option>`).join("") + "</select>";
    };
    const toggle = (label, set) =>
      `<label class="lit-toggle"><input id="lit-${set}" type="checkbox" data-set="${set}"${settings[set] ? " checked" : ""}> ${label}</label>`;
    // label | number box | slider; the box and the slider stay in step
    const range = (label, set, min, max, step) => {
      const id = "lit-" + set, attrs = `min="${min}" max="${max}" step="${step}" value="${settings[set]}" data-set="${set}"`;
      return `<label for="${id}">${label}</label><input type="number" ${attrs} aria-label="${label}">` +
             `<input id="${id}" type="range" ${attrs}>`;
    };
    p.innerHTML =
      `<strong>Live lighting</strong>` +
      select("Light", settings.light, ["video", "pointer", "orbit"], "light") +
      select("Scene", settings.scene, ["auto", "day", "sunset", "night", "custom"], "scene") +
      range("Hour", "hour", 0, 24, 0.25) +
      `<small data-clock></small>` +
      select("Light from", settings.from, ["viewer", "scene"], "from") +
      range("Distance", "distance", 200, 3000, 50) +
      range("Spread", "spread", 0, 1, 0.05) +
      range("Height", "height", 60, 900, 10) +
      range("Strength", "strength", 0.2, 2.5, 0.05) +
      range("Key light", "key", 0, 3, 0.05) +
      range("Fill", "fill", 0, 2.5, 0.05) +
      range("Depth", "bump", 0, 6, 0.1) +
      range("Sparkle", "sparkle", 0, 10, 0.05) +
      `<div class="lit-toggles">${toggle("Extreme sparkle", "extreme")}${toggle("Gold edges", "goldEdges")}` +
      `${toggle("Cursor light", "cursor")}${toggle("Phone tilt", "motion")}${toggle("Guides", "guides")}${toggle("WASD tilt", "tilt")}</div>` +
      select("Ring metal", settings.ring.metal, Object.keys(METALS), "ring.metal") +
      select("Ring stone", settings.ring.stone, Object.keys(STONES), "ring.stone") +
      select("Border metal", settings.border.metal, Object.keys(METALS), "border.metal") +
      select("Border stone", settings.border.stone, Object.keys(STONES), "border.stone") +
      `<small>Shift+click: aim · Alt+click: pin light · WASD: tilt (if on) · R: untilt · L: hide</small>` +
      `<div class="lit-buttons"><button type="button" data-reset>Reset aim</button><button type="button" data-replay>Replay intro</button>` +
      `<a href="${window.route ? window.route.staticUrl : "static/"}">Static version</a></div>`;
    p.addEventListener("input", e => {
      const key = e.target.dataset.set;
      if (!key) return;
      let value;
      if (e.target.type === "range" || e.target.type === "number") {
        value = parseFloat(e.target.value);
        if (isNaN(value)) return;                      // half-typed number
        value = Math.min(parseFloat(e.target.max), Math.max(parseFloat(e.target.min), value));
        for (const other of p.querySelectorAll(`[data-set="${key}"]`)) if (other !== e.target) other.value = value;
      } else {
        value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      }
      const [a, b] = key.split(".");
      if (b) settings[a][b] = value; else settings[a] = value;
    });
    p.querySelector("[data-replay]").addEventListener("click", () => { introStart = null; });
    p.querySelector("[data-reset]").addEventListener("click", () => {
      aim.x = aim.y = pinned.x = pinned.y = null;
    });
    const style = document.createElement("style");
    style.textContent = `
      .lit-panel[hidden] { display: none }
      .lit-panel { position: fixed; left: 10px; bottom: 10px; z-index: 20; box-sizing: border-box;
        width: 290px; max-width: calc(100vw - 20px); max-height: calc(100vh - 20px); overflow-y: auto;
        display: grid; grid-template-columns: 74px 52px 1fr; gap: 3px 6px; align-items: center;
        padding: 8px 10px; font: 11px/1.3 system-ui, sans-serif; color: #e6e6ea;
        background: rgba(20, 21, 27, .88); border-radius: 8px }
      .lit-panel strong, .lit-panel small, .lit-toggles, .lit-buttons { grid-column: 1 / -1 }
      .lit-panel small { color: #9a9cab; overflow-wrap: anywhere }
      .lit-panel [data-clock] { white-space: pre-line }
      .lit-panel select { grid-column: 2 / -1 }
      .lit-panel select, .lit-panel input, .lit-panel button { font: inherit; min-width: 0; margin: 0 }
      .lit-panel input[type=number] { width: 100%; box-sizing: border-box; padding: 1px 3px }
      .lit-panel input[type=range] { width: 100% }
      .lit-toggles, .lit-buttons { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center }
      .lit-toggle { display: inline-flex; gap: 4px; align-items: center }
      .lit-buttons a { color: #9ab4ff; margin-left: auto }
      html.lit .avatar-ring { visibility: hidden }
      html.lit .--site-main .--container-component.--instance-container02 { border-image: none !important }`;
    document.head.append(style);
    // Hidden unless the URL has the "panel" flag (/lit/#panel, ?lit&panel); L shows/hides it.
    p.hidden = !(window.route ? window.route.flags.has("panel") : /[?&#]panel/.test(location.href));
    addEventListener("keydown", e => {
      if (e.key.toLowerCase() !== "l" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(input|select|textarea)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
      p.hidden = !p.hidden;
    });
    document.body.append(p);
    clock = p.querySelector("[data-clock]");
  }

  Promise.all([loadImage(BORDER.src), loadImage(RING.src)]).then(([b, r]) => {
    texBorder = newTexture(gl, b);
    texRing = newTexture(gl, r);
    document.body.append(canvas, guides);
    panel();
    document.documentElement.classList.add("lit");   // hide the static ring and border
    // the card and the canvas are shown together by frame() once everything has loaded
    if (video) loadImage(SKY_MASK).then(initNight).catch(e => console.warn("lit.js: no sky mask, no night mode", e));
    requestAnimationFrame(frame);
  }).catch(e => { console.warn("lit.js: textures failed, keeping the static version", e); giveUp(); });
})();
