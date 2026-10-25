/**
 * Reliable, ordered autosave for the Visual Designer.
 *
 * - One write in flight per document; newer edits wait and coalesce, so a
 *   slow older write can never land after (and overwrite) a newer one.
 * - Only the latest snapshot of each document is written.
 * - A failed write keeps the snapshot as pending and reports "error" until
 *   `retry()` (or the next edit) succeeds. Nothing is dropped silently.
 */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type SaveQueueState = {
  status: SaveStatus;
  error?: string;
  lastSavedAt?: number;
};

type Entry<T> = {
  pending?: T;
  inFlight: boolean;
  timer?: ReturnType<typeof setTimeout>;
  error?: string;
};

export function createSaveQueue<T>(options: {
  save: (key: string, doc: T) => Promise<void>;
  onChange?: (state: SaveQueueState) => void;
  debounceMs?: number;
  now?: () => number;
}) {
  const entries = new Map<string, Entry<T>>();
  const waiters: Array<() => void> = [];
  const debounceMs = options.debounceMs ?? 400;
  const now = options.now ?? (() => Date.now());
  let lastSavedAt: number | undefined;

  const entry = (key: string) => {
    let current = entries.get(key);
    if (!current) {
      current = { inFlight: false };
      entries.set(key, current);
    }
    return current;
  };

  const state = (): SaveQueueState => {
    let error: string | undefined;
    let saving = false;
    let pending = false;
    for (const item of entries.values()) {
      if (item.error) error = item.error;
      if (item.inFlight) saving = true;
      if (item.pending !== undefined) pending = true;
    }
    if (error) return { status: "error", error, lastSavedAt };
    if (saving) return { status: "saving", lastSavedAt };
    if (pending) return { status: "pending", lastSavedAt };
    return { status: lastSavedAt ? "saved" : "idle", lastSavedAt };
  };

  const notify = () => {
    options.onChange?.(state());
    const s = state();
    if (s.status === "saved" || s.status === "idle" || s.status === "error") {
      while (waiters.length) waiters.shift()?.();
    }
  };

  const run = async (key: string) => {
    const item = entry(key);
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = undefined;
    }
    if (item.inFlight || item.pending === undefined) return;
    const doc = item.pending;
    item.pending = undefined;
    item.inFlight = true;
    notify();
    try {
      await options.save(key, doc);
      item.error = undefined;
      lastSavedAt = now();
    } catch (err) {
      // Keep the failed snapshot unless a newer edit already replaced it.
      if (item.pending === undefined) item.pending = doc;
      item.error = err instanceof Error ? err.message : String(err);
    } finally {
      item.inFlight = false;
    }
    if (item.pending !== undefined && !item.error) {
      await run(key);
      return;
    }
    notify();
  };

  return {
    /** Queue the latest full snapshot of `key`. */
    enqueue(key: string, doc: T, opts?: { immediate?: boolean }) {
      const item = entry(key);
      item.pending = doc;
      item.error = undefined;
      if (item.timer) clearTimeout(item.timer);
      if (opts?.immediate || debounceMs <= 0) {
        void run(key);
      } else {
        item.timer = setTimeout(() => void run(key), debounceMs);
      }
      notify();
    },
    /** Write everything pending now; resolves when the queue settles. */
    flush(): Promise<SaveQueueState> {
      const keys = [...entries.keys()];
      keys.forEach((key) => {
        const item = entry(key);
        if (item.error) item.error = undefined;
        void run(key);
      });
      return new Promise((resolve) => {
        const s = state();
        if (s.status === "saved" || s.status === "idle" || s.status === "error") {
          resolve(s);
          return;
        }
        waiters.push(() => resolve(state()));
      });
    },
    /** Drop pending writes for documents that are being deleted. */
    discard(predicate: (key: string) => boolean) {
      for (const [key, item] of entries) {
        if (!predicate(key)) continue;
        if (item.timer) clearTimeout(item.timer);
        item.timer = undefined;
        item.pending = undefined;
        item.error = undefined;
        if (!item.inFlight) entries.delete(key);
      }
      notify();
    },
    retry() {
      return this.flush();
    },
    hasUnsaved() {
      for (const item of entries.values()) {
        if (item.inFlight || item.pending !== undefined) return true;
      }
      return false;
    },
    getState: state,
  };
}

export type DesignerSaveQueue<T> = ReturnType<typeof createSaveQueue<T>>;
