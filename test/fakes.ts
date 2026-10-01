/**
 * Stand-ins for the extension APIs and the speech library. Preloaded by bunfig.toml because
 * bun's mock.module is process-wide: two test files mocking the same module would clobber
 * each other.
 */
import { mock } from "bun:test";

const area = () => {
  const store: Record<string, unknown> = {};
  return {
    store,
    get: async (keys: string[] | Record<string, unknown>) =>
      Array.isArray(keys)
        ? Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))
        : { ...keys, ...store },
    set: async (items: Record<string, unknown>) => void Object.assign(store, items),
  };
};

export const fakes = {
  local: area(),
  sync: area(),
  /** Set by tests that need storage.onChanged. */
  onChanged: (_changes: unknown, _area: string) => {},
  listVoices: async (): Promise<unknown[]> => [],
  listVoicesCalls: 0,
};

mock.module("wxt/browser", () => ({
  browser: {
    storage: {
      local: fakes.local,
      sync: fakes.sync,
      onChanged: { addListener: (fn: typeof fakes.onChanged) => (fakes.onChanged = fn) },
    },
  },
}));

mock.module("edge-tts-universal/browser", () => ({
  DRM: { generateSecMsGec: async () => "TOKEN" },
  listVoices: () => (fakes.listVoicesCalls++, fakes.listVoices()),
}));
