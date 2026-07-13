import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

test('shows complete offline About content and closes it below the supported width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await page.goto('/')
  await expect(page.getByText('server: ok')).toBeVisible()

  await page.getByRole('button', { name: 'Splatorium について' }).click()
  const dialog = page.getByRole('dialog', { name: 'Splatorium' })
  await expect(dialog).toContainText('Built with DINOv3')
  await expect(dialog).toContainText(`バージョン ${packageJson.version}`)
  await expect(dialog.getByText('# Third-party licenses and model notices')).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'https://github.com/Hitsuki-Ban/Splatorium' }))
    .toHaveAttribute('href', 'https://github.com/Hitsuki-Ban/Splatorium')

  await page.setViewportSize({ width: 899, height: 720 })
  await expect(page.getByRole('status')).toBeVisible()
  await expect(dialog).toHaveCount(0)

  await page.setViewportSize({ width: 900, height: 720 })
  await expect(page.getByRole('status')).toBeHidden()
  await expect(dialog).toHaveCount(0)
})
