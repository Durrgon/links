// Easter egg: three quick clicks (or taps) on the profile picture make it shake wildly in
// place, bouncing in every direction with a hint of blur; three more stop it. The
// gold circle round it doesn't move: the picture is clipped to a circle shifted back by
// the same amount it moves, so only what's inside the circle jitters (at its own size; the
// sliver it uncovers shows the dark disc behind it, css/main.css .avatar-frame::before). Ignores reduced motion on purpose (it only ever starts when asked for).
// js/router.js loads this on every route.
(() => {
  "use strict";
  const SCALE = 1;          // the picture's size while shaking (1: as it is)
  const REACH = 0.08;       // how far it can jump, as a share of its radius
  const start = () => {
    const frame = document.querySelector(".avatar-frame");
    const pic = frame && frame.querySelector(".avatar");
    if (!pic) return;
    let on = false, last = 0, taps = [];

    function shake(time) {
      if (!on) {
        Object.assign(pic.style, { transform: "", clipPath: "", filter: "", borderRadius: "" });
        return;
      }
      if (time - last > 28) {                   // a new jolt every couple of frames
        last = time;
        const w = pic.offsetWidth, h = pic.offsetHeight;
        const reach = REACH * Math.min(w, h) / 2;
        const a = Math.random() * Math.PI * 2, d = reach * (0.35 + 0.65 * Math.random());
        const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
        // the circle that stays put on screen, in the picture's own (moved, scaled) space
        const r = Math.min(w, h) / 2 / SCALE;
        const cx = w / 2 - dx / SCALE, cy = h / 2 - dy / SCALE;
        Object.assign(pic.style, {
          borderRadius: "0",
          transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${SCALE})`,
          clipPath: `circle(${r.toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px)`,
          filter: `blur(${(Math.random() * 0.35).toFixed(2)}px)`,
        });
      }
      requestAnimationFrame(shake);
    }

    frame.addEventListener("pointerdown", e => {
      if (e.button > 0) return;
      e.preventDefault();                       // quick clicks would select text
      const now = performance.now();
      taps = taps.filter(t => now - t < 650);
      taps.push(now);
      if (taps.length < 3) return;
      taps = [];
      on = !on;
      requestAnimationFrame(shake);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
