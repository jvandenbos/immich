let isAssetViewer = $state(false);

export const appManager = {
  get isAssetViewer() {
    return isAssetViewer;
  },
  set isAssetViewer(value: boolean) {
    isAssetViewer = value;
  },
};
