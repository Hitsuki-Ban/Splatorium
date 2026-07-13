export const PICK_CLICK_DISTANCE = 4

export interface PointerPosition {
  x: number
  y: number
}

export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

export function isClickGesture(start: PointerPosition, end: PointerPosition): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return dx * dx + dy * dy <= PICK_CLICK_DISTANCE * PICK_CLICK_DISTANCE
}

export function pointerToNdc(pointer: PointerPosition, rect: ViewportRect): [number, number] {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('ビューポートの表示領域が空です')
  }
  return [
    ((pointer.x - rect.left) / rect.width) * 2 - 1,
    -((pointer.y - rect.top) / rect.height) * 2 + 1,
  ]
}
