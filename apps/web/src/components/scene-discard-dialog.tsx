import { useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

export type SceneDiscardAction = 'open' | 'clear'

const COPY: Record<SceneDiscardAction, {
  title: string
  description: string
  confirmLabel: string
}> = {
  open: {
    title: '未保存の変更を破棄してシーンを開きますか？',
    description:
      '現在の未保存の変更は失われ、Undo/Redo の履歴もすべて消去されます。この操作は元に戻せません。',
    confirmLabel: '破棄して開く',
  },
  clear: {
    title: 'シーンをクリアしますか？',
    description: '現在のシーンをクリアします。クリア後も Ctrl+Z で元に戻せます。',
    confirmLabel: 'クリア',
  },
}

export function SceneDiscardDialog({
  action,
  open,
  onCancel,
  onConfirm,
}: {
  action: SceneDiscardAction
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const confirming = useRef(false)
  const copy = COPY[action]

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        if (confirming.current) {
          confirming.current = false
          return
        }
        onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => {
              confirming.current = true
              onConfirm()
            }}
          >
            {copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
