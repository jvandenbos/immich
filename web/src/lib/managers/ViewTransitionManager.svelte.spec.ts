import { ViewTransitionManager } from '$lib/managers/ViewTransitionManager.svelte';

describe('ViewTransitionManager', () => {
  let manager: ViewTransitionManager;

  beforeEach(() => {
    manager = new ViewTransitionManager();
  });

  afterEach(() => {
    delete (document as Partial<typeof document> & { startViewTransition?: unknown }).startViewTransition;
  });

  describe('when View Transition API is not supported', () => {
    it('should still call performUpdate', async () => {
      const performUpdate = vi.fn().mockResolvedValue(undefined);

      await manager.startTransition({ performUpdate });

      expect(performUpdate).toHaveBeenCalledOnce();
    });

    it('should call onFinished after performUpdate', async () => {
      const callOrder: string[] = [];
      const performUpdate = vi.fn().mockImplementation(() => {
        callOrder.push('performUpdate');
      });
      const onFinished = vi.fn().mockImplementation(() => {
        callOrder.push('onFinished');
      });

      await manager.startTransition({ performUpdate, onFinished });

      expect(onFinished).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['performUpdate', 'onFinished']);
    });

    it('should not call prepareOldSnapshot or prepareNewSnapshot', async () => {
      const prepareOldSnapshot = vi.fn();
      const prepareNewSnapshot = vi.fn();
      const performUpdate = vi.fn().mockResolvedValue(undefined);

      await manager.startTransition({ performUpdate, prepareOldSnapshot, prepareNewSnapshot });

      expect(prepareOldSnapshot).not.toHaveBeenCalled();
      expect(prepareNewSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('when a transition is already active', () => {
    it('should skip the second transition', async () => {
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      let resolveUpdate!: () => void;
      const updateCallbackDone = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });

      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone, finished, skipTransition: vi.fn() };
      });

      const secondPerformUpdate = vi.fn().mockResolvedValue(undefined);

      // Start first — it will be blocked on updateCallbackDone
      const firstPromise = manager.startTransition({
        performUpdate: async () => {},
      });

      // Flush microtasks so the first transition reaches the startViewTransition call
      await new Promise<void>((r) => queueMicrotask(r));

      // While first is active, try a second — should be skipped
      await manager.startTransition({ performUpdate: secondPerformUpdate });
      expect(secondPerformUpdate).not.toHaveBeenCalled();

      // Clean up
      resolveUpdate();
      resolveFinished();
      await firstPromise;
    });
  });

  describe('skipTransitions', () => {
    it('should return false when no transition is active', () => {
      expect(manager.skipTransitions()).toBe(false);
    });

    it('should call skipTransition on the active transition and return true', async () => {
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      let resolveUpdate!: () => void;
      const updateCallbackDone = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });
      const skipTransition = vi.fn();

      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone, finished, skipTransition };
      });

      const promise = manager.startTransition({ performUpdate: async () => {} });
      await new Promise<void>((r) => queueMicrotask(r));

      const skipped = manager.skipTransitions();
      expect(skipped).toBe(true);
      expect(skipTransition).toHaveBeenCalledOnce();

      resolveUpdate();
      resolveFinished();
      await promise;
    });

    it('should allow a new transition after skipping', async () => {
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      let resolveUpdate!: () => void;
      const updateCallbackDone = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });

      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone, finished, skipTransition: vi.fn() };
      });

      const promise = manager.startTransition({ performUpdate: async () => {} });
      await new Promise<void>((r) => queueMicrotask(r));

      manager.skipTransitions();
      resolveUpdate();
      resolveFinished();
      await promise;

      // Now start a second transition — it should NOT be skipped
      const secondUpdate = vi.fn().mockResolvedValue(undefined);
      const secondFinished = Promise.resolve();
      const secondUpdateDone = Promise.resolve();

      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone: secondUpdateDone, finished: secondFinished, skipTransition: vi.fn() };
      });

      await manager.startTransition({ performUpdate: secondUpdate });
      expect(secondUpdate).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should propagate error from performUpdate when API is not supported', async () => {
      const error = new Error('update failed');
      const performUpdate = vi.fn().mockRejectedValue(error);

      await expect(manager.startTransition({ performUpdate })).rejects.toThrow('update failed');
    });

    it('should clean up activeViewTransition when performUpdate throws (API supported)', async () => {
      const error = new Error('update failed');
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });

      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        const updateCallbackDone = updateFn();
        return { updateCallbackDone, finished, skipTransition: vi.fn() };
      });

      await expect(manager.startTransition({ performUpdate: () => Promise.reject(error) })).rejects.toThrow(
        'update failed',
      );

      // Simulate transition finishing after error
      resolveFinished();
      await new Promise<void>((r) => queueMicrotask(r));

      // Manager should accept new transitions after cleanup
      const secondUpdate = vi.fn().mockResolvedValue(undefined);
      const secondFinished = Promise.resolve();
      const secondUpdateDone = Promise.resolve();
      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone: secondUpdateDone, finished: secondFinished, skipTransition: vi.fn() };
      });

      await manager.startTransition({ performUpdate: secondUpdate });
      expect(secondUpdate).toHaveBeenCalledOnce();
    });
  });

  describe('fallback path', () => {
    it('should fall back to function argument when object argument throws', async () => {
      const performUpdate = vi.fn().mockResolvedValue(undefined);
      const prepareNewSnapshot = vi.fn();
      const finished = Promise.resolve();
      const updateCallbackDone = Promise.resolve();

      let callCount = 0;
      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn().mockImplementation((arg: unknown) => {
        callCount++;
        if (callCount === 1 && typeof arg !== 'function') {
          throw new TypeError('object form not supported');
        }
        const updateFn = typeof arg === 'function' ? arg : (arg as { update: () => Promise<void> }).update;
        void updateFn();
        return { updateCallbackDone, finished, skipTransition: vi.fn() };
      });

      await manager.startTransition({ performUpdate, prepareNewSnapshot, types: ['test'] });

      expect(performUpdate).toHaveBeenCalledOnce();
      expect(prepareNewSnapshot).toHaveBeenCalledOnce();
      // eslint-disable-next-line tscompat/tscompat
      expect(document.startViewTransition).toHaveBeenCalledTimes(2);
    });
  });

  describe('isSupported', () => {
    it('should return false when startViewTransition is not in document', () => {
      expect(manager.isSupported()).toBe(false);
    });

    it('should return true when startViewTransition is in document', () => {
      // eslint-disable-next-line tscompat/tscompat
      document.startViewTransition = vi.fn();

      expect(manager.isSupported()).toBe(true);
    });
  });
});
