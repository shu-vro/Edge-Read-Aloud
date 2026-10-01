# Edge Read Aloud

A browser extension that reads web pages aloud with Microsoft Edge's neural voices, highlighting
each word as it is spoken. Works in Chromium browsers: Chrome, Brave, Edge, Arc, Vivaldi, Opera.

- **Follows along on the page.** The sentence being read is tinted and the current word is marked.
- **Click to read from there.** While it is reading, click any text and it jumps to that sentence.
- **Every Edge voice.** Over 300 voices in more than 140 languages and regions, searchable by
  language, name, gender and style.
- **Speed, pitch and volume.** 0.5× to 2× speed, pitch up or down, louder or quieter.
- **Stays out of your way.** Scroll elsewhere and it keeps reading without dragging you back; a
  button in the player takes you to the current sentence when you want it.

It is free and needs no account or API key. It is not published in the Chrome Web Store, so you
install it by hand, which takes a minute.

## Install

1. Open the **Releases** page of this repository and download the latest
   `edge-read-aloud-vX.Y.Z.zip`.
2. Open the extensions page of your browser: `chrome://extensions`, `brave://extensions` or
   `edge://extensions`.
3. Turn on **Developer mode** (a switch on that page, top right in Chrome and Brave).
4. Drag the downloaded zip onto the page.

If dragging the zip does nothing in your browser, unzip it, click **Load unpacked** on the same
page and choose the unzipped folder. Keep that folder: the browser loads the extension from it
every time it starts.

Tabs that were already open need a reload before the extension works in them.

**Updating:** download the newer zip and repeat the steps. With the unzipped-folder method,
replace the folder's contents and press the reload arrow on the extension's card.

The browser may remind you now and then that a developer-mode extension is installed. That is
expected for anything installed outside the store.

## Use

| To | Do this |
| --- | --- |
| Start or pause reading | Click the toolbar icon and press play, or press <kbd>Alt</kbd>+<kbd>R</kbd> |
| Read from a particular spot | Right-click the text and choose **Read aloud from here** |
| Jump while it is reading | Click any sentence on the page |
| Skip back or forward a sentence | The arrows in the popup or in the player at the bottom right of the page |
| Change voice, speed, pitch, volume | The popup. Changes apply straight away, mid-sentence |
| Get back to the sentence being read | **Go to reading** in the player, shown when you have scrolled away |
| Stop | ✕ in the player, or the stop button in the popup |

Reading starts at your text selection if there is one, otherwise at the first sentence on screen.

The popup also has switches for word highlighting, scrolling along with the reading, and
click-to-read. If <kbd>Alt</kbd>+<kbd>R</kbd> is taken by something else, set another shortcut at
`chrome://extensions/shortcuts`.

## Good to know

- **It needs the internet.** Speech is synthesized by Microsoft's servers. The text of each
  sentence being read is sent to `speech.platform.bing.com`; nothing else is sent anywhere, and
  nothing is sent until you start reading.
- **It relies on an unofficial service.** This is the same endpoint Edge's own Read Aloud uses.
  It is not a documented public API, so Microsoft could change it and break the extension until it
  is updated. This project is not affiliated with Microsoft.
- **It cannot read** PDFs, content inside embedded frames, the browser's own pages
  (`chrome://…`), or the Chrome Web Store.
- **Starting takes about a second** the first time; after that, moving between sentences is
  close to instant.

## Contributing

You need [Bun](https://bun.sh).

```sh
bun install
bun run dev        # builds, opens a browser with the extension loaded, reloads on change
bun run build      # production build in .output/chrome-mv3
bun test           # unit tests
bun run typecheck
```

To try a build in your own browser, use **Load unpacked** on `.output/chrome-mv3`. After
rebuilding, press the reload arrow on the extension's card and reload the tab.

### How it is put together

```
content script   ── runtime port ──▶   offscreen document         background worker
finds the text,                        talks to the speech         opens the offscreen
highlights, handles                    service, plays audio,       document, keyboard
clicks, shows player                   queues sentences            shortcut, context menu
```

| Path | What it does |
| --- | --- |
| `entrypoints/content/` | Runs in the page: highlighting, click-to-read, the floating player |
| `entrypoints/offscreen/` | The audio player and sentence queue |
| `entrypoints/background.ts` | Creates the offscreen document; shortcut and context menu |
| `entrypoints/popup/` | The toolbar popup |
| `lib/extract.ts` | Turns a page into sentences that map back to positions in the page |
| `lib/align.ts` | Matches the service's word timings to characters in the sentence |
| `lib/tts.ts` | The WebSocket client for the speech service |
| `lib/voices.ts`, `lib/settings.ts` | Voice list and stored settings |
| `public/rules.json` | Makes requests to the speech service look like they come from Edge |

[AGENTS.md](AGENTS.md) explains why it is built this way and what not to undo. It is written
for coding agents but is the best place for a human contributor to start too.

### Pull requests

Keep them small and say what you tested and in which browser. `bun test` and `bun run typecheck`
must pass. Changes to reading, highlighting or audio need a manual check on a real page, since
the unit tests only cover text alignment and sentence splitting.

### Releases

Pushing to the `release` branch publishes a GitHub release with the installable zip. The first
is `v1.0.0`; each later push raises the patch number (`v1.0.1`, `v1.0.2`, …). To release what is
on `main`:

```sh
git push origin main:release
```

For a new minor or major version, create that tag by hand once (for example `v1.1.0`); later
releases count up from the highest existing tag.
