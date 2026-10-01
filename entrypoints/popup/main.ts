import type { Voice } from "edge-tts-universal/browser";
import type { Command, Status } from "@/lib/messages";
import { defaults, getSettings, setSettings } from "@/lib/settings";
import { getVoices, groupVoices, localeName, voiceName } from "@/lib/voices";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

function say(message: string) {
  $("note").textContent = message;
  $("note").hidden = !message;
}

// --- transport -------------------------------------------------------------------------------

async function send(cmd: Command["cmd"]) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const status: Status = await browser.tabs.sendMessage(tab.id!, { cmd });
    const label = !status.active ? "Read this page" : status.playing ? "Pause" : "Resume";
    $("toggle").classList.toggle("playing", status.playing);
    $("toggle").title = label;
    $("toggle").setAttribute("aria-label", label);
    $("state").textContent = !status.active ? "Ready" : status.playing ? "Reading" : "Paused";
    $("state").classList.toggle("on", status.playing);
    say("");
  } catch {
    say("This page can't be read. Browser pages and the extension store are off limits; tabs that were open before installing need a reload.");
  }
}

for (const cmd of ["toggle", "prev", "next", "stop"] as const) {
  $(cmd).addEventListener("click", () => send(cmd));
}
send("status");
// Opening the popup usually precedes pressing play: get the player and its connection ready.
browser.runtime.sendMessage({ cmd: "offscreen" }).catch(() => {});

// --- speed, pitch, volume --------------------------------------------------------------------

const settings = await getSettings();

const SPEED_PRESETS = [-25, 0, 25, 50, 100];
const sliders = ["rate", "pitch", "volume"] as const;
type Slider = (typeof sliders)[number];

const format = (key: Slider, value: number) =>
  key === "rate"
    ? `${(1 + value / 100).toFixed(2)}×`
    : `${value > 0 ? "+" : ""}${value}${key === "pitch" ? " Hz" : "%"}`;

function show(key: Slider, value: number) {
  $<HTMLInputElement>(key).valueAsNumber = value;
  $(`${key}-out`).textContent = format(key, value);
  if (key !== "rate") return;
  for (const chip of $("presets").children) {
    chip.classList.toggle("on", Number((chip as HTMLElement).dataset.rate) === value);
  }
}

for (const rate of SPEED_PRESETS) {
  const chip = el("button", "", `${1 + rate / 100}×`);
  chip.dataset.rate = String(rate);
  chip.addEventListener("click", () => {
    show("rate", rate);
    setSettings({ rate });
  });
  $("presets").append(chip);
}

for (const key of sliders) {
  const input = $<HTMLInputElement>(key);
  show(key, settings[key]);
  input.addEventListener("input", () => show(key, input.valueAsNumber));
  // Saved on release, not while dragging: every save re-synthesizes the current sentence.
  input.addEventListener("change", () => setSettings({ [key]: input.valueAsNumber }));
}

$("reset").addEventListener("click", () => {
  const { rate, pitch, volume } = defaults;
  setSettings({ rate, pitch, volume });
  for (const key of sliders) show(key, defaults[key]);
});

for (const key of ["wordHighlight", "autoScroll", "clickToRead"] as const) {
  const box = $<HTMLInputElement>(key);
  box.checked = settings[key];
  box.addEventListener("change", () => setSettings({ [key]: box.checked }));
}

// --- voices ----------------------------------------------------------------------------------

const list = $("voice-list");
const search = $<HTMLInputElement>("search");
const opener = $("voice-current");
let current = settings.voice;

const details = (voice: Voice) => `${localeName(voice.Locale)} · ${voice.Gender}`;

function showCurrent(voices: Voice[]) {
  const voice = voices.find((v) => v.ShortName === current);
  $("voice-name").textContent = voice ? voiceName(voice) : current;
  $("voice-detail").textContent = voice ? details(voice) : "";
  $("voice-avatar").textContent = (voice ? voiceName(voice) : current)[0];
}

function renderVoices(voices: Voice[]) {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = groupVoices(voices).flatMap(([language, group]) => {
    const matches = group.filter((voice) => {
      const haystack = [language, voice.ShortName, voice.Gender, ...voice.VoiceTag.VoicePersonalities]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    if (!matches.length) return [];
    return [
      el("div", "group", language),
      ...matches.map((voice) => {
        const row = el("button", "voice");
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(voice.ShortName === current));
        row.dataset.voice = voice.ShortName;
        const name = el("b", "", voiceName(voice));
        row.append(name, el("span", "tag", voice.Gender), el("small", "", voice.VoiceTag.VoicePersonalities.join(", ")));
        return row;
      }),
    ];
  });
  list.replaceChildren(...(rows.length ? rows : [el("div", "empty", "No voice matches.")]));
}

try {
  const voices = await getVoices();
  showCurrent(voices);
  renderVoices(voices);
  search.addEventListener("input", () => renderVoices(voices));

  opener.addEventListener("click", () => {
    const panel = $("voice-panel");
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    panel.inert = !open; // closed is only collapsed, not removed: keep it out of the tab order
    opener.setAttribute("aria-expanded", String(open));
    if (!open) return;
    search.focus({ preventScroll: true });
    // Within the list only: scrollIntoView would also scroll the popup mid-animation.
    const selected = list.querySelector<HTMLElement>("[aria-selected=true]");
    if (selected) list.scrollTop = selected.offsetTop - list.offsetTop - list.clientHeight / 2;
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>(".voice");
    if (!row) return;
    current = row.dataset.voice!;
    setSettings({ voice: current });
    list.querySelector("[aria-selected=true]")?.setAttribute("aria-selected", "false");
    row.setAttribute("aria-selected", "true");
    showCurrent(voices);
  });
} catch (error) {
  $("voice-name").textContent = "Voices unavailable";
  say(`Could not load the voice list: ${(error as Error).message}`);
}
