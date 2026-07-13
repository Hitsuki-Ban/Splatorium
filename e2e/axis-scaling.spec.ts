import { expect, test, type Locator, type Page } from '@playwright/test'

interface ShapeMetrics {
  pixels: number
  aspectRatio: number
  width: number
  height: number
  majorAxisAngleDegrees: number
}

async function measureRedSplat(page: Page, canvas: Locator): Promise<ShapeMetrics> {
  const screenshot = await canvas.screenshot()
  return page.evaluate(async (dataUrl) => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const surface = document.createElement('canvas')
    surface.width = image.width
    surface.height = image.height
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas context is unavailable')
    context.drawImage(image, 0, 0)
    const rgba = context.getImageData(0, 0, image.width, image.height).data
    const points: Array<[number, number]> = []
    const left = Math.floor(image.width * 0.2)
    const right = Math.ceil(image.width * 0.8)
    const top = Math.floor(image.height * 0.1)
    const bottom = Math.ceil(image.height * 0.8)
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * image.width + x) * 4
        const red = rgba[offset]
        const green = rgba[offset + 1]
        const blue = rgba[offset + 2]
        if (red > 140 && red - green > 30 && red - blue > 30) points.push([x, y])
      }
    }
    if (points.length < 50) throw new Error(`red splat mask is too small: ${points.length}`)

    const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length
    let xx = 0
    let yy = 0
    let xy = 0
    for (const [x, y] of points) {
      const dx = x - meanX
      const dy = y - meanY
      xx += dx * dx
      yy += dy * dy
      xy += dx * dy
    }
    xx /= points.length
    yy /= points.length
    xy /= points.length
    const average = (xx + yy) / 2
    const delta = Math.sqrt(((xx - yy) / 2) ** 2 + xy ** 2)
    const major = average + delta
    const minor = average - delta
    if (!(minor > 0)) throw new Error('red splat mask has no minor-axis variance')
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const angle = (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI
    return {
      pixels: points.length,
      aspectRatio: Math.sqrt(major / minor),
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
      majorAxisAngleDegrees: Math.abs(angle),
    }
  }, `data:image/png;base64,${screenshot.toString('base64')}`)
}

test('renders anisotropic splat scale and toggles uniform/axis scale gizmos', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('server: ok')).toBeVisible()

  const scaleButton = () => page.getByRole('button', { name: /拡縮（(?:等比|軸別)）/ })
  await expect(scaleButton()).toContainText('拡縮（等比）')
  await page.keyboard.press('r')
  await page.keyboard.press('r')
  await expect(scaleButton()).toContainText('拡縮（軸別）')
  await page.keyboard.press('w')
  await page.keyboard.press('r')
  await expect(scaleButton()).toContainText('拡縮（軸別）')
  await scaleButton().click()
  await expect(scaleButton()).toContainText('拡縮（等比）')

  await page.getByText('復旧モデル', { exact: true }).click()
  await page.getByRole('button', { name: 'シーンへ追加' }).first().click()
  const viewport = page.getByRole('region', { name: /3D ビューポート/ })
  await expect(
    page.getByRole('region', { name: '3D ビューポート（モデル 1/1 読み込み完了）' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  const baseline = await measureRedSplat(page, viewport.locator('canvas'))

  await page.getByRole('treeitem', { name: /復旧モデル/ }).click()
  await page.getByRole('button', { name: '軸別に指定' }).click()
  const reload = page.waitForResponse(
    (response) =>
      response.url().includes('/api/assets/00000000-0000-4000-8000-000000000099/files/main') &&
      response.status() === 200,
  )
  const scaleX = page.getByRole('textbox', { name: 'スケール X' })
  await scaleX.fill('2')
  await scaleX.press('Enter')
  await reload
  await expect(
    page.getByRole('region', { name: '3D ビューポート（モデル 1/1 読み込み完了）' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  const stretched = await measureRedSplat(page, viewport.locator('canvas'))

  await page.getByRole('treeitem', { name: /復旧モデル/ }).click()
  const rotationZ = page.getByRole('textbox', { name: '回転 Z（度）' })
  await rotationZ.fill('90')
  await rotationZ.press('Enter')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('Escape')
  const rotated = await measureRedSplat(page, viewport.locator('canvas'))

  expect(baseline.aspectRatio).toBeLessThan(1.2)
  expect(stretched.aspectRatio).toBeGreaterThan(1.5)
  expect(stretched.aspectRatio).toBeGreaterThan(baseline.aspectRatio * 1.4)
  expect(stretched.pixels).toBeGreaterThan(baseline.pixels * 1.5)
  expect(stretched.width).toBeGreaterThanOrEqual(baseline.width * 1.5)
  expect(stretched.height).toBeLessThan(baseline.height * 1.35)
  expect(stretched.majorAxisAngleDegrees).toBeLessThan(35)
  expect(rotated.aspectRatio).toBeGreaterThan(1.5)
  expect(rotated.width).toBeLessThan(baseline.width * 1.35)
  expect(rotated.height).toBeGreaterThan(baseline.height * 1.5)
  expect(rotated.majorAxisAngleDegrees).toBeGreaterThan(70)
})
