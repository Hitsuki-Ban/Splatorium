import { UploadDropzone } from '@/components/upload-dropzone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function UploadDialog({
  open,
  onOpenChange,
  submitting,
  initialFile,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitting: boolean
  /** 画面全体へのドロップで渡されたファイル（ダイアログを開くたびに反映） */
  initialFile: File | null
  onSubmit: (file: File, opts: { numGaussians: number; seed?: number }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>画像から 3D 生成</DialogTitle>
          <DialogDescription>
            画像 1 枚から TripoSplat で 3D Gaussian Splat を生成し、倉庫に保存します。
          </DialogDescription>
        </DialogHeader>
        {/* open のたびに remount して initialFile と入力状態をリセットする */}
        {open && (
          <UploadDropzone
            submitting={submitting}
            initialFile={initialFile}
            onSubmit={(file, opts) => {
              onSubmit(file, opts)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
