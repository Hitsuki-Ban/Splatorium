import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSceneStore } from '@/stores/scene-store'
import type { SceneNode, SceneTransform } from '@splatorium/shared'
import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const AXES = ['X', 'Y', 'Z'] as const
const MIN_ABSOLUTE_SCALE = 1e-6
const INVALID_SCALE_MESSAGE = 'スケールは絶対値 0.000001 以上で入力してください。'

function formatNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.001) return String(value)
  return String(Number(value.toFixed(3)))
}

/** ユニフォーム値（全軸が実質同値ならその値、混在なら null） */
function uniformScale(scale: readonly number[]): number | null {
  return Math.abs(scale[0] - scale[1]) < 1e-6 && Math.abs(scale[0] - scale[2]) < 1e-6
    ? scale[0]
    : null
}

/**
 * フォーカス中はローカル draft、非フォーカス時は props 値を表示する数値欄。
 * ギズモ操作による外部更新が開いているインスペクタへ即時反映される
 */
function NumberField({
  value,
  onCommit,
  label,
  placeholder,
}: {
  value: number | null
  onCommit: (value: number) => void
  label: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState<{ value: string; dirty: boolean } | null>(null)
  const cancelBlurRef = useRef(false)

  const commitDraft = () => {
    if (draft === null) return
    setDraft(null)
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      return
    }
    if (!draft.dirty || draft.value.trim() === '') return
    const parsed = Number(draft.value)
    if (!Number.isFinite(parsed)) return
    if (value !== null && Math.abs(parsed - value) < 1e-9) return
    onCommit(parsed)
  }

  return (
    <Input
      value={draft?.value ?? (value === null ? '' : formatNumber(value))}
      placeholder={placeholder}
      inputMode="decimal"
      aria-label={label}
      className="h-7 px-1.5 text-xs"
      onFocus={() => {
        cancelBlurRef.current = false
        setDraft({ value: value === null ? '' : formatNumber(value), dirty: false })
      }}
      onChange={(event) => setDraft({ value: event.target.value, dirty: true })}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelBlurRef.current = true
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * 選択ノードの Transform 数値入力。
 * スケールは既定ユニフォーム 1 欄、軸別は詳細展開（段階的開示）。
 * 各確定は commitNodeTransform 経由で Undo 履歴 1 step になる
 */
export function NodeTransformFields({ node }: { node: SceneNode }) {
  const commitNodeTransform = useSceneStore((state) => state.commitNodeTransform)
  const transformPreview = useSceneStore((state) => state.transformPreview)
  const [showAxisScale, setShowAxisScale] = useState(false)
  const transform = transformPreview?.nodeId === node.id ? transformPreview.transform : node.transform

  const commit = (transform: SceneTransform) => {
    const result = commitNodeTransform(node.id, transform)
    if (!result.ok) toast.error(result.error.message)
  }

  const commitScale = (value: number, transform: SceneTransform) => {
    if (Math.abs(value) < MIN_ABSOLUTE_SCALE) {
      toast.error(INVALID_SCALE_MESSAGE)
      return
    }
    commit(transform)
  }

  const withComponent = (
    key: keyof SceneTransform,
    axis: number,
    value: number,
  ): SceneTransform => {
    const next: SceneTransform = {
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    }
    next[key][axis] = value
    return next
  }

  const uniform = uniformScale(transform.scale)

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">トランスフォーム</p>
      <div className="grid grid-cols-[2.75rem_1fr_1fr_1fr] items-center gap-1">
        <span />
        {AXES.map((axis) => (
          <span key={axis} className="text-center text-[10px] text-muted-foreground">
            {axis}
          </span>
        ))}
        <span className="text-xs text-muted-foreground">位置</span>
        {AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={`位置 ${axis}`}
            value={transform.position[i]}
            onCommit={(value) => commit(withComponent('position', i, value))}
          />
        ))}
        <span className="text-xs text-muted-foreground">回転°</span>
        {AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={`回転 ${axis}（度）`}
            value={transform.rotation[i] * RAD_TO_DEG}
            onCommit={(value) => commit(withComponent('rotation', i, value * DEG_TO_RAD))}
          />
        ))}
        <span className="text-xs text-muted-foreground">スケール</span>
        <NumberField
          label="スケール（ユニフォーム）"
          value={uniform}
          placeholder="混在"
          onCommit={(value) =>
            commitScale(value, {
              position: [...transform.position],
              rotation: [...transform.rotation],
              scale: [value, value, value],
            })
          }
        />
        <Button
          size="sm"
          variant="ghost"
          className="col-span-2 h-7 justify-start px-1.5 text-xs text-muted-foreground"
          aria-expanded={showAxisScale}
          onClick={() => setShowAxisScale((prev) => !prev)}
        >
          <ChevronRight
            className={`size-3.5 transition-transform ${showAxisScale ? 'rotate-90' : ''}`}
          />
          軸別に指定
        </Button>
        {showAxisScale && (
          <>
            <span className="text-xs text-muted-foreground" />
            {AXES.map((axis, i) => (
              <NumberField
                key={axis}
                label={`スケール ${axis}`}
                value={transform.scale[i]}
                onCommit={(value) => commitScale(value, withComponent('scale', i, value))}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
