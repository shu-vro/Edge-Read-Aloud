import type { Command } from "@/lib/messages";

export default defineBackground(() => {
  let creating: Promise<void> | undefined;

  // Audio and the speech WebSocket live in an offscreen document: a page's CSP cannot block
  // them there, and unlike this service worker it can play sound.
  async function ensureOffscreen() {
    if (await browser.offscreen.hasDocument()) return;
    creating ??= browser.offscreen
      .createDocument({
        url: "/offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Plays synthesized speech for the page being read.",
      })
      .finally(() => (creating = undefined));
    await creating;
  }

  browser.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.cmd !== "offscreen") return;
    ensureOffscreen().then(
      () => respond(true),
      (error) => respond({ error: String(error) }),
    );
    return true;
  });

  const tell = (tabId: number | undefined, cmd: Command["cmd"]) => {
    if (tabId !== undefined) browser.tabs.sendMessage(tabId, { cmd }).catch(() => {});
  };

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === "toggle-read") tell(tab?.id, "toggle");
  });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "read-here",
      title: "Read aloud from here",
      contexts: ["page", "selection"],
    });
  });
  browser.contextMenus.onClicked.addListener((_info, tab) => tell(tab?.id, "here"));
});
