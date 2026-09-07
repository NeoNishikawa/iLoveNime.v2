const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(pointer: fine)");

export function initOrbitCursor() {
  const cursor = document.querySelector("#orbitCursor");
  if (!cursor || !finePointer.matches) return;

  document.body.classList.add("has-orbit-cursor");

  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const position = { x: pointer.x, y: pointer.y };
  let frame = 0;
  let active = false;

  const move = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!active) {
      position.x = pointer.x;
      position.y = pointer.y;
      active = true;
      cursor.classList.add("is-visible");
    }
  };

  const setHover = (event) => {
    const target = event.target.closest("a, button, input, select, textarea, [role=button]");
    cursor.classList.toggle("is-hovering", Boolean(target));
  };

  const render = () => {
    const easing = reducedMotion.matches ? 1 : 0.18;
    position.x += (pointer.x - position.x) * easing;
    position.y += (pointer.y - position.y) * easing;
    cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) translate(-50%, -50%)`;
    frame = window.requestAnimationFrame(render);
  };

  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerover", setHover, { passive: true });
  window.addEventListener("pointerout", setHover, { passive: true });
  window.addEventListener("blur", () => cursor.classList.remove("is-visible"));
  window.addEventListener("focus", () => { if (active) cursor.classList.add("is-visible"); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      frame = window.requestAnimationFrame(render);
    }
  });

  frame = window.requestAnimationFrame(render);
}
