import { Badge } from '@/components/ui/badge'
import type { ImportedSceneUpdate } from '@/lib/scene-update'

export function ImportedSceneStatusBadges({
  update,
  checking,
  detailed = false,
}: {
  update: ImportedSceneUpdate | undefined
  checking: boolean
  /** true は詳細な 2 バッジ表示、false はツリー行向けの 1 バッジ表示。 */
  detailed?: boolean
}) {
  if (checking) return <Badge variant="secondary" className="shrink-0 px-1 text-[10px]">確認中</Badge>
  if (!update || update.status === 'current') return null
  if (update.status === 'updateAvailableAndModified') {
    if (detailed) {
      return (
        <>
          <Badge className="shrink-0 px-1 text-[10px]">更新あり</Badge>
          <Badge variant="outline" className="shrink-0 px-1 text-[10px]">ローカル変更</Badge>
        </>
      )
    }
    return (
      <Badge
        className="shrink-0 px-1 text-[10px]"
        title="元シーンに更新があり、取込後のローカル変更もあります"
      >
        更新+編集
      </Badge>
    )
  }
  if (update.status === 'locallyModified') {
    return <Badge variant="outline" className="shrink-0 px-1 text-[10px]">ローカル変更</Badge>
  }
  if (update.status === 'updateAvailable') return <Badge className="shrink-0 px-1 text-[10px]">更新あり</Badge>
  if (update.status === 'sourceMissing') {
    return <Badge variant="destructive" className="shrink-0 px-1 text-[10px]">リンク切れ</Badge>
  }
  return <Badge variant="destructive" className="shrink-0 px-1 text-[10px]">確認失敗</Badge>
}

export function importedSceneStatusText(
  update: ImportedSceneUpdate | undefined,
  checking: boolean,
): string {
  if (checking) return '確認中'
  if (!update) return '未確認'
  switch (update.status) {
    case 'current':
      return '最新'
    case 'locallyModified':
      return 'ローカル変更あり'
    case 'updateAvailable':
      return '更新あり'
    case 'updateAvailableAndModified':
      return '更新あり・ローカル変更あり'
    case 'sourceMissing':
      return 'リンク切れ'
    case 'checkFailed':
      return '確認失敗'
  }
}
