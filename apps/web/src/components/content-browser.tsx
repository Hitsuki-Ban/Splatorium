import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Progress } from '@/components/ui/progress'
import { assetFileUrl, assetThumbnailUrl } from '@/lib/api'
import {
  readViewPrefs,
  saveViewPrefs,
  THUMB_MAX,
  THUMB_MIN,
  type ViewMode,
  type ViewPrefs,
} from '@/lib/content-browser-prefs'
import { JOB_STATUS_LABEL, isActiveJob, isVisibleJob, type JobEntry } from '@/lib/jobs'
import { ASSET_DRAG_MIME } from '@/lib/scene-dnd'
import { cn } from '@/lib/utils'
import type { Asset, AssetKind } from '@splatorium/shared'
import {
  Box,
  Boxes,
  CopyPlus,
  FileImage,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  Layers,
  List,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState, type DragEvent as ReactDragEvent } from 'react'

const kindIcon = {
  splat: Box,
  mesh: Boxes,
  image: FileImage,
  scene: Layers,
} as const

/**
 * 倉庫で管理するのはモデルとシーンだけ。
 * 画像はモデルの付属情報としてインスペクタで見せる。「すべて」区分は持たない
 */
type BrowserSection = 'model' | 'scene'

const SECTION_KINDS: Record<BrowserSection, readonly AssetKind[]> = {
  model: ['splat', 'mesh'],
  scene: ['scene'],
}

type ViewPrefsState =
  | { phase: 'ready'; value: ViewPrefs }
  | { phase: 'error'; message: string }

const SECTIONS: { value: BrowserSection; label: string; kinds: readonly AssetKind[] }[] = [
  { value: 'model', label: 'モデル', kinds: SECTION_KINDS.model },
  { value: 'scene', label: 'シーン', kinds: SECTION_KINDS.scene },
]

function sectionKinds(section: BrowserSection): readonly AssetKind[] {
  return SECTION_KINDS[section]
}

function toPrefsError(error: unknown): ViewPrefsState {
  return {
    phase: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
}

function loadViewPrefs(): ViewPrefsState {
  try {
    return { phase: 'ready', value: readViewPrefs() }
  } catch (error) {
    return toPrefsError(error)
  }
}

/**
 * サムネイル解決（原則: source を無印で代用しない）。
 * image は main 自体が画像。splat/scene は thumbnail role を最優先し、
 * splat は source（入力画像）を「元画像」バッジ付きで代用する。
 */
function resolveThumb(asset: Asset, revision: string | undefined): { url: string | null; isSource: boolean } {
  if (asset.kind === 'image') return { url: assetFileUrl(asset.id, 'main'), isSource: false }
  if (asset.files.thumbnail && revision) {
    return { url: assetThumbnailUrl(asset.id, revision), isSource: false }
  }
  if (asset.kind === 'splat' && asset.files.source) {
    return { url: assetFileUrl(asset.id, 'source'), isSource: true }
  }
  return { url: null, isSource: false }
}

function AssetActionButton({
  asset,
  onAddToScene,
  onImportScene,
  onOpenAsset,
  onRequestDelete,
  className,
}: {
  asset: Asset
  onAddToScene: (asset: Asset) => void
  onImportScene: (asset: Asset) => void
  onOpenAsset: (asset: Asset) => void
  onRequestDelete: (asset: Asset) => void
  className?: string
}) {
  return (
    <span className={cn('flex gap-1', className)}>
      {asset.kind === 'splat' && (
        <Button
          size="icon"
          variant="secondary"
          className="size-7"
          aria-label="シーンへ追加"
          title="シーンへ追加"
          onClick={() => onAddToScene(asset)}
        >
          <Plus />
        </Button>
      )}
      {asset.kind === 'scene' && (
        <>
          <Button
            size="icon"
            variant="secondary"
            className="size-7"
            aria-label="シーンを取り込む"
            title="シーンをルートへ取り込む"
            onClick={() => onImportScene(asset)}
          >
            <CopyPlus />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="size-7"
            aria-label="シーンを開く"
            title="シーンを開く"
            onClick={() => onOpenAsset(asset)}
          >
            <FolderOpen />
          </Button>
        </>
      )}
      <Button
        size="icon"
        variant="destructive"
        className="size-7"
        aria-label={`${asset.name}を削除`}
        title="アセットを削除"
        onClick={() => onRequestDelete(asset)}
      >
        <Trash2 />
      </Button>
    </span>
  )
}

/** splat は配置、scene は copy import としてシーンツリーへ D&D できる。 */
function isAssetDraggable(asset: Asset): boolean {
  return asset.kind === 'splat' || asset.kind === 'scene'
}

function startAssetDrag(event: ReactDragEvent, asset: Asset): void {
  if (!isAssetDraggable(asset)) return
  event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: asset.id }))
  event.dataTransfer.effectAllowed = 'copy'
}

