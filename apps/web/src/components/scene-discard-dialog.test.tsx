import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneDiscardDialog } from './scene-discard-dialog'

afterEach(cleanup)

describe('SceneDiscardDialog', () => {
  it('explains that opening discards unsaved changes and clears Undo/Redo history', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <SceneDiscardDialog
        action="open"
        open
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('未保存の変更を破棄してシーンを開きますか？')).toBeTruthy()
    expect(screen.getByText(/未保存の変更は失われ/)).toBeTruthy()
    expect(screen.getByText(/Undo\/Redo の履歴もすべて消去/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('explains that clearing can be restored with Ctrl+Z and confirms once', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <SceneDiscardDialog
        action="clear"
        open
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('シーンをクリアしますか？')).toBeTruthy()
    expect(screen.getByText(/Ctrl\+Z で元に戻せます/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
