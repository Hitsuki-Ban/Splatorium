import { expect, test, type Locator, type Page } from '@playwright/test'

test('guards unsupported widths and restores the intact workbench at 900px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await page.goto('/')
  await expect(page).toHaveTitle('Splatorium')
  await expect(page.getByRole('heading', { name: 'Splatorium', exact: true })).toBeVisible()
  await expect(page.getByText('スプラット標本館 ─ 1 枚の絵から、立体標本。')).toBeVisible()
  await expect(page.getByText('server: ok')).toBeVisible()
  await expect(page.getByText('ウィンドウ幅が不足しています')).toBeHidden()

  await page.getByRole('button', { name: 'グループを作成' }).click()
  await expect(page.getByRole('treeitem')).toHaveCount(1)
  const sceneName = page.getByRole('textbox', { name: 'シーン名' })
  await sceneName.fill('幅保持テスト')
  await assertHorizontallyReachable(page, page.getByRole('button', { name: '保存', exact: true }))
  await assertHorizontallyReachable(page, page.getByRole('heading', { name: 'ツリー' }))
  await assertHorizontallyReachable(page, page.getByRole('heading', { name: 'インスペクタ' }))
  await assertHorizontallyReachable(page, page.getByRole('button', { name: '視点リセット' }))

  await page.setViewportSize({ width: 899, height: 720 })
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.locator('.workbench-shell')).toHaveAttribute('inert', '')
  await page.keyboard.type('変更')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')

  await page.setViewportSize({ width: 375, height: 720 })
  const notice = page.getByRole('status')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(
    'Splatorium はデスクトップ向けです。ウィンドウ幅 900px 以上でご利用ください。',
  )

  await page.setViewportSize({ width: 900, height: 720 })
  await expect(notice).toBeHidden()
  await expect(page.getByRole('treeitem')).toHaveCount(1)
  await expect(sceneName).toHaveValue('幅保持テスト')
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
})

test('keeps primary controls reachable at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByText('server: ok')).toBeVisible()

  await assertHorizontallyReachable(page, page.getByRole('button', { name: '保存', exact: true }))
  await assertHorizontallyReachable(page, page.getByRole('heading', { name: 'ツリー' }))
  await assertHorizontallyReachable(page, page.getByRole('heading', { name: 'インスペクタ' }))
  await assertHorizontallyReachable(page, page.getByRole('button', { name: '視点リセット' }))
})

test('dismisses a portal dialog before hiding the workbench', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await page.goto('/')
  await expect(page.getByText('server: ok')).toBeVisible()

  await page.getByRole('button', { name: 'グループを作成' }).click()
  await page.getByRole('button', { name: 'クリア' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()

  await page.setViewportSize({ width: 375, height: 720 })
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await page.setViewportSize({ width: 900, height: 720 })
  await expect(page.getByRole('status')).toBeHidden()
  await expect(page.getByRole('treeitem')).toHaveCount(1)
})

async function assertHorizontallyReachable(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
}
