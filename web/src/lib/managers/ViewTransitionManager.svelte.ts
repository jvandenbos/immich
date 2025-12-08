import { tick } from 'svelte';

interface TransitionRequest {
  types?: string[];
  prepareOldSnapshot?: () => void;
  performUpdate: () => Promise<void>;
  prepareNewSnapshot?: () => void;
  onFinished?: () => void;
}

export class ViewTransitionManager {
  #activeViewTransition = $state<ViewTransition | null>(null);

  get activeViewTransition() {
    return this.#activeViewTransition;
  }

  isSupported() {
    return 'startViewTransition' in document;
  }

  skipTransitions() {
    const skipped = !!this.#activeViewTransition;
    this.#activeViewTransition?.skipTransition();
    this.#activeViewTransition = null;
    return skipped;
  }

  async startTransition({
    types,
    prepareOldSnapshot,
    performUpdate,
    prepareNewSnapshot,
    onFinished,
  }: TransitionRequest) {
    if (this.#activeViewTransition) {
      return;
    }

    if (!this.isSupported()) {
      await performUpdate();
      onFinished?.();
      return;
    }

    prepareOldSnapshot?.();
    await tick();

    let transition: ViewTransition;
    try {
      // eslint-disable-next-line tscompat/tscompat
      transition = document.startViewTransition({
        update: async () => {
          await performUpdate();
          prepareNewSnapshot?.();
          await tick();
        },
        types,
      });
    } catch {
      // eslint-disable-next-line tscompat/tscompat
      transition = document.startViewTransition(async () => {
        await performUpdate();
        prepareNewSnapshot?.();
        await tick();
      });
    }

    this.#activeViewTransition = transition;

    // Let animation run in the background — don't block the caller.
    // This allows skipTransitions() to abort mid-animation for rapid navigation.
    // eslint-disable-next-line tscompat/tscompat
    void transition.finished.finally(() => {
      this.#activeViewTransition = null;
      onFinished?.();
    });

    // Wait only until the DOM update completes (both snapshots captured),
    // not for the animation to finish.
    // eslint-disable-next-line tscompat/tscompat
    await transition.updateCallbackDone;
  }
}

export const viewTransitionManager = new ViewTransitionManager();
