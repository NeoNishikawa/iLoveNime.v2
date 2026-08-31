import { animate, utils, createDraggable, spring } from "/vendor/animejs/anime.esm.js";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const run = (target, options) => reduced ? utils.set(target, options) : animate(target, options);

// The scroll reveal follows the requested Anime.js y-motion pattern while using a
// compact distance so the page remains calm on long catalog and detail screens.
export function reveal(targets) { if (!targets?.length) return; run(targets, { opacity: [0, 1], y: ["2rem", "0rem"], delay: (_, index) => index * 38, duration: 1000, ease: "inSine" }); }

// New anime cards enter with the requested spring profile, replacing the old
// rigid fade with a soft horizontal arrival.
export function revealNewAnime(targets) { if (!targets?.length) return; run(targets, { opacity: [0, 1], x: ["-1.5rem", "0rem"], delay: (_, index) => index * 35, ease: spring({ bounce: -0.87, duration: 541 }) }); }

export function switchSearch(dock, destination) { dock.classList.add("is-nav"); destination.append(dock); run(dock, { opacity: [0, 1], y: ["-10px", "0px"], duration: 360, ease: "outExpo" }); }
export function showDetail(panel) { run(panel, { opacity: [0, 1], y: ["28px", "0px"], duration: 650, ease: "outExpo" }); }

// Smooth page movement keeps the existing detail navigation, now with the
// requested longer vertical easing cadence.
export function smoothScroll(element) {
  if (!element) return;
  const top = Math.max(0, element.getBoundingClientRect().top + window.scrollY - 86);
  window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
}

// Streaming keeps the old dialog layout and receives the requested scale pop.
export function popupIn(dialog) { if (!dialog) return; if (reduced) { utils.set(dialog, { scale: 1 }); return; } animate(dialog, { scale: [0.88, 1.25, 1], duration: 1000, ease: "inExpo" }); }
export function menu(menu, opening) { if (opening) { menu.classList.add("is-open"); run(menu, { opacity: [0, 1], y: ["-7px", "0px"], duration: 180, ease: "outExpo" }); } else { animate(menu, { opacity: [1, 0], y: ["0px", "-7px"], duration: 120, ease: "inQuad", onComplete: () => menu.classList.remove("is-open") }); } }
export function savedFlight(art, destination) { if (!art || !destination || reduced) return; const from = art.getBoundingClientRect(); const to = destination.getBoundingClientRect(); const clone = art.cloneNode(true); clone.className = "flight-clone"; Object.assign(clone.style, { position: "fixed", zIndex: 50, left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, pointerEvents: "none" }); document.body.append(clone); animate(clone, { left: to.left, top: to.top, width: to.width, height: to.height, opacity: [1, 0], duration: 650, ease: spring({ mass: .7, stiffness: 170, damping: 16 }), onComplete: () => clone.remove() }); }

export { createDraggable, animate, utils, spring };
