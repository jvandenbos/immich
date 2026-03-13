<script lang="ts">
  import { MAX_ZOOM } from '$lib/actions/zoom-image';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { getAssetUrls } from '$lib/utils';
  import { scaleToFit, type ContentMetrics } from '$lib/utils/container-utils';
  import type { AssetResponseDto, SharedLinkResponseDto } from '@immich/sdk';
  import { TUNABLES } from '$lib/utils/tunables';
  import { clamp } from 'lodash-es';
  import { fade } from 'svelte/transition';

  interface Props {
    containerWidth: number;
    containerHeight: number;
    asset: AssetResponseDto;
    sharedLink?: SharedLinkResponseDto;
  }

  let { containerWidth, containerHeight, asset, sharedLink }: Props = $props();

  const MINIMAP_MAX = 192;
  const MINIMAP_MIN = 100;
  const minimapSize = $derived(clamp(Math.min(containerWidth, containerHeight) * 0.25, MINIMAP_MIN, MINIMAP_MAX));

  const thumbnailUrl = $derived(getAssetUrls(asset, sharedLink).thumbnail);

  const imageDimensions = $derived({
    width: asset.width && asset.width > 0 ? asset.width : 1,
    height: asset.height && asset.height > 0 ? asset.height : 1,
  });

  const container = $derived({ width: containerWidth, height: containerHeight });

  // Scale the full container into the minimap square
  const containerInMinimap = $derived(scaleToFit(container, { width: minimapSize, height: minimapSize }));
  const minimapContainerScale = $derived(containerInMinimap.width / containerWidth);
  const containerOffsetX = $derived((minimapSize - containerInMinimap.width) / 2);
  const containerOffsetY = $derived((minimapSize - containerInMinimap.height) / 2);

  // Position the image within the minimap's container representation
  const imageInMinimap: ContentMetrics = $derived.by(() => {
    const fitted = scaleToFit(imageDimensions, containerInMinimap);
    return {
      contentWidth: fitted.width,
      contentHeight: fitted.height,
      offsetX: containerOffsetX + (containerInMinimap.width - fitted.width) / 2,
      offsetY: containerOffsetY + (containerInMinimap.height - fitted.height) / 2,
    };
  });

  const { FADE_DURATION, HIDE_DELAY } = TUNABLES.MINIMAP;

  let isDragging = $state(false);
  let isDraggingZoom = $state(false);
  let isRecentActivity = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const resetHideTimer = () => {
    isRecentActivity = true;
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      isRecentActivity = false;
      hideTimer = null;
    }, HIDE_DELAY);
  };

  const isZoomed = $derived(assetViewerManager.zoom > 1);
  const isVisible = $derived((isZoomed && isRecentActivity) || isDragging || isDraggingZoom);

  $effect(() => {
    // Track zoom state changes to reset the hide timer
    const _state = assetViewerManager.zoomState;
    void _state;
    if (isZoomed) {
      resetHideTimer();
    }
    return () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
  });

  const zoomPercent = $derived(((assetViewerManager.zoom - 1) / (MAX_ZOOM - 1)) * 100);
  const zoomLabel = $derived(assetViewerManager.zoom.toFixed(1) + 'x');

  const clampPanPosition = (positionX: number, positionY: number, zoom: number) => ({
    positionX: clamp(positionX, -(containerWidth * (zoom - 1)), 0),
    positionY: clamp(positionY, -(containerHeight * (zoom - 1)), 0),
  });

  const minimapToContainerPosition = (minimapX: number, minimapY: number) => {
    const containerX = (minimapX - containerOffsetX) / minimapContainerScale;
    const containerY = (minimapY - containerOffsetY) / minimapContainerScale;
    const { currentZoom } = assetViewerManager.zoomState;
    const rawPositionX = containerWidth / 2 - containerX * currentZoom;
    const rawPositionY = containerHeight / 2 - containerY * currentZoom;
    return clampPanPosition(rawPositionX, rawPositionY, currentZoom);
  };

  const panToMinimapPosition = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const minimapX = event.clientX - rect.left;
    const minimapY = event.clientY - rect.top;
    const { positionX, positionY } = minimapToContainerPosition(minimapX, minimapY);
    assetViewerManager.directTransform({ currentPositionX: positionX, currentPositionY: positionY });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    isDragging = true;
    assetViewerManager.setZoomEnabled(false);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    panToMinimapPosition(event);
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isDragging) {
      return;
    }
    panToMinimapPosition(event);
  };

  const onPointerUp = () => {
    isDragging = false;
    assetViewerManager.setZoomEnabled(true);
  };

  const zoomAroundCenter = (newZoom: number) => {
    const { currentZoom, currentPositionX, currentPositionY } = assetViewerManager.zoomState;
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    const zoomTargetX = (centerX - currentPositionX) / currentZoom;
    const zoomTargetY = (centerY - currentPositionY) / currentZoom;
    const newPositionX = -zoomTargetX * newZoom + centerX;
    const newPositionY = -zoomTargetY * newZoom + centerY;

    assetViewerManager.directTransform({
      currentZoom: newZoom,
      currentPositionX: clamp(newPositionX, -(containerWidth * (newZoom - 1)), 0),
      currentPositionY: clamp(newPositionY, -(containerHeight * (newZoom - 1)), 0),
    });
  };

  const setZoomFromSlider = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    zoomAroundCenter(1 + percent * (MAX_ZOOM - 1));
  };

  const WHEEL_ZOOM_RATIO = 0.1;

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const { currentZoom } = assetViewerManager.zoomState;
    const delta = -clamp(event.deltaY, -0.5, 0.5);
    const newZoom = clamp(currentZoom + delta * WHEEL_ZOOM_RATIO * currentZoom, 1, MAX_ZOOM);
    zoomAroundCenter(newZoom);
  };

  const onZoomSliderPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    isDraggingZoom = true;
    assetViewerManager.setZoomEnabled(false);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setZoomFromSlider(event);
    event.preventDefault();
    event.stopPropagation();
  };

  const onZoomSliderPointerMove = (event: PointerEvent) => {
    if (!isDraggingZoom) {
      return;
    }
    setZoomFromSlider(event);
  };

  const onZoomSliderPointerUp = () => {
    isDraggingZoom = false;
    assetViewerManager.setZoomEnabled(true);
  };

  const viewportRect = $derived.by(() => {
    const { currentZoom, currentPositionX, currentPositionY } = assetViewerManager.zoomState;

    // Visible area in container coordinates
    const visibleLeft = -currentPositionX / currentZoom;
    const visibleTop = -currentPositionY / currentZoom;
    const visibleWidth = containerWidth / currentZoom;
    const visibleHeight = containerHeight / currentZoom;

    // Map to minimap coordinates
    return {
      left: visibleLeft * minimapContainerScale + containerOffsetX,
      top: visibleTop * minimapContainerScale + containerOffsetY,
      width: visibleWidth * minimapContainerScale,
      height: visibleHeight * minimapContainerScale,
    };
  });
