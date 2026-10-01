/** The small floating control shown on the page while it is being read. */

const CSS_TEXT = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
div { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-radius: 999px;
  background: #1c1c1e; color: #fff; font: 13px/1 system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .35);
  transition: opacity .25s, transform .4s cubic-bezier(.2, .8, .2, 1); }
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
