# Splatorium サーバー HTTP インターフェース

この文書は、Splatorium に同梱される Web クライアントとサーバーの間で使用する HTTP インターフェースを説明します。独立した第三者向け API としてバージョン固定されているものではありません。クライアントとサーバーは同じ Splatorium リリースの組み合わせで使用してください。

既定のサーバーアドレスは `http://localhost:8787` です。JSON を返すエンドポイントでは、入力エラーや対象が見つからない場合に、通常は次の形式が返ります。

```json
{ "error": "message" }
```

## Health

### `GET /api/health`

サーバーが HTTP リクエストを処理できることを確認します。

Response: `200` + `HealthResponse`

```json
{
  "status": "ok",
  "service": "splatorium-server",
  "time": "2026-01-01T00:00:00.000Z"
}
```

この応答は ComfyUI の接続状態やモデルファイルの有無までは確認しません。

## 共通データ

実際の TypeScript 定義は [`packages/shared/src/index.ts`](../packages/shared/src/index.ts) にあります。

### `Job`

```ts
interface Job {
  id: string
  pipeline: 'image-to-splat'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  progress: number
  params?: { numGaussians: number; seed: number }
  statusText?: string
  inputAssetIds: string[]
  outputAssetIds: string[]
  error?: string
  metrics?: {
    durationMs?: number
    outputBytes?: number
    comfyPromptId?: string
  }
  createdAt: string
  startedAt?: string
  finishedAt?: string
}
```

`progress` は 0 から 100 までの進行率です。日時は ISO 8601 形式の文字列です。

### `Asset`

```ts
interface Asset {
  id: string
  kind: 'image' | 'splat' | 'mesh' | 'scene'
  name: string
  tags: string[]
  sourceJobId?: string
  files: {
    main: AssetFileRef
    thumbnail?: AssetFileRef
    source?: AssetFileRef
  }
  createdAt: string
}

interface AssetFileRef {
  path: string
  size: number
  mime?: string
}
```

`files.*.path` は、その Asset の保存ディレクトリを基準にした相対パスです。ブラウザからファイルを取得するときは、保存パスではなく、後述する `GET /api/assets/:id/files/:role` を使用します。

## Jobs

### `POST /api/jobs`

画像から `image-to-splat` Job を作成します。作成された Job はサーバーの直列キューへ追加されます。

Request: `multipart/form-data`

| field | required | value |
|---|---:|---|
| `image` | yes | 入力画像ファイル。ファイル名は 1～255 文字 |
| `numGaussians` | no | JavaScript の安全な整数範囲に収まる正の整数。既定値は `65536` |
| `seed` | no | JavaScript の安全な整数範囲に収まる正の整数。省略時はサーバーが生成 |

Response: `202` + 作成された `Job`

```json
{
  "id": "job-id",
  "pipeline": "image-to-splat",
  "status": "queued",
  "progress": 0,
  "statusText": "Queued",
  "params": { "numGaussians": 65536, "seed": 123 },
  "inputAssetIds": ["image-asset-id"],
  "outputAssetIds": [],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

画像ファイルは `kind: "image"` の Asset として保存されます。生成が完了すると、`.spz` ファイルを持つ `kind: "splat"` の Asset ID が `outputAssetIds` に追加されます。生成処理のエラーは Job の `status: "failed"` と `error` に記録されます。

### `GET /api/jobs/:id`

指定した Job を取得します。

- Response: `200` + `Job`
- Job が存在しない場合: `404`

### `GET /api/jobs`

Job の一覧を `createdAt DESC, id DESC` の順で返します。

| query | required | value |
|---|---:|---|
| `status` | no | 複数指定可。`queued` / `running` / `succeeded` / `failed` / `canceled` |
| `limit` | no | 1～100 の整数。既定値は `50` |

例:

```text
GET /api/jobs?status=queued&status=running&limit=100
```

未知の query parameter、不正または空の `status`、複数の `limit`、範囲外または整数でない `limit` には `400` を返します。

Response: `200` + `Job[]`。応答には `Cache-Control: no-store` が付きます。

## 更新イベント

### `GET /api/events`

Workbench 全体の更新を送る Server-Sent Events 接続です。各メッセージの `data` には、次のいずれかの JSON が入ります。

```ts
type WorkbenchEvent =
  | { type: 'sync'; serverId: string; seq: number }
  | {
      type: 'job.upserted'
      serverId: string
      seq: number
      occurredAt: string
      job: Job
    }
  | {
      type: 'asset.upserted'
      serverId: string
      seq: number
      occurredAt: string
      asset: Asset
    }
  | {
      type: 'asset.deleted'
      serverId: string
      seq: number
      occurredAt: string
      assetId: string
    }
