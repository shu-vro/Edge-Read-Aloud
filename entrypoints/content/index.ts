import "./style.css";
import { wordAt, type Word } from "@/lib/align";
import { extract, locate, rangeOf, type Sentence } from "@/lib/extract";
import { PORT_NAME, type Command, type FromPlayer, type Status, type ToPlayer } from "@/lib/messages";
import { getSettings, onSettings, setSettings } from "@/lib/settings";
import { createPlayer } from "./player";

/** Clicks on these are the page's business, never a "read from here". */
const INTERACTIVE = "a,button,input,textarea,select,label,summary,[contenteditable],[role=button]";

export default defineContentScript({
  matches: ["<all_urls>"],
  async main() {
    let settings = await getSettings();
    let sentences: Sentence[] = [];
    let index = 0;
    /** What the user asked for; true while a sentence is still loading. */
    let playing = false;
    let error: string | undefined;
    let port: Browser.runtime.Port | undefined;

    // Word timing runs on this page's clock, anchored to the audio position the player last
    // reported, so the highlight moves every frame without a message per word.
    let words: Word[] = [];
    let anchor: { time: number; at: number } | undefined;
    let shownWord = -1;
    /** Where the sentence being read is on the page. */
    let currentRange: Range | undefined;
    /**
     * Characters and seconds of speech heard so far, at 1×, for the time-left estimate. Measured
     * rather than assumed: pace per character differs threefold between English and Japanese.
     */
    const heard = { chars: 0, seconds: 0, index: -1 };

    const sentenceMark = new Highlight();
    const wordMark = new Highlight();
    const hoverMark = new Highlight();
    wordMark.priority = 1;
    CSS.highlights.set("edge-tts-hover", hoverMark);
    CSS.highlights.set("edge-tts-sentence", sentenceMark);
    CSS.highlights.set("edge-tts-word", wordMark);

    const player = createPlayer({
      toggle,
      reveal,
      stop,
      prev: () => play(index - 1),
      next: () => play(index + 1),
      speed: (delta) =>
        setSettings({ rate: Math.max(-50, Math.min(100, settings.rate + delta)) }),
    });
    const refresh = () =>
      player.update({ playing, rate: settings.rate, error, away: !onScreen(currentRange), left: timeLeft() });

    /** Rough time to read from the current sentence to the end of what is being read. */
    function timeLeft(): string {
      if (heard.seconds < 5) return ""; // one short clip is too noisy to go on
      let chars = 0;
      for (let i = index; i < sentences.length; i++) chars += sentences[i].text.length;
      const seconds = (chars * heard.seconds) / heard.chars / (1 + settings.rate / 100);
      const minutes = Math.round(seconds / 60);
      if (minutes < 1) return `${Math.max(1, Math.round(seconds))} s`;
      return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    }

    function onScreen(range: Range | undefined): boolean {
      if (!range) return true;
      const box = range.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight;
    }

    /** Bring the sentence being read to the middle of whatever scrolls it. */
    function reveal() {
      if (!currentRange) return;
      const box = currentRange.getBoundingClientRect();
      let scroller = currentRange.startContainer.parentElement;
      while (scroller && scroller !== document.documentElement) {
        const scrolls = /auto|scroll/.test(getComputedStyle(scroller).overflowY);
        if (scrolls && scroller.scrollHeight > scroller.clientHeight) break;
        scroller = scroller.parentElement;
      }
      const top = box.top + box.height / 2 - innerHeight / 2;
      (scroller && scroller !== document.documentElement ? scroller : window).scrollBy({
        top,
        behavior: "smooth",
      });
    }

    /**
     * `jumped` is true when the user chose this sentence. Otherwise reading simply moved on,
     * and the page only follows if the reader was still looking at the previous sentence:
     * someone who has scrolled away is not dragged back, they get a button instead.
     */
    function showSentence(i: number, jumped = false) {
      const following = jumped || onScreen(currentRange);
      index = i;
      words = [];
      anchor = undefined;
      shownWord = -1;
      wordMark.clear();
      sentenceMark.clear();
      currentRange = rangeOf(sentences[i]);
      sentenceMark.add(currentRange);
      if (!settings.autoScroll || !following) return;
      const box = currentRange.getBoundingClientRect();
      if (box.top < 80 || box.bottom > innerHeight - 120) reveal();
    }

    function tick() {
      if (!anchor) return;
      const time = anchor.time + (performance.now() - anchor.at) / 1000;
      const i = wordAt(words, time);
      if (i !== shownWord) {
        shownWord = i;
        const word = words[i];
        if (word && word.from >= 0 && settings.wordHighlight) {
          wordMark.clear();
          wordMark.add(rangeOf(sentences[index], word.from, word.to));
        }
      }
      requestAnimationFrame(tick);
    }

    function onPlayerMessage(message: FromPlayer) {
      if (!sentences.length) return;
      switch (message.t) {
        case "loading":
          if (message.index !== index) showSentence(message.index);
          break;
        case "play":
          if (message.index !== index) showSentence(message.index);
          words = message.words;
          error = undefined;
          // Each clip shows how fast this voice speaks this text.
          if (heard.index !== index && words.at(-1)?.end) {
            heard.index = index;
            heard.chars += sentences[index].text.length;
            heard.seconds += words.at(-1)!.end * (1 + settings.rate / 100);
          }
          if (!anchor) requestAnimationFrame(tick);
          anchor = { time: message.time, at: performance.now() };
          break;
        case "paused":
          anchor = undefined;
          break;
        case "end":
          return stop();
        case "error":
          anchor = undefined;
          playing = false;
          error = message.message;
          break;
      }
      refresh();
    }

    const post = (message: ToPlayer) => port?.postMessage(message);

    /** Start speaking at sentence `i`, (re)connecting to the player if it has gone away. */
    async function play(i: number) {
      if (!sentences.length) return;
      showSentence(Math.max(0, Math.min(sentences.length - 1, i)), true);
      playing = true;
      error = undefined;
      refresh();
      if (port) return post({ t: "seek", index });
      try {
        // The offscreen player is closed by the browser after a while of silence.
        await browser.runtime.sendMessage({ cmd: "offscreen" });
        port = browser.runtime.connect({ name: PORT_NAME });
      } catch {
        return stop(); // extension was reloaded; this content script is orphaned
      }
      port.onMessage.addListener(onPlayerMessage);
      port.onDisconnect.addListener(() => {
        port = undefined;
        anchor = undefined;
        playing = false;
        refresh();
      });
      post({ t: "load", texts: sentences.map((s) => s.text), index, settings });
    }

    /** Re-reads the page every time: it may have changed (a chat answer arrived) since the last start. */
    function start(from: Range | undefined) {
      sentences = extract(from);
      if (!sentences.length) return;
      player.show();
      const i = from?.collapsed ? locate(sentences, from.startContainer, from.startOffset) : from ? 0 : -1;
      play(i >= 0 ? i : firstVisible());
    }

    function toggle() {
      if (!sentences.length) return start(pointed());
      if (!port) return void play(index);
      playing = !playing;
      post({ t: playing ? "resume" : "pause" });
      refresh();
    }

    function stop() {
      post({ t: "stop" });
      port?.disconnect();
      port = undefined;
      sentences = [];
      playing = false;
      anchor = undefined;
      error = undefined;
      currentRange = undefined;
      sentenceMark.clear();
      wordMark.clear();
      hoverMark.clear();
      player.hide();
    }

    const firstVisible = () =>
      Math.max(0, sentences.findIndex((s) => rangeOf(s).getBoundingClientRect().bottom > 0));

    /**
     * What the user selected, or the caret a tap on text left behind. A caret that has since
     * scrolled out of view is stale, so reading starts on screen instead.
     */
    function pointed(): Range | undefined {
      const selection = getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      return !range.collapsed || onScreen(range) ? range : undefined;
    }

    function caretAt(x: number, y: number): Range | undefined {
      const caret = document.caretPositionFromPoint?.(x, y);
      if (!caret) return document.caretRangeFromPoint(x, y) ?? undefined;
      const range = document.createRange();
      range.setStart(caret.offsetNode, caret.offset);
      return range;
    }

    /** The sentence under a viewport point, or -1 when the point is not on its text. */
    function sentenceAtPoint(x: number, y: number): number {
      const caret = caretAt(x, y);
      const i = locate(sentences, caret?.startContainer, caret?.startOffset ?? 0);
      if (i < 0) return -1;
      // The caret snaps to the nearest text even from empty space, so check the pointer is on it.
      const hit = [...rangeOf(sentences[i]).getClientRects()].some(
        (r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4,
      );
      return hit ? i : -1;
    }

    const clickable = (event: MouseEvent) =>
      sentences.length > 0 &&
      settings.clickToRead &&
      event.target instanceof Element &&
      !player.host.contains(event.target) &&
      !event.target.closest(INTERACTIVE);

    document.addEventListener(
      "click",
      (event) => {
        if (!clickable(event) || event.button !== 0) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!getSelection()?.isCollapsed) return; // the user was selecting text
        const i = sentenceAtPoint(event.clientX, event.clientY);
        if (i >= 0) play(i);
      },
      true,
    );

    let hoverFrame = 0;
    document.addEventListener("mousemove", (event) => {
      if (!sentences.length || hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        hoverMark.clear();
        if (!clickable(event)) return;
        const i = sentenceAtPoint(event.clientX, event.clientY);
        if (i >= 0 && i !== index) hoverMark.add(rangeOf(sentences[i]));
      });
    });

    // Scrolling away from, or back to, the sentence being read toggles the player's jump button.
    let scrollFrame = 0;
    document.addEventListener(
      "scroll",
      () => {
        if (!sentences.length || scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          refresh();
        });
      },
      { capture: true, passive: true },
    );

    let menuPoint = { x: 0, y: 0 };
    document.addEventListener(
      "contextmenu",
      (event) => (menuPoint = { x: event.clientX, y: event.clientY }),
      true,
    );

    onSettings((next) => {
      settings = next;
      if (!settings.wordHighlight) wordMark.clear();
      post({ t: "settings", settings });
      refresh();
    });

    browser.runtime.onMessage.addListener((message: Command, _sender, respond) => {
      switch (message.cmd) {
        case "toggle":
          toggle();
          break;
        case "stop":
          stop();
          break;
        case "prev":
          play(index - 1);
          break;
        case "next":
          play(index + 1);
          break;
        case "here":
          start(caretAt(menuPoint.x, menuPoint.y) ?? pointed());
          break;
      }
      respond({ active: sentences.length > 0, playing } satisfies Status);
    });
  },
});
