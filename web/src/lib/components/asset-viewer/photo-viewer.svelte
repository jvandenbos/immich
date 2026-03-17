<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import { thumbhash } from '$lib/actions/thumbhash';
  import { zoomImageAction } from '$lib/actions/zoom-image';
  import AdaptiveImage from '$lib/components/AdaptiveImage.svelte';
  import FaceEditor from '$lib/components/asset-viewer/face-editor/face-editor.svelte';
  import OcrBoundingBox from '$lib/components/asset-viewer/ocr-bounding-box.svelte';
  import AssetViewerEvents from '$lib/components/AssetViewerEvents.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { castManager } from '$lib/managers/cast-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { viewTransitionManager } from '$lib/managers/ViewTransitionManager.svelte';
  import { isFaceEditMode } from '$lib/stores/face-edit.svelte';
  import { ocrManager } from '$lib/stores/ocr.svelte';
  import { boundingBoxesArray, type Faces } from '$lib/stores/people.store';
  import { SlideshowLook, SlideshowState, slideshowStore } from '$lib/stores/slideshow.store';
  import { handlePromiseError } from '$lib/utils';
  import { canCopyImageToClipboard, copyImageToClipboard } from '$lib/utils/asset-utils';
  import { scaleToCover, scaleToFit, type Size } from '$lib/utils/container-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { KenBurnsAnimation } from '$lib/utils/ken-burns';
  import { getOcrBoundingBoxes } from '$lib/utils/ocr-utils';
  import { getBoundingBox } from '$lib/utils/people-utils';
  import { type SharedLinkResponseDto } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
  import { t } from 'svelte-i18n';
  import type { AssetCursor } from './asset-viewer.svelte';

  interface Props {
    cursor: AssetCursor;
    element?: HTMLDivElement;
    sharedLink?: SharedLinkResponseDto;
    transitionName?: string;
    letterboxTransitionName?: string;
    onError?: () => void;
    onSwipe?: (event: SwipeCustomEvent) => void;
  }

  let {
    cursor,
    element = $bindable(),
    sharedLink,
    transitionName,
    letterboxTransitionName,
    onError,
    onSwipe,
  }: Props = $props();

  const { slideshowState, slideshowLook, kenBurnsEffect, slideshowDelay } = slideshowStore;
  const asset = $derived(cursor.current);

  let visibleImageReady: boolean = $state(false);
  const kenBurns = new KenBurnsAnimation();
  let adaptiveImage = $state<HTMLDivElement | undefined>();
  onMount(() =>
    eventManager.on({
      ViewTransitionOldSnapshotPending: () => kenBurns.freeze(),
    }),
  );

  let previousAssetId: string | undefined;
  $effect.pre(() => {
    const id = asset.id;
    if (id === previousAssetId) {
      return;
    }
    previousAssetId = id;
    untrack(() => {
      kenBurns.cancel();
      assetViewerManager.resetZoomState();
      visibleImageReady = false;
      $boundingBoxesArray = [];
      adaptiveImage?.style.removeProperty('transform');
    });
  });

  onDestroy(() => {
    kenBurns.cancel();
    $boundingBoxesArray = [];
  });

  let containerWidth = $state(0);
  let containerHeight = $state(0);

  const container = $derived({
    width: containerWidth,
    height: containerHeight,
  });

  const isCoverMode = $derived($slideshowState !== SlideshowState.None && $slideshowLook === SlideshowLook.Cover);

  const overlaySize = $derived.by((): Size => {
    if (!visibleImageReady) {
      return { width: 0, height: 0 };
    }

    const assetWidth = asset.width && asset.width > 0 ? asset.width : 1;
    const assetHeight = asset.height && asset.height > 0 ? asset.height : 1;
    const scaleFn = isCoverMode ? scaleToCover : scaleToFit;
    return scaleFn({ width: assetWidth, height: assetHeight }, { width: containerWidth, height: containerHeight });
  });

  const ocrBoxes = $derived(ocrManager.showOverlay ? getOcrBoundingBoxes(ocrManager.data, overlaySize) : []);

  const onCopy = async () => {
    if (!canCopyImageToClipboard() || !assetViewerManager.imgRef) {
      return;
    }

    try {
      await copyImageToClipboard(assetViewerManager.imgRef);
      toastManager.info($t('copied_image_to_clipboard'));
    } catch (error) {
      handleError(error, $t('copy_error'));
    }
  };

  const onZoom = () => {
    const targetZoom = assetViewerManager.zoom > 1 ? 1 : 2;
    assetViewerManager.animatedZoom(targetZoom);
  };

  const onPlaySlideshow = () => ($slideshowState = SlideshowState.PlaySlideshow);

  // TODO move to action + command palette
  const onCopyShortcut = (event: KeyboardEvent) => {
    if (globalThis.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();

    handlePromiseError(onCopy());
  };

  let currentPreviewUrl = $state<string>();

  const onUrlChange = (url: string) => {
    currentPreviewUrl = url;
  };

  $effect(() => {
    if (currentPreviewUrl) {
      void cast(currentPreviewUrl);
    }
  });

  const cast = async (url: string) => {
    if (!url || !castManager.isCasting) {
      return;
    }
    const fullUrl = new URL(url, globalThis.location.href);

    try {
      await castManager.loadMedia(fullUrl.href);
    } catch (error) {
      handleError(error, 'Unable to cast');
      return;
    }
  };

  const blurredSlideshow = $derived(
    $slideshowState !== SlideshowState.None && $slideshowLook === SlideshowLook.BlurredBackground && !!asset.thumbhash,
  );

  const faceToNameMap = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<Faces, string>();
    for (const person of asset.people ?? []) {
      for (const face of person.faces ?? []) {
        map.set(face, person.name);
      }
    }
    if (isFaceEditMode.value) {
      for (const face of asset.unassignedFaces ?? []) {
        map.set(face, '');
      }
    }
    return map;
  });

  // Array needed for indexed access in the template (faces[index])
  const faces = $derived(Array.from(faceToNameMap.keys()));
  const boundingBoxes = $derived(getBoundingBox(faces, overlaySize));
  const activeBoundingBoxes = $derived(boundingBoxes.filter((box) => $boundingBoxesArray.some((f) => f.id === box.id)));

  const unassignedFaces = $derived((asset.unassignedFaces ?? []) as Faces[]);

  const kenBurnsActive = $derived($slideshowState === SlideshowState.PlaySlideshow && $kenBurnsEffect);

  $effect(() => {
    if (!kenBurnsActive || !visibleImageReady || !adaptiveImage || !assetViewerManager.imgRef) {
      return;
    }

    assetViewerManager.zoomState = { ...untrack(() => assetViewerManager.zoomState), enable: false };

    void kenBurns.startWithSmartCrop(adaptiveImage, {
      imgRef: assetViewerManager.imgRef,
      faces,
      fallbackFaces: unassignedFaces,
      contentWidth: overlaySize.width,
      contentHeight: overlaySize.height,
      containerWidth,
      containerHeight,
      slideshowLook: $slideshowLook,
      isCoverMode,
      slideshowDelay: $slideshowDelay,
      assetId: asset.id,
    });

    return () => {
      kenBurns.cancel();
      if (viewTransitionManager.activeViewTransition === null) {
        assetViewerManager.resetZoomState();
      }
    };
  });

  $effect(() => {
    if (viewTransitionManager.activeViewTransition === null) {
      kenBurns.resume();
    } else {
      kenBurns.pause();
    }
  });
