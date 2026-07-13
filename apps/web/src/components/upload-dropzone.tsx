import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_GAUSSIANS, GAUSSIAN_PRESETS } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface UploadDropzoneProps {
  submitting: boolean
  onSubmit: (file: File, opts: { numGaussians: number; seed?: number }) => void
  /** 画面全体へのドロップ等、外から渡された初期ファイル */
  initialFile?: File | null
}

export function UploadDropzone({ submitting, onSubmit, initialFile }: UploadDropzoneProps) {
  const [file, setFile] = useState<File | null>(initialFile ?? null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [numGaussians, setNumGaussians] = useState(DEFAULT_GAUSSIANS)
  const [seed, setSeed] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (picked: File | undefined) => {
    if (picked && picked.type.startsWith('image/')) setFile(picked)
  }

  return (
    <div className="flex gap-4">
      <button
        type="button"
        aria-label="画像を選択またはドロップ"
        className={cn(
          'flex h-28 flex-1 cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors',
          dragging ? 'border-ring bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files[0])
        }}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt={file?.name ?? ''}
              className="h-20 w-20 rounded-md border object-cover"
            />
            <div className="text-left">
              <p className="max-w-56 truncate font-medium text-foreground">{file?.name}</p>
              <p className="text-xs">クリックで差し替え / ドロップでも可</p>
            </div>
          </>
        ) : (
          <>
            <ImagePlus className="size-6" />
            <span>ここに画像をドロップ、またはクリックして選択</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </button>

      <div className="flex w-56 flex-col justify-between gap-2">
        <div className="space-y-2">
          <Select
            value={String(numGaussians)}
            onValueChange={(v) => setNumGaussians(Number(v))}
          >
            <SelectTrigger className="w-full" aria-label="Gaussian 数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GAUSSIAN_PRESETS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n.toLocaleString()} gaussians
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            aria-label="seed（空欄でランダム）"
            placeholder="seed（空欄でランダム）"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </div>
        <Button
          disabled={!file || submitting}
          onClick={() => {
            if (!file) return
            onSubmit(file, {
              numGaussians,
              seed: seed === '' ? undefined : Number(seed),
            })
          }}
        >
          {submitting ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles data-testid="generate-icon" />
          )}
          3D 生成を開始
        </Button>
      </div>
    </div>
  )
}
