import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function SceneReimportDialog({
  nodeName,
  open,
  onCancel,
  onConfirm,
}: {
  nodeName: string
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>ローカル変更を上書きしますか？</DialogTitle>
          <DialogDescription>
            「{nodeName}」の子ノードには取込後の変更があります。最新の元シーンを取り込むと、
            これらの変更は置き換えられます。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>上書きして取り込む</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
