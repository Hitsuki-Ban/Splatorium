import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadDropzone } from './upload-dropzone'

afterEach(cleanup)

describe('UploadDropzone', () => {
  it('exposes accessible names for generation controls', () => {
    render(<UploadDropzone submitting={false} onSubmit={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Gaussian 数' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'seed（空欄でランダム）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '3D 生成を開始' })).toBeTruthy()
  })
})
