import type { TimelineAsset } from './types';

export const assetSnapshot = (asset: TimelineAsset): TimelineAsset => $state.snapshot(asset);
export const assetsSnapshot = (assets: TimelineAsset[]) => assets.map((asset) => $state.snapshot(asset));

export function* filterIntersecting<T extends { intersecting: boolean }>(items: T[]) {
  for (const item of items) {
    if (item.intersecting) {
      yield item;
    }
  }
}
