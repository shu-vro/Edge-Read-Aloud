# AGENTS.md

Guidance for coding agents working in this repository. Humans: the README covers use and setup;
this file covers how the code works and the constraints that are not obvious from reading it.

## What this is

A Manifest V3 extension for Chromium browsers, built with [WXT](https://wxt.dev), that reads web
pages aloud through Microsoft Edge's Read Aloud speech service and highlights the words as they
are spoken. Plain TypeScript, no UI framework. One runtime dependency (`edge-tts-universal`), of
which only the token generator and the voice list are used.

## Commands

```sh
bun install
bun run build       # production build -> .output/chrome-mv3
bun run dev         # watch mode, opens a browser
bun run zip         # build and zip -> .output/*-chrome.zip
bun run typecheck   # tsc --noEmit
bun test            # lib/align.test.ts
```

Run `bun run typecheck` and `bun test` before calling a change done. For anything that affects
reading, highlighting or audio, also check it in a real browser (see Testing).

## Architecture

Three contexts. The content script and the offscreen document talk directly over a
`chrome.runtime` port named `reader`; the background worker is not in that path.

| Context | File | Owns |
| --- | --- | --- |
| Content script | `entrypoints/content/index.ts` | Sentence list, current index, highlights, click-to-read, scroll following, the floating player (`player.ts`) |
| Offscreen document | `entrypoints/offscreen/main.ts` | Speech requests, audio, sentence queue and prefetch, clip cache |
| Background worker | `entrypoints/background.ts` | Creating the offscreen document, the `Alt+R` command, the context menu |
| Popup | `entrypoints/popup/` | Controls and settings; sends commands to the active tab's content script |

Message types for all of these are in `lib/messages.ts`. Settings live in `chrome.storage.sync`
(`lib/settings.ts`).

Flow of one sentence: the content script extracts sentences (`lib/extract.ts`) and sends their
texts with `load`. The offscreen document synthesizes a sentence (`lib/tts.ts`), aligns the
returned word boundaries to character offsets (`lib/align.ts`), plays it, and posts `play` with
the word timings. The content script then moves the word highlight on its own
`requestAnimationFrame` clock, anchored to the position reported in `play`. There is no
message per word.

## Constraints to respect

Each of these was learned the hard way. Do not undo one without reproducing the original
problem first.

**The speech service**

- It answers `403` unless the `User-Agent` is Edge's. `Origin` does not matter. Page JavaScript
  cannot set `User-Agent` on a WebSocket, so `public/rules.json` rewrites it with
  `declarativeNetRequest`. That needs the `wss://` host permission as well as `https://`.
- The Edge version appears in two places that must agree: `GEC_VERSION` in `lib/tts.ts` and the
  `User-Agent` in `public/rules.json`. When synthesis starts failing with a refused connection,
  this version (or the token scheme in `edge-tts-universal`) is the first thing to check.
- It queues clients that send bursts of requests, delaying responses by seconds. Prefetch is
  therefore two sentences ahead, one request at a time, started only after the current sentence
  has arrived. Do not parallelize it or deepen it.
- A handshake costs about twice what synthesizing a sentence does. `lib/tts.ts` keeps sockets
  open and sends consecutive requests on them. A reused socket that has gone stale is retried
  once on a fresh one.
- This is an undocumented endpoint. Keep load light and do not add features that would hammer it
  (bulk export, whole-page pre-synthesis).

**Audio**

- Audio and the WebSocket live in the offscreen document because a page's CSP would block them
  in a content script, and a service worker cannot play sound.
- The offscreen document only has `chrome.runtime`. No `chrome.storage`, no `chrome.tabs`.
  Settings reach it inside the `load` and `settings` messages.
- The browser closes an `AUDIO_PLAYBACK` offscreen document after about 30 seconds of silence.
  The content script handles the port disconnecting and reconnects on the next play.
- Playback uses one `AudioContext` that keeps running between sentences, with each clip
  scheduled as an `AudioBufferSourceNode`. An earlier version used an `<audio>` element per
  sentence; that swallowed the start of each clip while the output restarted and cut the last
  word, because its clock lags the wall clock. Do not go back to a media element per sentence.
- Every clip from the service ends with close to a second of silence. Clips are played only up
  to the last word's end plus `SENTENCE_GAP`.
- `play.time` is offset by `AudioContext.outputLatency` so the highlight matches what is heard.

**The page**

- Highlighting uses the CSS Custom Highlight API (`CSS.highlights`, `::highlight()`), which
  marks `Range`s without touching the DOM. Never wrap page text in elements: it breaks
  framework-rendered pages. The cost is that highlights cannot be animated.
- Highlight styles are in `entrypoints/content/style.css`, injected through the manifest. The
  floating player uses a constructed stylesheet in a closed shadow root. Both choices exist
  because a strict page CSP blocks inline `<style>` elements. Build the player's DOM with DOM
  APIs, not `innerHTML`, for pages that enforce Trusted Types.
- In `lib/extract.ts`, a sentence's text has the same length as the page text it came from
  (whitespace is replaced character for character, never collapsed). Word offsets from
  `lib/align.ts` depend on that to map back to DOM positions.
- Word boundaries from the service carry the word but not its position, so `align` searches
  forward from the previous match and gives up on a word rather than jump far ahead. Numbers and
  symbols the voice expands may not match; those words simply get no highlight.
- Clicks only start a jump while the reader is active, never on links or form controls, and
  never when the user is selecting text.
- Scrolling follows the reading only if the previous sentence was still on screen. A user who
  has scrolled away is shown the "Go to reading" button instead of being pulled back.

## Conventions

- WXT auto-imports `browser`, `defineBackground`, `defineContentScript` in entrypoints. Files in
  `lib/` import `browser` from `wxt/browser` explicitly.
- `@/` resolves to the repository root.
- Keep it small: no framework, no new dependency for something a few lines or a native browser
  feature can do.
- Comments explain why, not what. Deliberate shortcuts are marked with a `ponytail:` comment
  naming the limit and the upgrade path.
- All motion in the UI must be disabled under `prefers-reduced-motion`.

## Testing

Unit tests cover alignment and sentence splitting only. Everything else needs a browser.

Load the build into a throwaway profile, never the user's own:

```sh
bun run build
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --user-data-dir=/tmp/tts-profile --remote-debugging-port=9333 \
  --load-extension="$PWD/.output/chrome-mv3" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --no-first-run https://en.wikipedia.org/wiki/Speech_synthesis
```

Then drive it over the DevTools protocol on port 9333:

- Send commands by evaluating in the service worker target:
  `chrome.tabs.query({active:true}).then(([t]) => chrome.tabs.sendMessage(t.id, {cmd:"toggle"}))`.
  Commands are `toggle`, `stop`, `prev`, `next`, `here`, `status`.
- Read the highlight from the page's main world:
  `[...CSS.highlights.get("edge-tts-word")][0]?.toString()` (also `edge-tts-sentence`).
- The page must be visible (`Page.bringToFront`) or `requestAnimationFrame` does not run and the
  word highlight will not move.
- Attach to the offscreen target with `Runtime.enable` and `Network.enable` to see its console
  and the WebSocket handshake.

Space test runs out. Repeated runs in quick succession trigger the service's throttling and
make latency numbers meaningless for a while.

## Releases

`.github/workflows/release.yml` runs on every push to the `release` branch. It takes the highest
`vX.Y.Z` tag, adds one to the patch number (or starts at `v1.0.0`), writes that into
`package.json` for the build, and publishes a GitHub release with `edge-read-aloud-vX.Y.Z.zip`.
The version in the committed `package.json` is not used for releases; leave it alone.
