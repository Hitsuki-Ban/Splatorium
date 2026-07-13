import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneSelfImportDialog } from './scene-self-import-dialog'

afterEach(cleanup)

describe('SceneSelfImportDialog', () => {
  it('explains the duplicate-placement risk and requires explicit confirmation', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <SceneSelfImportDialog open onCancel={onCancel} onConfirm={onConfirm} />,
    )

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('このシーン自身を取り込みますか？')).toBeTruthy()
    expect(screen.getByText(/取り込んだ内容はコピーとして固定され/)).toBeTruthy()
    expect(screen.getByText(/配置が二重に増えていきます/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms once without reporting the controlled close as a cancellation', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <SceneSelfImportDialog open onCancel={onCancel} onConfirm={onConfirm} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