</script>

<AssetViewerEvents {onCopy} {onZoom} />

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'z' }, onShortcut: onZoom, preventDefault: true },
    { shortcut: { key: 's' }, onShortcut: onPlaySlideshow, preventDefault: true },
    { shortcut: { key: 'c', ctrl: true }, onShortcut: onCopyShortcut, preventDefault: false },
    { shortcut: { key: 'c', meta: true }, onShortcut: onCopyShortcut, preventDefault: false },
  ]}
/>

<div
  bind:this={element}
  class="relative h-full w-full select-none"
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}
  role="presentation"
  ondblclick={onZoom}
  use:zoomImageAction={{ zoomTarget: adaptiveImage }}
  {...useSwipe((event) => onSwipe?.(event))}
>
  <AdaptiveImage
    {asset}
    {sharedLink}
    {container}
    objectFit={isCoverMode ? 'cover' : 'contain'}
    {onUrlChange}
    onImageReady={() => {
      visibleImageReady = true;
      eventManager.emit('TransitionToAssetViewerReady');
    }}
    onError={() => {
      onError?.();
      eventManager.emit('TransitionToAssetViewerReady');
    }}
    bind:imgRef={assetViewerManager.imgRef}
    bind:ref={adaptiveImage}
    {transitionName}
    {letterboxTransitionName}
    showLetterboxes={!blurredSlideshow}
  >
    {#snippet backdrop()}
      {#if blurredSlideshow}
        <canvas
          use:thumbhash={{ base64ThumbHash: asset.thumbhash! }}
          class="absolute top-0 left-0 inset-s-0 h-dvh w-dvw"
        ></canvas>
      {/if}
    {/snippet}
    {#snippet overlays()}
      {#if !isFaceEditMode.value}
        {#each boundingBoxes as boundingbox, index (boundingbox.id)}
          {@const face = faces[index]}
          {@const name = faceToNameMap.get(face)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="absolute pointer-events-auto outline-none rounded-lg"
            style="top: {boundingbox.top}px; left: {boundingbox.left}px; height: {boundingbox.height}px; width: {boundingbox.width}px;"
            aria-label="{$t('person')}: {name || $t('unknown')}"
            onpointerenter={() => ($boundingBoxesArray = [face])}
            onpointerleave={() => ($boundingBoxesArray = [])}
          ></div>
        {/each}
      {/if}

      {#each activeBoundingBoxes as boundingbox (boundingbox.id)}
        {@const face = faces.find((f) => f.id === boundingbox.id)}
        {@const name = face ? faceToNameMap.get(face) : undefined}
        <div
          class="absolute border-solid border-white border-3 rounded-lg pointer-events-none"
          style="top: {boundingbox.top}px; left: {boundingbox.left}px; height: {boundingbox.height}px; width: {boundingbox.width}px;"
        >
          {#if name}
            <div
              aria-hidden="true"
              class="absolute bg-white/90 text-black px-2 py-1 rounded text-sm font-medium whitespace-nowrap shadow-lg"
              style="top: {boundingbox.height + 4}px; right: 0;"
            >
              {name}
            </div>
          {/if}
        </div>
      {/each}

      {#each ocrBoxes as ocrBox (ocrBox.id)}
        <OcrBoundingBox {ocrBox} />
      {/each}
    {/snippet}
  </AdaptiveImage>

  {#if isFaceEditMode.value && assetViewerManager.imgRef}
    <FaceEditor htmlElement={assetViewerManager.imgRef} {containerWidth} {containerHeight} assetId={asset.id} />
  {/if}
</div>
