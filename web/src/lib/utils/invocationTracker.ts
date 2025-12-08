export class InvocationTracker {
  invocationsStarted = 0;
  invocationsEnded = 0;

  startInvocation() {
    this.invocationsStarted++;
    const invocation = this.invocationsStarted;

    return {
      isStillValid: () => invocation === this.invocationsStarted,
      endInvocation: () => {
        this.invocationsEnded = Math.max(this.invocationsEnded, invocation);
      },
    };
  }

  isActive() {
    return this.invocationsStarted !== this.invocationsEnded;
  }

  async invoke<T>(invocable: () => Promise<T>, catchCallback?: (error: unknown) => void, finallyCallback?: () => void) {
    const invocation = this.startInvocation();
    try {
      return await invocable();
    } catch (error: unknown) {
      if (catchCallback) {
        catchCallback(error);
      } else {
        console.error(error);
      }
    } finally {
      invocation.endInvocation();
      finallyCallback?.();
    }
  }
}
