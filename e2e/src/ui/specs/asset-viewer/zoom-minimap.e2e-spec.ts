import { expect, type Page, test } from '@playwright/test';
import { assetViewerUtils } from '../timeline/utils';
import { setupAssetViewerFixture } from './utils';

test.describe.configure({ mode: 'parallel' });

const zoomIn = async (page: Page) => {
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.wheel(0, -1);
  await page.waitForTimeout(300);
};

const getImageTransform = (page: Page) => {
  return page.getByTestId('preview').evaluate((element) => {
    return getComputedStyle(element.closest('[style*="transform"]') ?? element).transform;
  });
};

test.describe('zoom minimap', () => {
  const fixture = setupAssetViewerFixture(950);

  test('minimap is not visible at 1x zoom', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await expect(page.getByTestId('zoom-minimap')).toHaveCount(0);
  });

  test('minimap appears when zoomed in', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);

    await expect(page.getByTestId('zoom-minimap')).toBeVisible();
  });

  test('minimap contains thumbnail image', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);

    const canvas = page.getByTestId('zoom-minimap-canvas');
    await expect(canvas).toBeVisible();

    const img = canvas.locator('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /thumbnail/);
  });

  test('viewport rect is visible when zoomed', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);

    const viewport = page.getByTestId('zoom-minimap-viewport');
    await expect(viewport).toBeVisible();

    const box = await viewport.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('clicking minimap pans the image', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);

    const transformBefore = await getImageTransform(page);

    const canvas = page.getByTestId('zoom-minimap-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();

    // Click near the top-left corner of the minimap
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + 20);
    await page.waitForTimeout(100);

    const transformAfter = await getImageTransform(page);
    expect(transformAfter).not.toBe(transformBefore);
  });

  test('zoom slider adjusts zoom level', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);

    const slider = page.getByTestId('zoom-minimap-slider');
    await expect(slider).toBeVisible();

    const sliderBox = await slider.boundingBox();
    expect(sliderBox).toBeTruthy();

    const fillBefore = await page.getByTestId('zoom-minimap-slider-fill').evaluate((element) => {
      return element.style.width;
    });

    // Click near the right end of the slider to increase zoom
    await page.mouse.click(sliderBox!.x + sliderBox!.width * 0.8, sliderBox!.y + sliderBox!.height / 2);
    await page.waitForTimeout(100);

    const fillAfter = await page.getByTestId('zoom-minimap-slider-fill').evaluate((element) => {
      return element.style.width;
    });

    expect(fillAfter).not.toBe(fillBefore);
  });

  test('minimap auto-hides after inactivity', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await zoomIn(page);
    await expect(page.getByTestId('zoom-minimap')).toBeVisible();

    // Wait for the hide delay (1500ms) plus fade duration
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('zoom-minimap')).toHaveCount(0);
  });
});
