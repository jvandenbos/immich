import { expect, test } from '@playwright/test';
import { toAssetResponseDto } from 'src/ui/generators/timeline';
import {
  createMockAssetFaces,
  createMockFaceData,
  createMockPeople,
  type MockFaceSpec,
  setupFaceEditorMockApiRoutes,
  setupFaceOverlayMockApiRoutes,
  setupGetFacesMockApiRoute,
} from 'src/ui/mock-network/face-editor-network';
import { assetViewerUtils } from '../timeline/utils';
import { ensureDetailPanelVisible, setupAssetViewerFixture } from './utils';

test.describe.configure({ mode: 'parallel' });

const FACE_SPECS: MockFaceSpec[] = [
  {
    personId: 'person-alice',
    personName: 'Alice Johnson',
    faceId: 'face-alice',
    boundingBoxX1: 1000,
    boundingBoxY1: 500,
    boundingBoxX2: 1500,
    boundingBoxY2: 1200,
  },
  {
    personId: 'person-bob',
    personName: 'Bob Smith',
    faceId: 'face-bob',
    boundingBoxX1: 2000,
    boundingBoxY1: 800,
    boundingBoxX2: 2400,
    boundingBoxY2: 1600,
  },
];

const setupFaceMocks = async (
  context: import('@playwright/test').BrowserContext,
  fixture: ReturnType<typeof setupAssetViewerFixture>,
) => {
  const mockPeople = createMockPeople(4);
  const faceData = createMockFaceData(
    FACE_SPECS,
    fixture.primaryAssetDto.width ?? 3000,
    fixture.primaryAssetDto.height ?? 4000,
  );
  const assetDtoWithFaces = toAssetResponseDto(fixture.primaryAsset, undefined, faceData);
  await setupFaceOverlayMockApiRoutes(context, assetDtoWithFaces);
  await setupFaceEditorMockApiRoutes(context, mockPeople, { requests: [] });
};

test.describe('face overlay bounding boxes', () => {
  const fixture = setupAssetViewerFixture(901);

  test.beforeEach(async ({ context }) => {
    await setupFaceMocks(context, fixture);
  });

  test('face overlay divs render with correct aria labels', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const aliceOverlay = page.getByLabel('Person: Alice Johnson');
    const bobOverlay = page.getByLabel('Person: Bob Smith');

    await expect(aliceOverlay).toBeVisible();
    await expect(bobOverlay).toBeVisible();
  });

  test('face overlay shows border on hover', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const aliceOverlay = page.getByLabel('Person: Alice Johnson');
    await expect(aliceOverlay).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await expect(activeBorder).toHaveCount(0);

    await aliceOverlay.hover();
    await expect(activeBorder).toHaveCount(1);
  });

  test('face name tooltip appears on hover', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const aliceOverlay = page.getByLabel('Person: Alice Johnson');
    await expect(aliceOverlay).toBeVisible();

    await aliceOverlay.hover();

    const nameTooltip = page.locator('[data-viewer-content]').getByText('Alice Johnson');
    await expect(nameTooltip).toBeVisible();
  });

  test('face overlays hidden in face edit mode', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const aliceOverlay = page.getByLabel('Person: Alice Johnson');
    await expect(aliceOverlay).toBeVisible();

    await ensureDetailPanelVisible(page);
    await page.getByLabel('Tag people').click();
    await page.locator('#face-selector').waitFor({ state: 'visible' });

    await expect(aliceOverlay).toBeHidden();
  });

  test('face overlay hover works after exiting face edit mode', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const aliceOverlay = page.getByLabel('Person: Alice Johnson');
    await expect(aliceOverlay).toBeVisible();

    await ensureDetailPanelVisible(page);
    await page.getByLabel('Tag people').click();
    await page.locator('#face-selector').waitFor({ state: 'visible' });
    await expect(aliceOverlay).toBeHidden();

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.locator('#face-selector')).toBeHidden();

    await expect(aliceOverlay).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await expect(activeBorder).toHaveCount(0);
    await aliceOverlay.hover();
    await expect(activeBorder).toHaveCount(1);
  });
});

