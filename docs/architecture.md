# Splatorium のシステム構成

この文書は、Splatorium のソースコードを読み、機能追加や不具合修正を行う人のための構成案内です。利用者向けのセットアップと操作方法は、[日本語ユーザーマニュアル](user-guide.ja.md)または[英語ユーザーマニュアル](user-guide.md)を参照してください。

## 全体像

Splatorium は、ブラウザ、Splatorium サーバー、ComfyUI の 3 つの要素で動作します。

```text
ブラウザ
  │  HTTP API / Server-Sent Events
  ▼
Splatorium サーバー ── HTTP / WebSocket ──▶ ComfyUI
  │                                          │
  ▼                                          ▼
アセット倉庫                              3D 生成
```

- **ブラウザ**は、画像の登録、生成状況の表示、アセットの整理、3D プレビュー、シーン編集を担当します。
- **Splatorium サーバー**は、ブラウザ画面と HTTP インターフェースを提供し、生成ジョブ、ComfyUI との通信、アセット倉庫を管理します。
- **ComfyUI**は、リポジトリに収録されたワークフローを実行し、画像から 3D Gaussian Splat を生成します。

ブラウザは Splatorium サーバーだけに接続します。ComfyUI のアドレスやモデルファイルは、ブラウザへ公開されません。

## ソースコードの構成

| パス | 内容 |
|---|---|
| `apps/web` | React、React Three Fiber、Three.js、Spark で構成されたブラウザ画面 |
| `apps/server` | Hono ベースの Node.js サーバー、生成キュー、ComfyUI クライアント、SQLite ストア |
| `packages/shared` | ブラウザとサーバーが共有する Job、Asset、Scene の型と検証処理 |
| `comfy/workflows` | ComfyUI に送信する API format のワークフロー |
| `comfy/models.json` | 必要なモデルの取得元、配置先、サイズ、SHA-256、ライセンス情報 |
| `comfy/models.md` | モデルを準備する人向けの説明 |
| `scripts` | Portable パッケージの構築、起動、モデル配置、動作確認に使うスクリプト |
| `data` | 実行時に作成されるアセット倉庫。Git では管理しない |

## 画像から 3D を生成する流れ

1. ブラウザが画像を `POST /api/jobs` へ送ります。
2. サーバーは元画像をアセット倉庫へ保存し、`queued` 状態の Job を作成します。
3. 直列キューが Job を取り出し、画像を ComfyUI へアップロードします。
4. サーバーは Job の seed、Gaussian 数、出力名をワークフローへ設定し、ComfyUI の `/prompt` へ送信します。
5. サーバーは ComfyUI の WebSocket と履歴 API から進行状況と完了結果を受け取ります。
6. 完成した `.spz` ファイルをダウンロードし、元画像とともに新しい splat Asset として保存します。
7. Job と Asset の更新は Server-Sent Events でブラウザへ通知されます。

1 つの Splatorium サーバープロセスでは、生成 Job を 1 件ずつ実行します。モデルの閲覧、シーン編集、アセット操作は生成中も同じサーバーを通して利用できます。

## アセット倉庫

既定の保存先は、リポジトリ直下の `data/` です。`SPLATORIUM_DATA_DIR` を設定すると別の場所を使用できます。Portable パッケージでは、パッケージ直下の `data/` が指定されます。

```text
data/
├── workbench.sqlite
└── assets/
    └── <asset-id>/
        ├── 生成ファイルまたはシーン JSON
        ├── 元画像（該当する場合）
        └── サムネイル（該当する場合）
```

`workbench.sqlite` には Job と Asset のメタデータが入り、各 Asset の実ファイルは `data/assets/<asset-id>/` に保存されます。バックアップするときは Splatorium を終了し、`data/` 全体を一緒にコピーしてください。

Asset の現在の種類は次のとおりです。

| `kind` | 用途 |
|---|---|
| `image` | 生成に使用した入力画像 |
| `splat` | 生成された Gaussian Splat |
| `mesh` | シーンから参照できるポリゴンモデル用の型。現在の HTTP インターフェースには mesh の登録機能はない |
| `scene` | 保存されたシーン文書 |

## シーン文書

シーンは `kind: "scene"` の Asset として保存され、本体は `scene.json` です。現在の書き込み形式は `schemaVersion: 2` で、次の 2 種類のノードからなるツリーを保持します。

- `model`: `splat` または `mesh` Asset を `assetId` で参照するノード
- `group`: 複数の子ノードをまとめるノード。保存済みシーンを取り込んだ場合は、その出典情報も保持できる

各ノードは表示名、表示状態、位置、回転、拡縮を持ちます。形式と制限の詳細は [Splatorium サーバー HTTP インターフェース](api.md#scenes) に記載しています。

## ブラウザへの更新通知

ブラウザは起動時に Job と Asset の一覧を取得し、続いて `GET /api/events` へ接続します。この接続では Job の更新、Asset の追加・更新・削除が順番に通知されます。

イベント接続は変更履歴を保存する仕組みではありません。接続し直したブラウザは Job と Asset の一覧を再取得し、現在の倉庫の状態に合わせます。イベント形式は [API 文書](api.md#更新イベント) を参照してください。

## ネットワーク

Splatorium サーバーの既定値は `0.0.0.0:8787`、ComfyUI の既定接続先は `127.0.0.1:8189` です。ソース開発時の Vite サーバーは `0.0.0.0:6173` で起動し、`/api` を Splatorium サーバーへ転送します。

Splatorium にはユーザー認証がありません。LAN へ公開すると、接続できる利用者は同じ倉庫を閲覧・変更できます。インターネットへ直接公開せず、信頼できるネットワーク内で使用してください。

## Portable パッケージに含まれるもの

Portable ZIP には、構築済みの Splatorium サーバーとブラウザ画面、実行に必要な Node.js パッケージ、ComfyUI ワークフロー、モデル manifest、起動・モデル配置スクリプト、ユーザーマニュアル、ライセンス表記が含まれます。

次の項目は含まれません。

- Node.js ランタイム
- ComfyUI Windows Portable
- 生成に必要なモデルファイル

これらは利用者が ZIP の展開後に指定の場所へ追加します。配置場所と手順は[日本語ユーザーマニュアル](user-guide.ja.md#初回セットアップ)に記載しています。

## 関連文書

- [Splatorium サーバー HTTP インターフェース](api.md)
- [ソース開発用 ComfyUI セットアップ](setup-comfyui.md)
- [モデルファイルの準備](../comfy/models.md)
- [日本語ユーザーマニュアル](user-guide.ja.md)
- [English user manual](user-guide.md)
