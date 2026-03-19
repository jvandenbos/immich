import { eventManager } from '$lib/managers/event-manager.svelte';
import { viewTransitionManager } from '$lib/managers/ViewTransitionManager.svelte';
import { tick } from 'svelte';

export function startViewerTransition(
  assetId: string,
  navigate: () => void,
  setTransitionId: (id: string | null) => void,
) {
  void viewTransitionManager.startTransition({
    types: ['viewer'],
    prepareOldSnapshot: () => {
      setTransitionId(assetId);
    },
    performUpdate: async () => {
      setTransitionId(null);
      const ready = eventManager.untilNext('TransitionToAssetViewerReady');
      navigate();
      await ready;
      eventManager.emit('TransitionToAssetViewer');
      await tick();
    },
  });
}

export function startMemoryTransition(
  memoryId: string,
  navigate: () => void,
  setTransitionId: (id: string | null) => void,
) {
  void viewTransitionManager.startTransition({
    types: ['memory'],
    prepareOldSnapshot: () => {
      setTransitionId(memoryId);
    },
    performUpdate: async () => {
      setTransitionId(null);
      const ready = eventManager.untilNext('TransitionToAssetViewerReady');
      navigate();
      await ready;
      eventManager.emit('TransitionToAssetViewer');
      await tick();
    },
  });
}

let activeOverlay: HTMLElement | undefined;

export function removeCrossfadeOverlay() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = undefined;
  }
}

export async function crossfadeViewerContent(updateFn: () => void | Promise<void>, duration = 200) {
  const viewerContent = document.querySelector<HTMLElement>('[data-viewer-content]');
  if (!viewerContent) {
    await updateFn();
    return;
  }

  removeCrossfadeOverlay();

  const clone = viewerContent.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    pointerEvents: 'none',
  });
  delete clone.dataset.viewerContent;
  viewerContent.parentElement!.append(clone);
  activeOverlay = clone;

  await updateFn();
  await eventManager.untilNext('TransitionToAssetViewerReady');

  const fadeOut = clone.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  });

  void fadeOut.finished.then(() => {
    clone.remove();
    if (activeOverlay === clone) {
      activeOverlay = undefined;
    }
  });
}
