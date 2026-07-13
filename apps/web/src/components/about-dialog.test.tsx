import packageJson from '../../../../package.json'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { REPOSITORY_URL } from '@/lib/product-info'
import { AboutDialog } from './about-dialog'

afterEach(cleanup)

describe('AboutDialog', () => {
  it('shows the required DINOv3 notice, package version, licenses, and repository', () => {
    render(<AboutDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Splatorium について' }))

    const dialog = screen.getByRole('dialog', { name: 'Splatorium' })
    expect(dialog.textContent).toContain(`バージョン ${packageJson.version}`)
    expect(dialog.textContent).toContain('Built with DINOv3')
    expect(dialog.textContent).toContain('# Third-party licenses and model notices')
    expect(screen.getByRole('link', { name: REPOSITORY_URL }).getAttribute('href')).toBe(
      REPOSITORY_URL,
    )
  })
})
