/**
 * The only user data the app keeps, in exactly five `localStorage` keys. When storage is
 * unavailable (a private window, blocked site data, a full quota) the app keeps working
 * in memory and says so once in the console.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const PREFIX = 'gte.v1.';
export const KEYS = {
  dataset: `${PREFIX}dataset`,
  stats: `${PREFIX}stats`,
  answered: `${PREFIX}answered`,
  history: `${PREFIX}history`,
  sound: `${PREFIX}sound`,
} as const;

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => void entries.set(key, value),
    remove: (key) => void entries.delete(key),
  };
}

export function browserStore(): KeyValueStore {
  let local: Storage | null = null;
  try {
    local = window.localStorage;
    const probe = `${PREFIX}probe`;
    local.setItem(probe, '1');
    local.removeItem(probe);
  } catch {
    local = null;
  }
  const memory = new Map<string, string>();
  let warned = false;
  const warn = (reason: unknown) => {
    if (warned) return;
    warned = true;
    console.warn('Guess The Eval: progress cannot be saved in this browser.', reason);
  };
  if (!local) warn('localStorage is unavailable');

  return {
    get(key) {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        return local?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (local) {
        try {
          local.setItem(key, value);
          memory.delete(key);
          return;
        } catch (error) {
          warn(error);
        }
      }
      memory.set(key, value);
    },
    remove(key) {
      memory.delete(key);
      try {
        local?.removeItem(key);
      } catch {
        // Nothing to undo: the key is gone from memory either way.
      }
    },
  };
}

/** `?reset`: forget everything this app has stored. */
export function clearAll(store: KeyValueStore): void {
  for (const key of Object.values(KEYS)) store.remove(key);
}
