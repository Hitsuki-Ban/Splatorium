# ソース開発用 ComfyUI セットアップ

この文書では、Splatorium のソースコードを動かし、画像から 3D Gaussian Splat を生成できる開発環境を Windows 上に用意します。リリース版の Portable ZIP を利用する場合は、[日本語ユーザーマニュアル](user-guide.ja.md#初回セットアップ)を参照してください。

Splatorium のリポジトリには ComfyUI 本体とモデルファイルを収録していません。以下の例では、どちらも Git で管理されない `comfy/runtime/ComfyUI/` の下へ配置します。別の場所に置く場合は、後述の環境変数を実際のパスに合わせてください。

## 必要なもの

- Windows 10 または Windows 11（64 ビット）
- Git
- Node.js 22 以降
- `package.json` の `packageManager` に記載された pnpm
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- ComfyUI が対応する GPU とドライバー
- ComfyUI と約 3.8 GB のモデルファイルを保存できる空き容量

この手順では、ComfyUI の仮想環境を Python 3.12 で作成します。`uv venv` は、利用可能な Python 3.12 を選択し、見つからない場合は管理対象の Python を取得します。

PyTorch の導入方法は GPU によって異なります。使用する GPU に合う手順を、[ComfyUI の手動インストールガイド](https://docs.comfy.org/installation/manual_install)と[PyTorch のインストール案内](https://pytorch.org/get-started/locally/)で確認してください。

## 1. Splatorium の依存関係をインストールする

PowerShell で Splatorium リポジトリのルートを開き、lockfile に記録された依存関係をインストールします。

```powershell
pnpm install --frozen-lockfile
```

## 2. ComfyUI を配置する

リポジトリのルートで次のコマンドを実行します。

```powershell
New-Item -ItemType Directory -Force comfy/runtime | Out-Null
git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git comfy/runtime/ComfyUI
Set-Location comfy/runtime/ComfyUI
uv venv .venv --python 3.12
```

GPU に対応する PyTorch を `.venv` へインストールします。次は NVIDIA GPU と CUDA 13.0 用 wheel を使用する例です。別の GPU を使用する場合は、公式案内に記載された index URL とパッケージに置き換えてください。

```powershell
uv pip install --python .venv/Scripts/python.exe `
  torch torchvision torchaudio `
  --index-url https://download.pytorch.org/whl/cu130
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

Python と PyTorch を読み込めることを確認します。

```powershell
& .\.venv\Scripts\python.exe -c "import torch; print(torch.__version__)"
```

NVIDIA GPU では、次のコマンドで CUDA が認識されていることも確認できます。

```powershell
& .\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

コマンドが終わったらリポジトリのルートへ戻ります。

```powershell
Set-Location ../../..
```

## 3. モデルファイルを配置する

必要なモデル、取得元、配置先、ファイルサイズ、SHA-256、ライセンスは [`comfy/models.md`](../comfy/models.md) にまとめています。内容と利用条件を確認してから、次のコマンドを実行してください。

```powershell
node scripts/init-models.mjs `
  --manifest comfy/models.json `
  --comfy-root comfy/runtime/ComfyUI
```

ダウンロード計画が表示されます。内容に同意する場合は `download` と入力します。各ファイルはダウンロード後にサイズと SHA-256 が確認され、ComfyUI の `models/` 以下へ配置されます。

すでにモデルファイルを持っている場合は、同じ文書のフォルダー構成に従って任意の作業用フォルダーへ置き、次のコマンドで確認してから取り込めます。

```powershell
node scripts/import-models.mjs `
  --manifest comfy/models.json `
  --incoming-dir C:\path\to\incoming `
  --comfy-root comfy/runtime/ComfyUI `
  --check

node scripts/import-models.mjs `
  --manifest comfy/models.json `
  --incoming-dir C:\path\to\incoming `
  --comfy-root comfy/runtime/ComfyUI
```

`C:\path\to\incoming` は実際の保存先へ置き換えてください。

## 4. ComfyUI を起動する

新しい PowerShell を開き、ComfyUI のディレクトリから起動します。

```powershell
Set-Location C:\path\to\Splatorium\comfy\runtime\ComfyUI
& .\.venv\Scripts\python.exe .\main.py `
  --listen 127.0.0.1 `
  --port 8189 `
  --disable-auto-launch
```

`C:\path\to\Splatorium` はリポジトリの実際の場所へ置き換えてください。この PowerShell は Splatorium の利用中も開いたままにします。

別の PowerShell から ComfyUI の応答を確認できます。

```powershell
Invoke-RestMethod http://127.0.0.1:8189/object_info | Out-Null
Write-Host "ComfyUI is responding"
```

Splatorium が使用する workflow は `comfy/workflows/image-to-splat.json` です。これは ComfyUI の API format で保存されており、生成ごとに入力画像、seed、Gaussian 数、出力名が設定されます。

## 5. Splatorium を起動する

ComfyUI を動かしたまま、もう 1 つの PowerShell で Splatorium リポジトリのルートを開きます。次の環境変数は、モデルの配置先を生成開始前に確認するためのものです。

```powershell
$env:COMFYUI_URL = "http://127.0.0.1:8189"
$env:SPLATORIUM_MODEL_MANIFEST = (Resolve-Path ".\comfy\models.json")
$env:COMFYUI_ROOT = (Resolve-Path ".\comfy\runtime\ComfyUI")
pnpm dev
```

ソース実行用のブラウザ画面は <http://localhost:6173>、Splatorium サーバーは <http://localhost:8787> で起動します。Vite は `/api` リクエストを Splatorium サーバーへ転送します。

サーバーの応答は次のコマンドで確認できます。

```powershell
Invoke-RestMethod http://localhost:8787/api/health
```

ブラウザで <http://localhost:6173> を開き、画像を 1 枚選んで生成を実行すると、Web クライアント、Splatorium サーバー、ComfyUI、アセット保存までの一連の動作を確認できます。生成物と Job 履歴は、既定ではリポジトリ直下の `data/` に保存されます。

## 保存先やポートを変更する

サーバーを起動する前に、必要な環境変数を PowerShell で設定します。

```powershell
$env:COMFYUI_URL = "http://127.0.0.1:8189"
$env:SPLATORIUM_DATA_DIR = "D:\SplatoriumData"
$env:PORT = "8787"
pnpm dev
```

利用できる環境変数と既定値は、[サーバー設定](api.md#サーバー設定)を参照してください。`SPLATORIUM_MODEL_MANIFEST` と `COMFYUI_ROOT` は、指定する場合は必ず両方を設定します。

## コード変更を確認する

リポジトリのルートで、テスト、型検査、本番用ビルドを実行します。

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:production
```

Portable パッケージも確認する場合は、[日本語ユーザーマニュアルの構築手順](user-guide.ja.md#ソースから-portable-パッケージを構築する)を参照してください。

## よくある問題

### ComfyUI が GPU を認識しない

PyTorch の wheel が GPU とドライバーに合っているか確認してください。ComfyUI を停止し、公式の PyTorch インストール案内に従って `.venv` の PyTorch を入れ直します。

### モデル不足が Job に表示される

[`comfy/models.md`](../comfy/models.md) の配置先と現在の ComfyUI root を確認し、モデルのダウンロードまたは取り込みコマンドをもう一度実行してください。Splatorium の `COMFYUI_ROOT` が、ComfyUI の `main.py` があるディレクトリを指していることも確認します。

### ComfyUI への接続に失敗する

ComfyUI の PowerShell に起動エラーがないか確認し、`Invoke-RestMethod http://127.0.0.1:8189/object_info` が成功することを確かめます。別のポートを使う場合は、ComfyUI の `--port` と Splatorium の `COMFYUI_URL` を同じ値に変更してください。

### ブラウザ画面は開くが生成に失敗する

Splatorium を起動した PowerShell と ComfyUI の PowerShell の両方で、最初に表示されたエラーを確認してください。モデル配置が正しい場合は、使用中の ComfyUI が [TripoSplat workflow](https://docs.comfy.org/tutorials/3d/triposplat) に必要なノードを提供していることを確認します。

## 参考資料

- [ComfyUI manual installation](https://docs.comfy.org/installation/manual_install)
- [ComfyUI server overview](https://docs.comfy.org/development/comfyui-server/comms_overview)
- [ComfyUI workflow JSON](https://docs.comfy.org/development/core-concepts/workflow)
- [ComfyUI TripoSplat tutorial](https://docs.comfy.org/tutorials/3d/triposplat)
- [ComfyUI repository](https://github.com/Comfy-Org/ComfyUI)
- [VAST-AI/TripoSplat model files](https://huggingface.co/VAST-AI/TripoSplat)
