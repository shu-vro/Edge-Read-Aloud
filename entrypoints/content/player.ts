/** The small floating control shown on the page while it is being read. */

const CSS_TEXT = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
div { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-radius: 999px;
  background: #1c1c1e; color: #fff; font: 13px/1 system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .35);
  transition: opacity .25s, transform .4s cubic-bezier(.2, .8, .2, 1); }
div { user-select: none; }
div.drag { transition: none; }
span.handle { min-width: 0; width: 16px; height: 12px; padding: 8px 2px; margin-right: 2px; cursor: grab; touch-action: none;
  background: repeating-linear-gradient(rgba(255, 255, 255, .5) 0 2px, transparent 2px 5px) content-box; }
div.drag span.handle { cursor: grabbing; }
/* Slides up when added to the page, and back down before it is removed. */
@starting-style { div { opacity: 0; transform: translateY(20px) scale(.94); } }
:host(.out) div { opacity: 0; transform: translateY(20px) scale(.94); }
button { all: unset; cursor: pointer; min-width: 28px; height: 28px; border-radius: 50%;
  text-align: center; font-size: 15px;
  transition: background .2s, transform .2s cubic-bezier(.2, .8, .2, 1); }
button:hover { background: rgba(255, 255, 255, .16); transform: scale(1.1); }
button:active { transform: scale(.9); transition-duration: .08s; }
button:focus-visible { outline: 2px solid #ffd60a; }
button.main { background: #ffd60a; color: #111; }
/* Collapsed to nothing until needed, so the bar grows and shrinks around it. */
button.jump { min-width: 0; max-width: 0; margin: 0; padding: 0; opacity: 0; overflow: hidden;
  border-radius: 999px; background: #ffd60a; color: #111; font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: max-width .4s cubic-bezier(.2, .8, .2, 1), padding .4s cubic-bezier(.2, .8, .2, 1),
    margin .4s cubic-bezier(.2, .8, .2, 1), opacity .25s, background .2s, transform .2s; }
button.jump.show { max-width: 160px; margin-right: 4px; padding: 0 12px; opacity: 1; }
button.jump:hover { background: #ffe14d; transform: scale(1.04); }
@media (prefers-reduced-motion: reduce) {
  div, button, button.jump { transition: none; }
}
span { min-width: 38px; text-align: center; font-variant-numeric: tabular-nums; }
span.error { color: #ff8a80; min-width: 0; padding: 0 6px; }
`;

export type PlayerActions = {
  toggle(): void;
  /** Scroll to the sentence being read. */
  reveal(): void;
  prev(): void;
  next(): void;
  stop(): void;
  speed(delta: number): void;
};

export function createPlayer(actions: PlayerActions) {
  const host = document.createElement("div");
  host.dataset.edgeTts = "";
  const shadow = host.attachShadow({ mode: "closed" });
  // A constructed sheet, because a strict page CSP would block an inline <style>.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS_TEXT);
  shadow.adoptedStyleSheets = [sheet];

  const bar = document.createElement("div");
  const button = (label: string, title: string, action: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", action);
    bar.append(b);
    return b;
  };
  const text = (className = "") => {
    const s = document.createElement("span");
    s.className = className;
    bar.append(s);
    return s;
  };

  const handle = document.createElement("span");
  handle.className = "handle";
  handle.title = "Drag to move";
  bar.append(handle);
  const jump = button("↕ Go to reading", "Scroll to the sentence being read", actions.reveal);
  jump.className = "jump";
  jump.inert = true;
  button("‹", "Previous sentence", actions.prev);
  const main = button("▶", "Play", actions.toggle);
  main.className = "main";
  button("›", "Next sentence", actions.next);
  button("−", "Slower", () => actions.speed(-10));
  const speed = text();
  button("+", "Faster", () => actions.speed(10));
  const error = text("error");
  button("✕", "Stop reading", actions.stop);
  shadow.append(bar);

  // Drag the bar by its handle; on release it snaps to the nearest screen corner.
  // ponytail: corner is kept per page load, not remembered across pages.
  let right = true;
  let bottom = true;
  const anchor = () => {
    const s = host.style;
    s.left = right ? "auto" : "16px";
    s.right = right ? "16px" : "auto";
    s.top = bottom ? "auto" : "16px";
    s.bottom = bottom ? "16px" : "auto";
  };
  let drag: { dx: number; dy: number } | undefined;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = bar.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId);
    bar.classList.add("drag");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const s = host.style;
    s.right = s.bottom = "auto";
    s.left = `${e.clientX - drag.dx}px`;
    s.top = `${e.clientY - drag.dy}px`;
  });
  const drop = () => {
    if (!drag) return;
    drag = undefined;
    bar.classList.remove("drag");
    const from = bar.getBoundingClientRect();
    right = from.left + from.width / 2 > innerWidth / 2;
    bottom = from.top + from.height / 2 > innerHeight / 2;
    anchor();
    const to = bar.getBoundingClientRect();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bar.animate(
        [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }],
        { duration: 350, easing: "cubic-bezier(.2, .8, .2, 1)" },
      );
    }
  };
  handle.addEventListener("pointerup", drop);
  handle.addEventListener("pointercancel", drop);

  let leaving: ReturnType<typeof setTimeout> | undefined;
  let wasPlaying = false;

  return {
    host,
    show() {
      clearTimeout(leaving);
      host.classList.remove("out");
      document.documentElement.append(host);
    },
    hide() {
      host.classList.add("out");
      leaving = setTimeout(() => host.remove(), 300); // after the slide-out
    },
    update(state: { playing: boolean; rate: number; error?: string; away: boolean }) {
      jump.classList.toggle("show", state.away);
      jump.inert = !state.away;
      if (state.playing !== wasPlaying) {
        wasPlaying = state.playing;
        main.animate([{ transform: "scale(.7)" }, { transform: "scale(1)" }], {
          duration: 260,
          easing: "cubic-bezier(.2, .8, .2, 1)",
        });
      }
      main.textContent = state.playing ? "❚❚" : "▶";
      main.title = state.playing ? "Pause" : "Play";
      main.setAttribute("aria-label", main.title);
      speed.textContent = `${(1 + state.rate / 100).toFixed(1)}×`;
      error.textContent = state.error ?? "";
    },
  };
}
