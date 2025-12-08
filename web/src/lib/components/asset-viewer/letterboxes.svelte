<script lang="ts">
  interface Props {
    letterboxTransitionName?: string | undefined;
    show?: boolean;
    scaledDimensions: {
      width: number;
      height: number;
    };
    container: {
      width: number;
      height: number;
    };
  }

  let { letterboxTransitionName, show = true, scaledDimensions, container }: Props = $props();

  const shouldShowLetterboxes = $derived(show && !!letterboxTransitionName);

  const letterboxes = $derived.by(() => {
    const { width, height } = scaledDimensions;
    const horizontalOffset = (container.width - width) / 2;
    const verticalOffset = (container.height - height) / 2;

    return [
      {
        name: 'letterbox-left',
        width: horizontalOffset + 'px',
        height: container.height + 'px',
        left: '0px',
        top: '0px',
      },
      {
        name: 'letterbox-right',
        width: horizontalOffset + 'px',
        height: container.height + 'px',
        left: container.width - horizontalOffset + 'px',
        top: '0px',
      },
      {
        name: 'letterbox-top',
        width: width + 'px',
        height: verticalOffset + 'px',
        left: horizontalOffset + 'px',
        top: '0px',
      },
      {
        name: 'letterbox-bottom',
        width: width + 'px',
        height: verticalOffset + 'px',
        left: horizontalOffset + 'px',
        top: container.height - verticalOffset + 'px',
      },
    ];
  });
</script>

{#if shouldShowLetterboxes}
  {#each letterboxes as box (box.name)}
    <div
      class="absolute"
      style:view-transition-name={box.name}
      style:left={box.left}
      style:top={box.top}
      style:width={box.width}
      style:height={box.height}
    ></div>
  {/each}
{/if}