</script>

{#if isVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute top-[68px] right-14 md:right-4 z-10 rounded-lg border border-white/30 bg-black/60 p-1 backdrop-blur-sm"
    data-testid="zoom-minimap"
    transition:fade={{ duration: FADE_DURATION }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative overflow-hidden rounded bg-black"
      class:cursor-grabbing={isDragging}
      class:cursor-pointer={!isDragging}
      data-testid="zoom-minimap-canvas"
      style="width: {minimapSize}px; height: {minimapSize}px;"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onwheel={onWheel}
    >
      <img
        src={thumbnailUrl}
        alt=""
        class="absolute pointer-events-none"
        draggable="false"
        style="left: {imageInMinimap.offsetX}px; top: {imageInMinimap.offsetY}px; width: {imageInMinimap.contentWidth}px; height: {imageInMinimap.contentHeight}px;"
      />
      <div
        class={[
          'absolute border-2 border-white bg-white/20 pointer-events-none rounded-sm',
          isDragging && 'border-white/80',
        ]}
        data-testid="zoom-minimap-viewport"
        style="left: {viewportRect.left}px; top: {viewportRect.top}px; width: {viewportRect.width}px; height: {viewportRect.height}px;"
      ></div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative mt-1 h-3 rounded-full bg-white/20 cursor-pointer"
      class:cursor-grabbing={isDraggingZoom}
      data-testid="zoom-minimap-slider"
      style="width: {minimapSize}px;"
      onpointerdown={onZoomSliderPointerDown}
      onpointermove={onZoomSliderPointerMove}
      onpointerup={onZoomSliderPointerUp}
      onpointercancel={onZoomSliderPointerUp}
    >
      <div
        class="absolute top-0 left-0 h-full rounded-full bg-white/80 pointer-events-none"
        data-testid="zoom-minimap-slider-fill"
        style="width: {zoomPercent}%;"
      ></div>
      <span
        class="absolute inset-0 flex items-center justify-center text-[9px] font-semibold pointer-events-none select-none leading-none"
        style="color: #000; text-shadow: 0 0 3px rgba(255,255,255,0.8);"
      >
        {zoomLabel}
      </span>
    </div>
  </div>
{/if}
