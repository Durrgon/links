// Tiny router, loaded in <head> of every page (keep it small: it blocks rendering briefly).
//
// A route is picked from, in order:
//   1. <meta name="route" content="..."> in the page: the real URLs, e.g. /links/lit/,
//      whose folders scripts/build_routes.py generates from index.html (with
//      <base href="../"> so every asset path still works);
//   2. a word in the hash or query: #static, #lit, ?lit (older links). Other words are
//      flags (e.g. #panel), available as route.flags.
// No route means the site itself, which is the live-lit version. Without JavaScript
// (or WebGL2) every route is just the static page.
//
// Adding a route: add it to ROUTES, list it in
// scripts/build_routes.py if it should have its own URL, and run that script.
(() => {
  "use strict";
  const LIT = {
    scripts: ["js/lit.js"],
    preload: [["js/lit.js", "script"], ["images/lit/border.png", "image"], ["images/lit/ring.png", "image"]],
    pending: "lit-pending",   // hides the static ring and border until js/lit.js has started
  };
  const ROUTES = {
    "": LIT,                    // the site itself (/links/) is the live-lit version
    lit: LIT,                   // older /lit/, #lit, ?lit links
    static: {},                 // /static/ or #static: the plain page, no live lighting
  };

  const html = document.documentElement;
  const meta = document.querySelector('meta[name="route"]');
  const words = (location.hash.slice(1) + "&" + location.search.slice(1))
    .split(/[&+/]/).map(w => decodeURIComponent(w.split("=")[0])).filter(Boolean);
  const name = meta ? meta.content : words.find(w => w && w in ROUTES) || "";
  const config = ROUTES[name] || ROUTES[""];
  const home = new URL("./", document.baseURI).href;
  window.route = { name, flags: new Set(words), home, staticUrl: home + "static/" };

  // The card stays hidden (space kept) until what it shows has loaded, so it appears
  // complete in one go; a route with "pending" shows it itself once it has started.
  // After 3 s it is shown regardless.
  html.classList.add("loading");
  if (config.pending) html.classList.add(config.pending);
  for (const [href, as] of config.preload || []) {
    const l = document.createElement("link");
    l.rel = "preload"; l.href = href; l.as = as;
    document.head.append(l);
  }
  const image = src => new Promise(done => { const i = new Image(); i.onload = i.onerror = done; i.src = src; });
  const images = ["images/rune-border.webp", "images/banner.webp", "images/avatar.webp"]
    .concat(config.pending ? [] : ["images/avatar-frame.webp"]);
  window.pageReady = Promise.all([document.fonts ? document.fonts.load("1em Roboto") : 0, ...images.map(image)]);
  if (!config.pending) window.pageReady.then(() => html.classList.remove("loading"));
  setTimeout(() => {
    html.classList.remove("loading");
    if (config.pending && !html.classList.contains("lit")) html.classList.remove(config.pending);
  }, 3000);

  // the scripts every route has, then the route's own, once the page's markup is there
  // (in order: js/lit.js's panel talks to js/seasons.js)
  document.addEventListener("DOMContentLoaded", () => {
    for (const src of ["js/seasons.js", "js/easter-egg.js"].concat(config.scripts || [])) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      document.body.append(s);
    }
  });
  // a different hash may mean a different route: start over
  addEventListener("hashchange", () => location.reload());
})();
