<script lang="ts">
  import AdaptiveImage from '$lib/components/AdaptiveImage.svelte';
  import type { Size } from '$lib/utils/container-utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import DelayedLoadingSpinner from '$lib/components/DelayedLoadingSpinner.svelte';

  interface Props {
    asset: AssetResponseDto;
    transitionName?: string;
    onImageLoad: () => void;
    onError?: () => void;
  }

  const { asset, transitionName, onImageLoad, onError }: Props = $props();

  let containerWidth = $state(0);
  let containerHeight = $state(0);

  const container: Size = $derived({ width: containerWidth, height: containerHeight });

  const isHero = $derived(transitionName === 'hero');
  let imageReady = $state(false);
</script>

<div
  class="relative h-full w-full overflow-hidden rounded-2xl"
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}
  style:view-transition-name={!isHero ? transitionName : undefined}
>
  {#if containerWidth > 0 && containerHeight > 0}
    <AdaptiveImage
      {asset}
      {container}
      transitionName={isHero ? transitionName : undefined}
      showLetterboxes={false}
      onImageReady={() => {
        imageReady = true;
        onImageLoad();
      }}
      onError={() => {
        onError?.();
      }}
    />
  {:else}
    <DelayedLoadingSpinner />
  {/if}
</div>
