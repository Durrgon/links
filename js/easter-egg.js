// Easter egg: three quick clicks (or taps) on the profile picture make it vibrate in place;
// three more stop it. The shake is css/main.css's .avatar-frame.buzz .avatar; it ignores reduced
// motion on purpose (it only ever starts when asked for). js/router.js loads this on every
// route.
(() => {
  "use strict";
  const start = () => {
    const frame = document.querySelector(".avatar-frame");
    if (!frame) return;
    let taps = [];
    frame.addEventListener("pointerdown", e => {
      if (e.button > 0) return;
      e.preventDefault();                       // quick clicks would select text
      const now = performance.now();
      taps = taps.filter(t => now - t < 650);
      taps.push(now);
      if (taps.length >= 3) { taps = []; frame.classList.toggle("buzz"); }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
