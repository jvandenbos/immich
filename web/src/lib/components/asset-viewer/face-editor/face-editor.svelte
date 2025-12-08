<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/image-thumbnail.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { isFaceEditMode } from '$lib/stores/face-edit.svelte';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { computeContentMetrics, getNaturalSize, mapContentRectToNatural } from '$lib/utils/container-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { scaleFaceRectOnResize, type ResizeContext } from '$lib/utils/people-utils';
  import { createFace, getAllPeople, type PersonResponseDto } from '@immich/sdk';
  import { shortcut } from '$lib/actions/shortcut';
  import { Button, Input, modalManager, toastManager } from '@immich/ui';
  import { Canvas, InteractiveFabricObject, Rect } from 'fabric';
  import { clamp } from 'lodash-es';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    htmlElement: HTMLImageElement | HTMLVideoElement | undefined | null;
    containerWidth: number;
    containerHeight: number;
    assetId: string;
  }

  let { htmlElement, containerWidth, containerHeight, assetId }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let canvas: Canvas | undefined = $state();
  let faceRect: Rect | undefined = $state();
  let faceSelectorEl: HTMLDivElement | undefined = $state();
  let scrollableListEl: HTMLDivElement | undefined = $state();
  let page = $state(1);
  let candidates = $state<PersonResponseDto[]>([]);

  let searchTerm = $state('');
  let faceBoxPosition = $state({ left: 0, top: 0, width: 0, height: 0 });
  let userMovedRect = false;
  let previousMetrics: ResizeContext | null = null;

  let filteredCandidates = $derived(
    searchTerm
      ? candidates.filter((person) => person.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : candidates,
  );

  const configureControlStyle = () => {
    InteractiveFabricObject.ownDefaults = {
      ...InteractiveFabricObject.ownDefaults,
      cornerStyle: 'circle',
      cornerColor: 'rgb(153,166,251)',
      cornerSize: 10,
      padding: 8,
      transparentCorners: false,
      lockRotation: true,
      hasBorders: true,
    };
  };

  const setupCanvas = () => {
    if (!canvasEl || !htmlElement) {
      return;
    }

    canvas = new Canvas(canvasEl, { width: containerWidth, height: containerHeight });
    canvas.selection = false;
    configureControlStyle();

    // eslint-disable-next-line tscompat/tscompat
    faceRect = new Rect({
      fill: 'rgba(66,80,175,0.25)',
      stroke: 'rgb(66,80,175)',
      strokeWidth: 2,
      strokeUniform: true,
      width: 112,
      height: 112,
      objectCaching: true,
      rx: 8,
      ry: 8,
    });

    canvas.add(faceRect);
    canvas.setActiveObject(faceRect);
  };

  onMount(() => {
    void getPeople();
  });

  $effect(() => {
    if (!canvas) {
      return;
    }

    const upperCanvas = canvas.upperCanvasEl;
    const controller = new AbortController();
    const { signal } = controller;

    const stopIfOnTarget = (event: PointerEvent) => {
      if (canvas?.findTarget(event).target) {
        event.stopPropagation();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!canvas) {
        return;
      }
      if (canvas.findTarget(event).target) {
        event.stopPropagation();
        return;
      }
      if (faceRect) {
        event.stopPropagation();
        const pointer = canvas.getScenePoint(event);
        faceRect.set({ left: pointer.x, top: pointer.y });
        faceRect.setCoords();
        userMovedRect = true;
        canvas.renderAll();
        positionFaceSelector();
      }
    };

    upperCanvas.addEventListener('pointerdown', handlePointerDown, { signal });
    upperCanvas.addEventListener('pointermove', stopIfOnTarget, { signal });
    upperCanvas.addEventListener('pointerup', stopIfOnTarget, { signal });

    return () => {
      controller.abort();
    };
  });

  const imageContentMetrics = $derived.by(() => {
    if (!htmlElement) {
      return { contentWidth: 0, contentHeight: 0, offsetX: 0, offsetY: 0 };
    }
    return computeContentMetrics(getNaturalSize(htmlElement), { width: containerWidth, height: containerHeight });
  });

  const setDefaultFaceRectanglePosition = (faceRect: Rect) => {
    const { offsetX, offsetY, contentWidth, contentHeight } = imageContentMetrics;

    faceRect.set({
      top: offsetY + contentHeight / 2 - 56,
      left: offsetX + contentWidth / 2 - 56,
    });
  };

  $effect(() => {
    const { offsetX, offsetY, contentWidth } = imageContentMetrics;

    if (contentWidth === 0) {
      return;
    }

    const isFirstRun = previousMetrics === null;

    if (isFirstRun && !canvas) {
      setupCanvas();
    }

    if (!canvas || !faceRect) {
      return;
    }

    if (!isFirstRun) {
      canvas.setDimensions({ width: containerWidth, height: containerHeight });
    }

    if (!isFirstRun && userMovedRect && previousMetrics) {
      faceRect.set(scaleFaceRectOnResize(faceRect, previousMetrics, { contentWidth, offsetX, offsetY }));
    } else {
      setDefaultFaceRectanglePosition(faceRect);
    }

    faceRect.setCoords();
    previousMetrics = { contentWidth, offsetX, offsetY };
    canvas.renderAll();
    positionFaceSelector();
  });

  const cancel = () => {
    isFaceEditMode.value = false;
  };

  const getPeople = async () => {
    const { hasNextPage, people, total } = await getAllPeople({ page, size: 1000, withHidden: false });

    if (candidates.length === total) {
      return;
    }

    candidates = [...candidates, ...people];

    if (hasNextPage) {
      page++;
    }
  };

  const MAX_LIST_HEIGHT = 250;

  const positionFaceSelector = () => {
    if (!faceRect || !faceSelectorEl || !scrollableListEl) {
      return;
    }

    const gap = 15;
    const padding = faceRect.padding ?? 0;
    const rawBox = faceRect.getBoundingRect();
    const { currentZoom, currentPositionX, currentPositionY } = assetViewerManager.zoomState;
    const faceBox = {
      left: (rawBox.left - padding) * currentZoom + currentPositionX,
      top: (rawBox.top - padding) * currentZoom + currentPositionY,
      width: (rawBox.width + padding * 2) * currentZoom,
      height: (rawBox.height + padding * 2) * currentZoom,
    };
    const selectorWidth = faceSelectorEl.offsetWidth;
    const chromeHeight = faceSelectorEl.offsetHeight - scrollableListEl.offsetHeight;
    const listHeight = Math.min(MAX_LIST_HEIGHT, containerHeight - gap * 2 - chromeHeight);
    const selectorHeight = listHeight + chromeHeight;

    const clampTop = (top: number) => clamp(top, gap, containerHeight - selectorHeight - gap);
    const clampLeft = (left: number) => clamp(left, gap, containerWidth - selectorWidth - gap);

    const faceRight = faceBox.left + faceBox.width;
    const faceBottom = faceBox.top + faceBox.height;

    const overlapArea = (position: { top: number; left: number }) => {
      const overlapX = Math.max(
        0,
        Math.min(position.left + selectorWidth, faceRight) - Math.max(position.left, faceBox.left),
      );
      const overlapY = Math.max(
        0,
        Math.min(position.top + selectorHeight, faceBottom) - Math.max(position.top, faceBox.top),
      );
      return overlapX * overlapY;
    };

    const positions = [
      { top: clampTop(faceBottom + gap), left: clampLeft(faceBox.left) },
      { top: clampTop(faceBox.top - selectorHeight - gap), left: clampLeft(faceBox.left) },
      { top: clampTop(faceBox.top), left: clampLeft(faceRight + gap) },
      { top: clampTop(faceBox.top), left: clampLeft(faceBox.left - selectorWidth - gap) },
    ];

    let bestPosition = positions[0];
    let leastOverlap = Infinity;

    for (const position of positions) {
      const overlap = overlapArea(position);
      if (overlap < leastOverlap) {
        leastOverlap = overlap;
        bestPosition = position;
        if (overlap === 0) {
          break;
        }
      }
    }

    const containerRect = containerEl?.getBoundingClientRect();
    const offsetTop = containerRect?.top ?? 0;
    const offsetLeft = containerRect?.left ?? 0;
    faceSelectorEl.style.top = `${bestPosition.top + offsetTop}px`;
    faceSelectorEl.style.left = `${bestPosition.left + offsetLeft}px`;
    scrollableListEl.style.height = `${listHeight}px`;
    faceBoxPosition = faceBox;
  };

  $effect(() => {
    if (!canvas) {
      return;
    }

    const { currentZoom, currentPositionX, currentPositionY } = assetViewerManager.zoomState;
    canvas.setViewportTransform([currentZoom, 0, 0, currentZoom, currentPositionX, currentPositionY]);
    canvas.renderAll();
    positionFaceSelector();
  });

  $effect(() => {
    const rect = faceRect;
    if (rect) {
      const onUserMove = () => {
        userMovedRect = true;
        positionFaceSelector();
      };
      rect.on('moving', onUserMove);
      rect.on('scaling', onUserMove);
      return () => {
        rect.off('moving', onUserMove);
        rect.off('scaling', onUserMove);
      };
    }
  });

  const trapEvents = (node: HTMLElement) => {
    const stop = (e: Event) => e.stopPropagation();
    const eventTypes = ['keydown', 'pointerdown', 'pointermove', 'pointerup'] as const;
    for (const type of eventTypes) {
      node.addEventListener(type, stop);
    }

    // Move to body so the selector isn't affected by the zoom transform on the container
    document.body.append(node);

    return {
      destroy() {
        for (const type of eventTypes) {
          node.removeEventListener(type, stop);
        }
        node.remove();
      },
    };
  };

  const getFaceCroppedCoordinates = () => {
    if (!faceRect || !htmlElement) {
      return;
    }

    const scaledWidth = faceRect.getScaledWidth();
    const scaledHeight = faceRect.getScaledHeight();
    const natural = getNaturalSize(htmlElement);

    const imageRect = mapContentRectToNatural(
      {
        left: faceRect.left - scaledWidth / 2,
        top: faceRect.top - scaledHeight / 2,
        width: scaledWidth,
        height: scaledHeight,
      },
      imageContentMetrics,
      natural,
    );

    return {
      imageWidth: natural.width,
      imageHeight: natural.height,
      x: Math.floor(imageRect.left),
      y: Math.floor(imageRect.top),
      width: Math.floor(imageRect.width),
      height: Math.floor(imageRect.height),
    };
  };

  const tagFace = async (person: PersonResponseDto) => {
    try {
      const data = getFaceCroppedCoordinates();
      if (!data) {
        toastManager.warning($t('error_tag_face_bounding_box'));
        return;
      }

      const isConfirmed = await modalManager.showDialog({
        prompt: person.name
          ? $t('confirm_tag_face', { values: { name: person.name } })
          : $t('confirm_tag_face_unnamed'),
      });

      if (!isConfirmed) {
        return;
      }

      await createFace({
        assetFaceCreateDto: {
          assetId,
          personId: person.id,
          ...data,
        },
      });

      await assetViewingStore.setAssetId(assetId);
      isFaceEditMode.value = false;
    } catch (error) {
      handleError(error, 'Error tagging face');
    }
  };
</script>

<svelte:document use:shortcut={{ shortcut: { key: 'Escape' }, onShortcut: cancel }} />

<div
  id="face-editor-data"
  bind:this={containerEl}
  class="absolute start-0 top-0 z-5 h-full w-full overflow-hidden"
  data-face-left={faceBoxPosition.left}
  data-face-top={faceBoxPosition.top}
  data-face-width={faceBoxPosition.width}
  data-face-height={faceBoxPosition.height}
>
  <canvas bind:this={canvasEl} id="face-editor" class="absolute top-0 start-0"></canvas>

  <div
    id="face-selector"
    bind:this={faceSelectorEl}
    class="fixed z-20 w-[min(200px,45vw)] min-w-48 bg-white dark:bg-immich-dark-gray dark:text-immich-dark-fg backdrop-blur-sm px-2 py-4 rounded-xl border border-gray-200 dark:border-gray-800 transition-[top,left] duration-200 ease-out"
    use:trapEvents
    onwheel={(e) => e.stopPropagation()}
  >
    <p class="text-center text-sm">{$t('select_person_to_tag')}</p>

    <div class="my-3 relative">
      <Input placeholder={$t('search_people')} bind:value={searchTerm} size="tiny" />
    </div>

    <div bind:this={scrollableListEl} class="h-62.5 overflow-y-auto mt-2">
      {#if filteredCandidates.length > 0}
        <div class="mt-2 rounded-lg">
          {#each filteredCandidates as person (person.id)}
            <button
              onclick={() => tagFace(person)}
              type="button"
              class="w-full flex place-items-center gap-2 rounded-lg ps-1 pe-4 py-2 hover:bg-immich-primary/25"
            >
              <ImageThumbnail
                curve
                shadow
                url={getPeopleThumbnailUrl(person)}
                altText={person.name}
                title={person.name}
                widthStyle="30px"
                heightStyle="30px"
              />
              <p class="text-sm">
                {person.name}
              </p>
            </button>
          {/each}
        </div>
      {:else}
        <div class="flex items-center justify-center py-4">
          <p class="text-sm text-gray-500">{$t('no_people_found')}</p>
        </div>
      {/if}
    </div>

    <Button size="small" fullWidth onclick={cancel} color="danger" class="mt-2">{$t('cancel')}</Button>
  </div>
</div>