```

接続直後の最初のメッセージは `sync` です。SSE の `id` は `<serverId>:<seq>`、再接続間隔は 2,000 ms で、接続維持用のコメントが 15 秒ごとに送られます。応答には `Cache-Control: no-cache` が付きます。

過去のイベントは再送されません。再接続したクライアントは `GET /api/jobs` と `GET /api/assets` をもう一度取得し、その時点の状態に合わせてください。Job ごとのイベント URL はありません。

## Assets

### `GET /api/assets`

すべての Asset を `createdAt ASC, id ASC` の順で返します。

Response: `200` + `Asset[]`。応答には `Cache-Control: no-store` が付きます。

### `GET /api/assets/:id`

指定した Asset を取得します。

- Response: `200` + `Asset`
- Asset が存在しない場合: `404`

### `GET /api/assets/:id/references`

指定した Asset を参照している保存済みシーンを返します。model ノードの `assetId` と、取り込まれた scene group の `importedFrom.sceneId` が対象です。同じシーン内の参照は 1 要素にまとめ、参照ノード数を `nodeCount` に入れます。

Response: `200` + `AssetSceneReference[]`

```ts
interface AssetSceneReference {
  sceneId: string
  sceneName: string
  nodeCount: number
}
```

- 対象の Asset が存在しない場合: `404`
- 保存済みシーンの本体を読み取れない場合: リクエストは成功しません

正常な応答には `Cache-Control: no-store` が付きます。

### `PATCH /api/assets/:id`

Asset の表示名を変更します。`kind` による制限はありません。実ファイル名と `files.*.path` は変わりません。

Request: `application/json`

```json
{ "name": "Mana Potion" }
```

`name` は前後の空白を除いて保存され、1～255 文字でなければなりません。body に `name` 以外の field は指定できません。

- Response: `200` + 更新後の `Asset`
- Asset が存在しない場合: `404`
- body、`name`、文字数、field が不正な場合: `400`

### `POST /api/assets/:id/thumbnail`

`kind: "splat"` または `kind: "scene"` の Asset にサムネイルを保存します。

Request: `multipart/form-data`

| field | required | value |
|---|---:|---|
| `thumbnail` | yes | `image/webp` または `image/png`。最大 1,048,576 bytes |

保存ファイル名は MIME type に応じて `thumbnail.webp` または `thumbnail.png` になります。別の MIME type で更新すると、以前のサムネイルは置き換えられます。

- Response: `200` + 更新後の `Asset`
- Asset が存在しない場合: `404`
- Asset の種類、field、MIME type、サイズが不正な場合: `400`

### `GET /api/assets/:id/files/:role`

Asset が参照する実ファイルを返します。`role` は `main`、`thumbnail`、`source` のいずれかです。

Response: `200` + ファイル本体。`Content-Type` と `Content-Length` が付きます。

Asset、role、または該当するファイルが存在しない場合は `404` を返します。

### `DELETE /api/assets/:id`

Asset のメタデータと、その Asset ディレクトリ内のファイルを削除します。別のシーンから参照されている Asset も削除できます。Job 履歴に保存された input/output Asset ID は変更されません。

- Response: `204`（body なし）
- Asset が存在しない場合: `404`

参照元を確認してから削除する場合は、先に `GET /api/assets/:id/references` を呼び出してください。

## Scenes

シーンは `kind: "scene"` の Asset です。本体は `scene.json` として保存され、`GET /api/assets/:id/files/main` で取得できます。

### SceneDocument version 2

書き込みエンドポイントが受け付ける形式は `schemaVersion: 2` です。

```json
{
  "schemaVersion": 2,
  "nodes": [
    {
      "id": "2a1f6b39-56d4-4a03-bf3e-8c3d8558cb3c",
      "kind": "group",
      "name": "Display",
      "visible": true,
      "transform": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      },
      "children": [
        {
          "id": "929aa6d6-edf5-4c48-b3fd-ce75f8c2a0af",
          "kind": "model",
          "name": "Model A",
          "visible": true,
          "transform": {
            "position": [0, 0, 0],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1]
          },
          "assetId": "asset-splat-id"
        }
      ]
    }
  ]
}
```

ノードは次の 2 種類です。

- `model`: `kind: "splat"` または `kind: "mesh"` の Asset を `assetId` で参照します。
- `group`: `children` に子ノードを持ちます。保存済みシーンを取り込んだ group は、任意で `importedFrom` を持てます。

```ts
interface ImportedSceneOrigin {
  sceneId: string
  sourceHash: string
  contentHash: string
}
```

`transform.rotation` はラジアン単位のオイラー角で、順序は Three.js の既定値である XYZ です。

文書の制限:

- 文書全体で最大 10,000 ノード
- root node を深さ 0 として最大深さ 32
- 1 つの group に直接入れられる子は最大 2,000 ノード
- `id` は文書内で一意の UUID
- `name` は前後の空白を除いて 1 文字以上、255 UTF-16 code units 以下
- `position`、`rotation`、`scale` は有限 number 3 個の配列
- `sourceHash` と `contentHash` は lowercase hexadecimal の SHA-256
- 文書と各ノードに未知の field は指定できない

### `POST /api/scenes`

新しいシーンを作成します。

Request: `application/json`

```json
{
  "name": "Scene A",
  "document": {
    "schemaVersion": 2,
    "nodes": []
  }
}
```

`name` は必須で、前後の空白を除いて 1～255 文字です。すべての model node は、倉庫に存在する `splat` または `mesh` Asset を参照する必要があります。

Response: `201` + 作成された `Asset`

```json
{
  "id": "scene-asset-id",
  "kind": "scene",
  "name": "Scene A",
  "tags": [],
  "files": {
    "main": {
      "path": "scene.json",
      "size": 40,
      "mime": "application/json"
    }
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### `PUT /api/scenes/:id`

既存のシーンを更新します。`name` を省略すると現在の表示名を維持します。`createdAt` と既存のサムネイルも維持されます。

Request: `application/json`

```json
{
  "name": "Scene B",
  "document": {
    "schemaVersion": 2,
    "nodes": []
  }
}
```

通常、model node は倉庫に存在する `splat` または `mesh` Asset を参照する必要があります。更新前のシーンにすでに含まれていた欠損参照は、同じ Asset ID の参照数を増やさない範囲で保持できます。欠損参照の新規追加や増加、model として使用できない種類の Asset への参照は `400` になります。

- Response: `200` + 更新後の `Asset`
- 対象が存在しない、または `kind: "scene"` でない場合: `404`
- name、document、Asset 参照が不正な場合: `400`

## サーバー設定

環境変数を指定しない場合は、ソースツリーを基準にした次の値を使用します。Portable の起動スクリプトは、展開先に合わせてすべてのパスを明示します。

| env | default | purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Splatorium サーバーの listen address |
| `PORT` | `8787` | Splatorium サーバーの port |
| `COMFYUI_URL` | `http://127.0.0.1:8189` | ComfyUI の base URL |
| `SPLATORIUM_DATA_DIR` | リポジトリ直下の `data/` | SQLite と Asset ファイルの保存先 |
| `SPLATORIUM_WEB_DIR` | `apps/web/dist/` | 構築済みブラウザ画面の保存先 |
| `IMAGE_TO_SPLAT_WORKFLOW_PATH` | `comfy/workflows/image-to-splat.json` | image-to-splat workflow |
| `SPLATORIUM_MODEL_MANIFEST` | 未設定 | モデル manifest。指定する場合は `COMFYUI_ROOT` も必要 |
| `COMFYUI_ROOT` | 未設定 | ComfyUI root。指定する場合は `SPLATORIUM_MODEL_MANIFEST` も必要 |

`SPLATORIUM_MODEL_MANIFEST` と `COMFYUI_ROOT` を指定すると、生成 Job の開始前に manifest に記載されたモデルファイルが存在するか確認します。ソース開発環境の設定例は [ComfyUI セットアップ](setup-comfyui.md)を参照してください。
