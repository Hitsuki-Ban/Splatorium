import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneReimportDialog } from './scene-reimport-dialog'

afterEach(cleanup)

describe('SceneReimportDialog', () => {
  it('requires an explicit overwrite confirmation for local changes', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <SceneReimportDialog
        open
        nodeName="Imported scene"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('ローカル変更を上書きしますか？')).toBeTruthy()
    expect(screen.getByText(/Imported scene/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '上書きして取り込む' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