function assetInteractionTitle(asset: Asset): string {
  if (asset.kind === 'scene') {
    return 'ダブルクリックで開く / ドラッグでシーンツリーへ取込'
  }
  if (asset.kind === 'splat') {
    return 'ダブルクリックで開く / ドラッグでシーンツリーへ配置'
  }
  return 'ダブルクリックで開く'
}

function jobStatusDetail(entry: JobEntry): string {
  const { job } = entry
  if (entry.promotionError) return entry.promotionError
  if (job.status === 'failed') return job.error ?? '失敗しました'
  if (job.status === 'succeeded') return '完成アセットを同期中…'
  return job.statusText ?? `${JOB_STATUS_LABEL[job.status]} ${job.progress}%`
}

function JobActions({
  entry,
  onRetry,
  onSync,
  onDismiss,
  className,
}: {
  entry: JobEntry
  onRetry: (entry: JobEntry) => void
  onSync: (entry: JobEntry) => void
  onDismiss: (jobId: string) => void
  className?: string
}) {
  // 再試行は入力画像アセットとパラメータが残っている場合のみ（ローカル失敗は破棄のみ）
  const canRetry =
    entry.job.status === 'failed' && !!entry.job.inputAssetIds[0] && !!entry.job.params
  return (
    <span className={cn('flex items-center gap-1', className)}>
      {canRetry && (
        <Button
          size="icon"
          variant="secondary"
          className="size-6"
          aria-label="再試行"
          title="同じ画像・パラメータで再試行"
          onClick={() => onRetry(entry)}
        >
          <RotateCcw />
        </Button>
      )}
      {entry.job.status === 'succeeded' && entry.promotionError && (
        <Button
          size="icon"
          variant="secondary"
          className="size-6"
          aria-label="完成アセットを再同期"
          title="完成アセットを再同期"
          onClick={() => onSync(entry)}
        >
          <RefreshCw />
        </Button>
      )}
      <Button
        size="icon"
        variant="secondary"
        className="size-6"
        aria-label="このジョブ表示を破棄"
        title="このジョブ表示を破棄"
        onClick={() => onDismiss(entry.job.id)}
      >
        <X />
      </Button>
    </span>
  )
}

/** 生成中/失敗ジョブのインラインタイル（Midjourney Create 方式。完了すると
 * 同じグリッド上で完成アセットのタイルに置き換わる） */
