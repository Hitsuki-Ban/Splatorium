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

export function SceneSelfImportDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const confirming = useRef(false)

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
          <AlertDialogTitle>このシーン自身を取り込みますか？</AlertDialogTitle>
          <AlertDialogDescription>
            このシーン自身を取り込もうとしています。取り込んだ内容はコピーとして固定され、
            更新の取り込みを繰り返すと配置が二重に増えていきます。続けますか？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirming.current = true
              onConfirm()
            }}
          >
            取り込む
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
