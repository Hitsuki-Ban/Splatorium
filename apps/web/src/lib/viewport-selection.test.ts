import { describe, expect, it } from 'vitest'
import { isClickGesture, pointerToNdc } from './viewport-selection'

describe('isClickGesture', () => {
  it('4px 以内の pointer 移動を click と判定する', () => {
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(true)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true)
  })

  it('4px を超える OrbitControls drag を click にしない', () => {
    expect(isClickGesture({ x: 10, y: 10 }, { x: 14, y: 11 })).toBe(false)
  })
})

describe('pointerToNdc', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it('CSS 表示領域の中心を NDC 原点へ変換する', () => {
    expect(pointerToNdc({ x: 300, y: 150 }, rect)).toEqual([0, 0])
  })

  it('CSS 表示領域の四隅を NDC へ変換する', () => {
    expect(pointerToNdc({ x: 100, y: 50 }, rect)).toEqual([-1, 1])
    expect(pointerToNdc({ x: 500, y: 250 }, rect)).toEqual([1, -1])
  })

  it('表示領域が空なら失敗する', () => {
    expect(() => pointerToNdc({ x: 0, y: 0 }, { ...rect, width: 0 })).toThrow(
      'ビューポートの表示領域が空です',
    )
  })
})
