// Reset-game protocol. Extracted from main.ts so the wipe can be unit-tested
// without a real location.reload: native confirm blocks the thread, and when
// it returns the 100ms tick driver can still fire before unload. If those
// frames persist the live factory, loadGame finds it after reload and the
// "Reset game" confirm looks like a no-op.

export interface ResetGameDeps {
  confirm(): boolean;
  /** Stop the live clock so days cannot keep advancing during unload. */
  halt(): void;
  clearSave(): void;
  reload(): void;
}

export interface ResetGame {
  onReset(): void;
  savesAllowed(): boolean;
  /** Event-driven and autosave persist; no-op once a wipe is in flight. */
  persist(write: () => void): void;
}

export function createResetGame(deps: ResetGameDeps): ResetGame {
  let wiping = false;
  return {
    savesAllowed: () => !wiping,
    persist(write) {
      if (!wiping) write();
    },
    onReset() {
      if (!deps.confirm()) return;
      wiping = true;
      deps.halt();
      deps.clearSave();
      deps.reload();
    },
  };
}
