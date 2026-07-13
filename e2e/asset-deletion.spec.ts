import { expect, test } from '@playwright/test'

test('deletes unreferenced and referenced assets while preserving broken scene nodes', async ({
  context,
  page,
}) => {
  const remotePage = await context.newPage()
  await Promise.all([page.goto('/'), remotePage.goto('/')])
  await Promise.all([
    expect(page.getByText('server: ok')).toBeVisible(),
    expect(remotePage.getByText('server: ok')).toBeVisible(),
  ])

  await remotePage.getByText('未参照モデル', { exact: true }).click()
  await remotePage.getByRole('button', { name: 'プレビューで開く' }).click()
  await expect(remotePage.getByRole('button', { name: 'シーン編集へ戻る' })).toBeVisible()

  await page.getByRole('button', { name: '未参照モデルを削除' }).click()
  await expect(page.getByRole('alertdialog')).toContainText(
    'このアセットを削除します。元に戻せません。',
  )
  await page.getByRole('alertdialog').getByRole('button', { name: '削除' }).click()
  await expect(page.getByText('未参照モデル', { exact: true })).toHaveCount(0)
  await expect(remotePage.getByText('未参照モデル', { exact: true })).toHaveCount(0)
  await expect(remotePage.getByRole('button', { name: 'シーン編集へ戻る' })).toHaveCount(0)
  await expect(remotePage.getByText('アセットを選択すると詳細が表示されます。')).toBeVisible()

  await page.getByText('参照モデル', { exact: true }).click()
  await page.getByRole('button', { name: 'シーンへ追加' }).first().click()
  await page.getByRole('textbox', { name: 'シーン名' }).fill('参照シーン')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText(/「参照シーン」を倉庫に保存しました/)).toBeVisible()

  await page.getByRole('button', { name: '参照モデルを削除' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('参照シーン')
  await expect(dialog).toContainText('該当配置が参照切れになります')
  await dialog.getByRole('button', { name: '削除' }).click()

  await expect(page.getByText('参照切れ', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('参照先のアセットが削除されています')
  const overwrite = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/scenes/') &&
      response.status() === 200,
  )
  await page.getByRole('button', { name: '上書き保存' }).click()
  await overwrite

  await page.reload()
  await expect(page.getByText('server: ok')).toBeVisible()
  await page.getByRole('radio', { name: /^シーン/ }).click()
  await page.getByText('参照シーン', { exact: true }).dblclick()
  await expect(page.getByText('参照切れ', { exact: true })).toBeVisible()
  await page.getByText('参照モデル', { exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('参照先のアセットが削除されています')

  await page.getByRole('button', { name: '参照先を変更…' }).click()
  const redirectDialog = page.getByRole('dialog', { name: '参照先を変更' })
  await redirectDialog.getByRole('textbox', { name: 'モデルを検索' }).fill('復旧モデル')
  await redirectDialog.getByRole('radio', { name: /復旧モデル/ }).click()
  await redirectDialog.getByRole('radio', { name: /このノードのみ/ }).click()

  await page.setViewportSize({ width: 375, height: 720 })
  await expect(page.getByRole('status')).toBeVisible()
  await expect(redirectDialog).toHaveCount(0)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await page.setViewportSize({ width: 900, height: 720 })
  await expect(page.getByRole('status')).toBeHidden()
  await expect(page.getByText('参照切れ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '参照先を変更…' }).click()
  await redirectDialog.getByRole('textbox', { name: 'モデルを検索' }).fill('復旧モデル')
  await redirectDialog.getByRole('radio', { name: /復旧モデル/ }).click()
  await redirectDialog.getByRole('radio', { name: /このノードのみ/ }).click()
  const replacementRequest = page.waitForRequest((request) =>
    request.url().includes('/api/assets/00000000-0000-4000-8000-000000000099/files/main'),
  )
  await redirectDialog.getByRole('button', { name: '変更を適用' }).click()
  await replacementRequest
  await expect(
    page.getByRole('region', { name: '3D ビューポート（モデル 1/1 読み込み完了）' }),
  ).toBeVisible()
  await expect(page.getByText('参照切れ', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('complementary').getByText('復旧モデル', { exact: true })).toBeVisible()
})
