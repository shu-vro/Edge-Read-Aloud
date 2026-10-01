import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Edge Read Aloud",
    permissions: ["offscreen", "storage", "contextMenus", "declarativeNetRequestWithHostAccess"],
    host_permissions: ["https://speech.platform.bing.com/*", "wss://speech.platform.bing.com/*"],
    // The speech service answers 403 to anything but Edge; public/rules.json makes our
    // requests to it carry Edge's User-Agent.
    declarative_net_request: {
      rule_resources: [{ id: "edge", enabled: true, path: "rules.json" }],
    },
    commands: {
      "toggle-read": {
        suggested_key: { default: "Alt+R" },
        description: "Start / pause reading the page",
      },
    },
  },
});