function JobTile({
  entry,
  width,
  onRetry,
  onSync,
  onDismiss,
}: {
  entry: JobEntry
  width: number
  onRetry: (entry: JobEntry) => void
  onSync: (entry: JobEntry) => void
  onDismiss: (jobId: string) => void
}) {
  const failed = entry.job.status === 'failed'
  const syncFailed = entry.job.status === 'succeeded' && !!entry.promotionError
  const hasError = failed || syncFailed
  return (
    <li style={{ width }}>
      <div
        className={cn(
          'group relative flex flex-col gap-1.5 rounded-md border p-2',
          hasError ? 'border-destructive/60' : 'border-dashed',
        )}
      >
        <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded bg-muted/40 p-2">
          {hasError ? (
            <TriangleAlert className="size-6 text-destructive" />
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
          {isActiveJob(entry.job) && <Progress value={entry.job.progress} className="h-1 w-3/4" />}
        </span>
        <span className="min-w-0 truncate text-xs font-medium" title={entry.label}>
          {entry.label}
        </span>
        <span
          className={cn(
            'min-w-0 truncate text-[10px]',
            hasError ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={jobStatusDetail(entry)}
        >
          {jobStatusDetail(entry)}
        </span>
        {hasError && (
          <JobActions
            entry={entry}
            onRetry={onRetry}
            onSync={onSync}
            onDismiss={onDismiss}
            className="absolute top-1.5 right-1.5"
          />
        )}
      </div>
    </li>
  )
}

/** リスト表示用のジョブ行 */
function JobRow({
  entry,
  onRetry,
  onSync,
  onDismiss,
}: {
  entry: JobEntry
  onRetry: (entry: JobEntry) => void
  onSync: (entry: JobEntry) => void
  onDismiss: (jobId: string) => void
}) {
  const failed = entry.job.status === 'failed'
  const syncFailed = entry.job.status === 'succeeded' && !!entry.promotionError
  const hasError = failed || syncFailed
  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm',
          hasError ? 'border-destructive/60' : 'border-dashed',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted/40">
          {hasError ? (
            <TriangleAlert className="size-4 text-destructive" />
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate" title={entry.label}>
          {entry.label}
        </span>
        {isActiveJob(entry.job) && <Progress value={entry.job.progress} className="h-1 w-24 shrink-0" />}
        <span
          className={cn(
            'max-w-56 shrink-0 truncate text-xs',
            hasError ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={jobStatusDetail(entry)}
        >
          {jobStatusDetail(entry)}
        </span>
        {hasError && (
          <JobActions entry={entry} onRetry={onRetry} onSync={onSync} onDismiss={onDismiss} />
        )}
      </div>
    </li>
  )
}

function AssetThumb({
  asset,
  revision,
  className,
}: {
  asset: Asset
  revision: string | undefined
  className?: string
}) {
  const Icon = kindIcon[asset.kind]
  const thumb = resolveThumb(asset, revision)
  return (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded bg-muted/40',
        className,
      )}
    >
      {thumb.url ? (
        <img
          src={thumb.url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <>
          <Icon className="size-1/3 min-h-4 min-w-4 text-muted-foreground" />
          <span className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[9px] leading-4 text-muted-foreground">
            未生成
          </span>
        </>
      )}
      {thumb.isSource && (
        <span
          className="absolute bottom-1 left-1 rounded bg-background/80 px-1 text-[9px] leading-4 text-muted-foreground"
          title="生成元の入力画像を表示しています（3D サムネイルは未生成）"
        >
          元画像
        </span>
      )}
    </span>
  )
}

export function ContentBrowser({
  assets,
  assetRevisions,
  jobs,
  highlightIds,
  selectedId,
  onSelect,
  onAddToScene,
  onImportScene,
  onOpenAsset,
  onRequestDelete,
  onRequestUpload,
  onRetryJob,
  onSyncJob,
  onDismissJob,
}: {
  assets: Asset[]
  assetRevisions: ReadonlyMap<string, string>
  /** 生成中・失敗ジョブと、完成アセットの同期を待っている完了ジョブ */
  jobs: JobEntry[]
  /** 生成完了直後のハイライト対象アセット id */
  highlightIds: ReadonlySet<string>
  selectedId: string | null
  /** シングルクリック: インスペクタ表示のみ（ビューポートは変えない） */
  onSelect: (asset: Asset) => void
  onAddToScene: (asset: Asset) => void
  onImportScene: (asset: Asset) => void
  /** ダブルクリック等の「開く」: モデル=プレビュー、シーン=ロード */
  onOpenAsset: (asset: Asset) => void
  onRequestDelete: (asset: Asset) => void
  onRequestUpload: () => void
  onRetryJob: (entry: JobEntry) => void
  onSyncJob: (entry: JobEntry) => void
  onDismissJob: (jobId: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [section, setSection] = useState<BrowserSection>('model')
  const [prefsState, setPrefsState] = useState<ViewPrefsState>(loadViewPrefs)

  const updatePrefs = (next: Partial<ViewPrefs>) => {
    setPrefsState((prev) => {
      if (prev.phase === 'error') return prev
      const merged = { ...prev.value, ...next }
      try {
        saveViewPrefs(merged)
        return { phase: 'ready', value: merged }
      } catch (error) {
        return toPrefsError(error)
      }
    })
  }

  const sectionCounts = useMemo(() => {
    const counts = new Map<BrowserSection, number>()
    for (const { value, kinds } of SECTIONS) {
      counts.set(value, assets.filter((a) => kinds.includes(a.kind)).length)
    }
    return counts
  }, [assets])

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const kinds = sectionKinds(section)
    return assets
      .filter((a) => {
        return (
          kinds.includes(a.kind) &&
          (a.name.toLowerCase().includes(term) || highlightIds.has(a.id))
        )
      })
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )
  }, [assets, filter, highlightIds, section])

  const activeJobCount = useMemo(
    () => jobs.filter((entry) => isActiveJob(entry.job)).length,
    [jobs],
  )

  // ジョブタイルは生成物がモデルのため、モデル区分でのみ表示する
  const visibleJobs = useMemo(() => {
    if (section !== 'model') return []
    const term = filter.trim().toLowerCase()
    return jobs
      .filter(
        (entry) =>
          isVisibleJob(entry.job) &&
          entry.label.toLowerCase().includes(term),
      )
      .sort((left, right) =>
        right.job.createdAt.localeCompare(left.job.createdAt) ||
        right.job.id.localeCompare(left.job.id),
      )
  }, [jobs, filter, section])

  if (prefsState.phase === 'error') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">アセット倉庫</h2>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div role="alert" className="max-w-xl rounded-md border border-destructive p-4 text-sm">
            <p className="font-medium text-destructive">表示設定を読み書きできません。</p>
            <p className="mt-1 break-all text-muted-foreground">{prefsState.message}</p>
          </div>
        </div>
      </div>
    )
  }

  const prefs = prefsState.value

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2">
        <h2 className="shrink-0 text-sm font-semibold">アセット倉庫</h2>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={section}
          onValueChange={(value) => {
            if (value) setSection(value as BrowserSection)
          }}
          aria-label="モデル / シーンの切替"
        >
          {SECTIONS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} className="gap-1 px-2 text-xs">
              {label}
              <span className="text-[10px] text-muted-foreground">
                {sectionCounts.get(value) ?? 0}
              </span>
              {value === 'model' && activeJobCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-4 min-w-4 justify-center px-1 text-[10px]"
                  aria-label={`生成中ジョブ ${activeJobCount} 件`}
                >
                  {activeJobCount}
                </Badge>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative w-48 min-w-24">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            aria-label="名前で絞り込み"
            placeholder="名前で絞り込み"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {prefs.mode === 'grid' && (
            <Slider
              className="w-24"
              min={THUMB_MIN}
              max={THUMB_MAX}
              step={16}
              value={[prefs.thumbSize]}
              onValueChange={([value]) => updatePrefs({ thumbSize: value })}
              aria-label="サムネイルサイズ"
            />
          )}
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={prefs.mode}
            onValueChange={(value) => {
              if (value) updatePrefs({ mode: value as ViewMode })
            }}
            aria-label="表示切替"
          >
            <ToggleGroupItem value="grid" aria-label="グリッド表示" title="グリッド表示">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="リスト表示" title="リスト表示">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={onRequestUpload}>
            <ImagePlus />
            画像から 3D 生成
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {visible.length === 0 && visibleJobs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Boxes className="size-8" />
            {filter.trim() !== '' ? (
              <p>絞り込みに一致する{section === 'model' ? 'モデル' : 'シーン'}がありません。</p>
            ) : section === 'model' ? (
              <p>
                モデルはまだありません。「画像から 3D 生成」またはこの画面への
                画像ドロップで最初の 3D を作りましょう。
              </p>
            ) : (
              <p>
                シーンはまだありません。モデルを配置して保存すると
                ここに並びます。
              </p>
            )}
          </div>
        ) : prefs.mode === 'grid' ? (
          <ul className="flex flex-wrap gap-2 p-3">
            {visibleJobs.map((entry) => (
              <JobTile
                key={entry.job.id}
                entry={entry}
                width={prefs.thumbSize}
                onRetry={onRetryJob}
                onSync={onSyncJob}
                onDismiss={onDismissJob}
              />
            ))}
            {visible.map((asset) => (
              <li key={asset.id} style={{ width: prefs.thumbSize }}>
                <div
                  draggable={isAssetDraggable(asset)}
                  onDragStart={(event) => startAssetDrag(event, asset)}
                  className={cn(
                    'group relative rounded-md border transition-colors',
                    selectedId === asset.id ? 'border-ring bg-accent' : 'hover:bg-accent/50',
                    highlightIds.has(asset.id) &&
                      'motion-safe:animate-pulse border-primary ring-2 ring-primary/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(asset)}
                    onDoubleClick={() => onOpenAsset(asset)}
                    title={assetInteractionTitle(asset)}
                    className="flex w-full flex-col gap-1.5 p-2 text-left"
                  >
                    <AssetThumb
                      asset={asset}
                      revision={assetRevisions.get(asset.id)}
                      className="aspect-square w-full"
                    />
                    <span className="min-w-0 truncate text-xs font-medium" title={asset.name}>
                      {asset.name}
                    </span>
                    <Badge variant="outline" className="w-fit text-[10px]">
                      {asset.kind}
                    </Badge>
                  </button>
                  <AssetActionButton
                    asset={asset}
                    onAddToScene={onAddToScene}
                    onImportScene={onImportScene}
                    onOpenAsset={onOpenAsset}
                    onRequestDelete={onRequestDelete}
                    className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1 p-3">
            {visibleJobs.map((entry) => (
              <JobRow
                key={entry.job.id}
                entry={entry}
                onRetry={onRetryJob}
                onSync={onSyncJob}
                onDismiss={onDismissJob}
              />
            ))}
            {visible.map((asset) => (
              <li key={asset.id}>
                <div
                  draggable={isAssetDraggable(asset)}
                  onDragStart={(event) => startAssetDrag(event, asset)}
                  className={cn(
                    'group flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
                    selectedId === asset.id
                      ? 'border-ring bg-accent'
                      : 'border-transparent hover:bg-accent/50',
                    highlightIds.has(asset.id) &&
                      'motion-safe:animate-pulse border-primary ring-2 ring-primary/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(asset)}
                    onDoubleClick={() => onOpenAsset(asset)}
                    title={assetInteractionTitle(asset)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <AssetThumb
                      asset={asset}
                      revision={assetRevisions.get(asset.id)}
                      className="size-9 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate" title={asset.name}>
                      {asset.name}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {new Date(asset.createdAt).toLocaleString()}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {asset.kind}
                    </Badge>
                  </button>
                  <AssetActionButton
                    asset={asset}
                    onAddToScene={onAddToScene}
                    onImportScene={onImportScene}
                    onOpenAsset={onOpenAsset}
                    onRequestDelete={onRequestDelete}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