test.describe('zoom and face editor interaction', () => {
  const fixture = setupAssetViewerFixture(902);

  test.beforeEach(async ({ context }) => {
    await setupFaceMocks(context, fixture);
  });

  test('zoom is preserved when entering face edit mode', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, -1);

    const imgLocator = page.locator('[data-viewer-content] img[data-testid="preview"]');
    await expect(async () => {
      const transform = await imgLocator.evaluate((element) => {
        return getComputedStyle(element.closest('[style*="transform"]') ?? element).transform;
      });
      expect(transform).not.toBe('none');
      expect(transform).not.toBe('');
    }).toPass({ timeout: 2000 });

    await ensureDetailPanelVisible(page);
    await page.getByLabel('Tag people').click();
    await page.locator('#face-selector').waitFor({ state: 'visible' });

    await expect(page.locator('#face-editor')).toBeVisible();

    const afterTransform = await imgLocator.evaluate((element) => {
      return getComputedStyle(element.closest('[style*="transform"]') ?? element).transform;
    });
    expect(afterTransform).not.toBe('none');
  });
});

test.describe('face overlay via detail panel interaction', () => {
  const fixture = setupAssetViewerFixture(903);

  test.beforeEach(async ({ context }) => {
    await setupFaceMocks(context, fixture);
  });

  test('hovering person in detail panel shows face overlay border', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await ensureDetailPanelVisible(page);

    const personLink = page.locator('#detail-panel a').filter({ hasText: 'Alice Johnson' });
    await expect(personLink).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await expect(activeBorder).toHaveCount(0);

    await personLink.hover();
    await expect(activeBorder).toHaveCount(1);
  });

  test('touch pointer on person in detail panel shows face overlay border', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await ensureDetailPanelVisible(page);

    const personLink = page.locator('#detail-panel a').filter({ hasText: 'Alice Johnson' });
    await expect(personLink).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await expect(activeBorder).toHaveCount(0);

    // Simulate a touch-type pointerover (the fix changed from onmouseover to onpointerover,
    // which fires for touch pointers unlike mouseover)
    await personLink.dispatchEvent('pointerover', { pointerType: 'touch' });
    await expect(activeBorder).toHaveCount(1);
  });

  test('hovering person in detail panel works after exiting face edit mode', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await ensureDetailPanelVisible(page);
    await page.getByLabel('Tag people').click();
    await page.locator('#face-selector').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.locator('#face-selector')).toBeHidden();

    const personLink = page.locator('#detail-panel a').filter({ hasText: 'Alice Johnson' });
    await expect(personLink).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await personLink.hover();
    await expect(activeBorder).toHaveCount(1);
  });
});

test.describe('face overlay via edit faces side panel', () => {
  const fixture = setupAssetViewerFixture(904);

  test.beforeEach(async ({ context }) => {
    await setupFaceMocks(context, fixture);

    const assetFaces = createMockAssetFaces(
      FACE_SPECS,
      fixture.primaryAssetDto.width ?? 3000,
      fixture.primaryAssetDto.height ?? 4000,
    );
    await setupGetFacesMockApiRoute(context, assetFaces);
  });

  test('hovering person in edit faces panel shows face overlay border', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);

    await ensureDetailPanelVisible(page);
    await page.getByLabel('Edit people').click();

    const faceThumbnail = page.getByTestId('face-thumbnail').first();
    await expect(faceThumbnail).toBeVisible();

    const activeBorder = page.locator('[data-viewer-content] .border-solid.border-white.border-3');
    await expect(activeBorder).toHaveCount(0);

    await faceThumbnail.hover();
    await expect(activeBorder).toHaveCount(1);
  });
});
