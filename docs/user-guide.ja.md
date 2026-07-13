# Splatorium Portable ユーザーマニュアル

[English version](user-guide.md)

## Splatorium について

Splatorium は、1 枚の画像から 3D Gaussian Splat を生成し、ブラウザ上の倉庫で整理できるローカル 3D ワークベンチです。生成したモデルを確認するだけでなく、複数のモデルを 1 つのシーンへ配置し、構成を保存できます。

3D Gaussian Splat は、多数の小さな半透明の楕円体を重ね合わせて、物体の見た目を表す 3D 表現です。一般的なポリゴンメッシュとは異なる方法で、柔らかな輪郭や細かな表面を表現できます。

画像から 3D を生成する処理は、同じ Windows PC 上の ComfyUI が担当します。Splatorium は倉庫とシーン編集画面をブラウザへ表示します。ブラウザは操作画面として使われるだけで、作品データは Portable フォルダー内に保存されます。LAN から接続した端末は、ホスト PC からファイルを移動せずに同じ倉庫を閲覧・変更できます。

## 全体の仕組み

```text
ブラウザ → Splatorium → ComfyUI
                ↓            ↓
              倉庫        3D 生成
                ↓            ↓
              Portable の data フォルダー
```

画像を選ぶと、Splatorium は元画像を保存して ComfyUI に 3D 生成を依頼します。完成した `.spz` ファイルは Splatorium の倉庫へ戻ります。シーンの配置、名前、サムネイル、元画像、生成ファイルはすべて `data\` の下に保存されます。利用者は 1 つのブラウザ画面で操作し、ComfyUI は裏側で生成処理を行います。

## セットアップの前に

Portable ZIP には、Splatorium 本体、ブラウザ画面、起動スクリプト、生成ワークフロー、ライセンス表記が含まれています。容量が大きいものや、PC の構成によって異なる次の項目は含まれていません。

- Node.js ランタイム
- ComfyUI Windows Portable
- 生成に使用する 5 個のモデルファイル

これらは ZIP の展開後に一度だけ追加します。すべて Portable フォルダー内に収まるため、設定後はフォルダー全体をまとめてバックアップまたは移動できます。

### 動作環境

- 64 ビット版 Windows 10 または Windows 11
- WebGL 2 に対応する新しいブラウザ
- お使いの GPU に対応する ComfyUI Windows Portable
- ComfyUI、約 3.8 GB のモデル、生成物、バックアップを保存できる空き容量
- セットアップスクリプトでモデルを取得する場合はインターネット接続

生成には、VRAM 12 GB 前後の NVIDIA GPU を推奨します。お使いの GPU に対応する ComfyUI を選んでください。Intel XPU 用の任意プロファイルには、PyTorch XPU に対応する ComfyUI 環境と、16 GiB 以上のデバイスメモリを報告する Intel XPU が必要です。利用できる密度が分からない場合は、65,536 gaussians から始めてください。実際の速度と利用できる密度は、GPU、ドライバー、ComfyUI の種類、入力画像、同時に動いているアプリによって変わります。保存済みモデルの閲覧とシーン編集は、生成より少ない GPU メモリで利用できます。

## フォルダー構成

```text
SplatoriumPortable\
├── README.md                         日本語の短い案内
├── run.bat                           通常起動
├── run-profile.bat                   Intel XPU 用の任意起動
├── setup-models.bat                  必要なモデルを取得
├── import-models.bat                 手元のモデルを確認して取り込み
├── app\node\                         node.exe の配置先
├── comfy\ComfyUI_windows_portable\   ComfyUI の配置先
├── comfy\models.md                   必要なモデルの一覧
├── data\                             倉庫とシーンの保存先
├── docs\                             英語・日本語ユーザーマニュアル
└── models\incoming\                  手元のモデルファイルの配置先
```

ZIP を表示したまま中のファイルを直接実行しないでください。最初にアーカイブ全体を展開します。

## 初回セットアップ

### 1. ZIP を展開する

1. `C:\SplatoriumPortable\` など、短く書き込み可能なフォルダーを用意します。
2. ZIP の内容をすべて展開します。
3. 同じフォルダー内に `run.bat`、`app\`、`comfy\`、`data\` があることを確認します。

読み取り専用の場所は避けてください。倉庫のデータベースと生成ファイルは `data\` に保存されます。

### 2. Node.js を配置する

データベース機能は、Portable パッケージを構築したときの Node.js メジャーバージョンに対応しています。同じメジャーバージョンの Node.js を使用してください。

1. `app\node\README.txt` を開き、必要な Node.js のメジャーバージョンと Windows アーキテクチャを確認します。
2. [Node.js 公式ダウンロードページ](https://nodejs.org/en/download)から一致する Windows ZIP を取得します。
3. ZIP 内の `node.exe` を `app\node\node.exe` として配置します。

Splatorium はこのファイルを直接使用します。Windows 全体にインストール済みの Node.js では代用されません。

### 3. ComfyUI Windows Portable を配置する

1. [ComfyUI Windows Portable 公式ガイド](https://docs.comfy.org/ja/installation/comfyui_portable_windows)から、お使いの GPU に合う版を取得します。
2. ComfyUI のアーカイブを展開します。
3. 中にある `python_embeded\` と `ComfyUI\` を `comfy\ComfyUI_windows_portable\` の直下へコピーします。

配置後に、次の 2 ファイルが存在することを確認してください。

```text
comfy\ComfyUI_windows_portable\python_embeded\python.exe
comfy\ComfyUI_windows_portable\ComfyUI\main.py
```

### 4. モデルファイルを配置する

次のどちらか一方を選びます。

#### モデルをダウンロードする

1. `setup-models.bat` をダブルクリックします。
2. 各ファイルの取得元、保存先、サイズ、チェックサム、ライセンスを確認します。
3. `download` と入力して Enter キーを押します。
4. 5 ファイルすべてに `downloaded` または `skipped` と表示されるまで待ちます。

ダウンロードするデータは数 GB あります。通信が中断した場合は、同じスクリプトをもう一度実行してください。正しく保存済みのファイルはそのまま使われます。

#### 手元のモデルファイルを取り込む

1. [`comfy\models.md`](../comfy/models.md)を開き、記載されたフォルダー構成を `models\incoming\` の下に作ります。
2. 5 個のファイルをそれぞれ指定された場所へ置きます。
3. Portable フォルダーで PowerShell を開き、次のコマンドを実行します。

   ```powershell
   .\import-models.bat --check
   ```

4. すべてのファイルが受け付けられたら、次のコマンドで ComfyUI へ取り込みます。

   ```powershell
   .\import-models.bat
   ```

取り込みが完了すると、5 ファイルは `comfy\ComfyUI_windows_portable\ComfyUI\models\` の下へ配置されます。

## Splatorium を起動する

1. `run.bat` をダブルクリックします。
2. 最初のコマンドウィンドウと、別に開く **Splatorium ComfyUI** ウィンドウを両方とも開いたままにします。
3. ComfyUI の読み込みが終わるまで待ち、ブラウザで <http://localhost:8787> を開きます。起動スクリプトは URL を表示しますが、ブラウザは自動で開きません。

Splatorium の編集画面は横幅 900 ピクセル以上を前提としています。デスクトップ用ブラウザで利用してください。

## 最初の 3D を生成する

1. 画像 1 枚を Splatorium の画面へドロップするか、**画像から 3D 生成**を選びます。
2. Gaussian 数を選びます。最初は処理が軽い **65,536 gaussians** をお勧めします。数を増やすと細部が残りやすくなる一方、時間とメモリを多く使用します。
3. 毎回異なる結果にする場合は seed を空欄にします。同じサンプリング条件を使いたい場合は数値を入力します。
4. **3D 生成を開始**を選びます。
5. 生成中は 2 つのコマンドウィンドウを閉じないでください。

生成中の項目はモデル一覧に表示されます。処理が終わると完成モデルへ自動的に切り替わります。モデルを開いて確認し、インスペクターで名前を変更するか、シーンへ追加できます。

## シーンを構成して保存する

1. 倉庫のモデルを選んで **シーンへ追加**を選ぶか、モデルをシーンへドラッグします。
2. シーンツリーまたはビューポートで、操作するモデルを選びます。
3. **移動 (W)**、**回転 (E)**、**拡縮 (R)** を使って配置します。`Ctrl` を押したまま操作すると、グリッドまたは角度の単位に合わせて動かせます。
4. シーン名を入力して **保存**を選びます。既存のシーンを編集した場合は **上書き保存**を選びます。

主なショートカット:

| 操作 | キー |
|---|---|
| 元に戻す | `Ctrl+Z` |
| やり直す | `Ctrl+Shift+Z` または `Ctrl+Y` |
| 移動 / 回転 / 拡縮 | `W` / `E` / `R` |
| 選択中のモデルへ視点を合わせる | `F` |
| カメラを初期位置へ戻す | `Home` |

保存したシーンはモデルと同じ倉庫に表示されます。LAN から接続している端末にも、同じ倉庫とシーンの更新が表示されます。

## 毎日の起動と終了

初回セットアップ後は、`run.bat` を実行し、ComfyUI の読み込みを待ってから <http://localhost:8787> を開きます。

通常起動を終了する手順:

1. 実行中の生成や保存が終わっていることを確認します。
2. `run.bat` を実行したウィンドウで `Ctrl+C` を押すか、そのウィンドウを閉じます。
3. **Splatorium ComfyUI** ウィンドウでも `Ctrl+C` を押すか、ウィンドウを閉じます。

両方の処理を終了してください。ブラウザを閉じるだけでは停止しません。

## データ、バックアップ、持ち運び

倉庫のデータベース、アップロードした画像、生成モデル、サムネイル、保存したシーンは、すべて `data\` の下に保存されます。

バックアップ手順:

1. Splatorium と ComfyUI を終了します。
2. `data\` フォルダー全体を別のドライブへコピーします。
3. フォルダー構成を変更せずに保管します。

設定済みの Portable パッケージを別の PC やドライブへ移す場合は、両方の処理を終了してから `SplatoriumPortable\` フォルダー全体をコピーします。Node.js、ComfyUI、モデルファイルも一緒に移動できます。移動先では、Splatorium を起動する前に、その PC の GPU に ComfyUI が対応していることを確認してください。

現在のパッケージを置き換える前に、両方の処理を終了し、設定済みフォルダー全体をバックアップしてください。新しい ZIP は別のフォルダーへ展開します。既存のデータや実行環境を新しいフォルダーへコピーする場合は、先にそのリリースノートを確認してください。設定済みフォルダーへ新しい ZIP を上書きしないでください。

## 別の端末から利用する

ホスト PC と別の端末が同じ信頼できるネットワークにある場合:

1. ホスト PC で Splatorium を起動します。
2. Windows のネットワーク設定または `ipconfig` で、ホスト PC の IPv4 アドレスを確認します。
3. 別の端末のブラウザで `http://ホストPCのIPアドレス:8787` を開きます。
4. 接続できない場合は、Windows ファイアウォールで Node.js のプライベートネットワーク通信を許可し、ポート 8787 が遮断されていないことを確認します。

この版の Splatorium にはユーザーアカウント機能がありません。アドレスへ接続できる人は同じ倉庫を閲覧・変更できるため、LAN 公開は信頼できるネットワーク内だけで使用してください。

## Intel XPU 用の任意プロファイル

通常は `run.bat` を使用してください。次のプロファイルは、16 GiB 以上のデバイスメモリを報告する Intel XPU と、PyTorch XPU に対応した ComfyUI 環境だけで利用できます。

標準の 20 ステップ生成を ComfyUI の high-VRAM モードで実行する場合:

```powershell
.\run-profile.bat intel-xpu-highvram
```

速度を優先する 15 ステップ生成を使う場合:

```powershell
.\run-profile.bat intel-xpu-fast
```

fast プロファイルは、標準設定と見た目が異なる結果になることがあります。プロファイル起動は、デバイスと選択されたワークフローを確認してから処理を開始します。追加の ComfyUI 引数は指定できません。

プロファイル起動では、Splatorium と ComfyUI が同じコマンドウィンドウで動作します。終了するときは実行中の処理を終えてから、そのウィンドウで `Ctrl+C` を押してください。

## トラブルシューティング

### `Missing bundled Node runtime` と表示される

`app\node\node.exe` が正確に存在することを確認します。Node.js のインストーラーを名前変更したり、Portable フォルダー直下へ置いたりしないでください。

### `NODE_MODULE_VERSION` と表示される

Node.js のメジャーバージョンが、パッケージの構築時と異なります。`app\node\README.txt` を開き、記載されたメジャーバージョンを取得して `app\node\node.exe` を置き換えてください。

### `Missing ComfyUI portable Python` または `Missing ComfyUI entrypoint` と表示される

ComfyUI が不足しているか、フォルダーが 1 階層深くなっています。[ComfyUI Windows Portable を配置する](#3-comfyui-windows-portable-を配置する)に記載した 2 つのパスを確認してください。

### モデルのダウンロードまたは取り込みが拒否される

メッセージに表示されたパスを確認します。その場所にある不完全または誤ったファイルを取り除き、`setup-models.bat` または `import-models.bat` をもう一度実行してください。モデルのファイル名は変更せず、[`comfy\models.md`](../comfy/models.md)と同じフォルダーへ配置します。

### 生成時にモデル不足と表示される

いったん終了して `setup-models.bat` を実行するか、手元のモデルファイルをもう一度確認・取り込みします。5 ファイルがそろってから Splatorium を再起動してください。

### `http://localhost:8787` を開けない

コマンドウィンドウにエラーがないか確認します。別のアプリがポート 8787 を使用しているか、Splatorium のサーバーが終了している可能性があります。競合するアプリを終了し、`run.bat` をもう一度実行してください。

### ComfyUI がポート 8189 を使用できない

すでに起動している別の ComfyUI またはポート 8189 を使うアプリを終了し、Splatorium を再起動します。

### Intel XPU プロファイルが起動しない

コマンドウィンドウのデバイス情報を確認します。このプロファイルには、16 GiB 以上のメモリを報告する Intel XPU が必要です。条件を満たさない場合は通常の `run.bat` を使用してください。

### 生成に時間がかかる

生成時間は GPU と Gaussian 数に大きく左右されます。まず 65,536 gaussians を選び、GPU を多く使うほかのアプリを閉じてください。起動後の最初の生成は、ComfyUI がモデルを読み込むため長くなることがあります。

## ソースから Portable パッケージを構築する

この節は Splatorium のソースコードを取得した人向けです。リリース ZIP を利用するだけの場合は必要ありません。

必要なもの:

- Windows
- Node.js 22 以降
- `package.json` に記載された pnpm 10.33.1
- Git

リポジトリのルートで次のコマンドを実行します。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:portable-app
pnpm licenses:check
pnpm smoke:production
pnpm smoke:portable
pnpm smoke:portable-archive
pnpm exec playwright install chromium
pnpm test:e2e
```

構築結果は次の場所に作成されます。

```text
dist\portable\SplatoriumPortable\
dist\portable\SplatoriumPortable.zip
```

`pnpm build:portable-app` は 2 つの構築結果を作成し、ZIP の SHA-256 を表示します。3 つの確認コマンドは構築済みのアプリとアーカイブを確認します。最後のコマンドは、直前のコマンドで Chromium を配置した後にブラウザ操作を確認します。生成したパッケージを設定するときは、その `app\node\README.txt` に記載された Node.js メジャーバージョンを使用してください。

## ライセンスと問い合わせ

同梱ワークフローとモデルファイルを利用または再配布する前に、`NOTICE`、`third-party-licenses.md`、`licenses\` 内の文書を確認してください。DINOv3 由来のビジョンエンコーダには、`licenses\dinov3\LICENSE.md` に記載された用途・輸出管理上の追加条件があります。

このマニュアルで解決できない場合は、2 つのコマンドウィンドウに表示されたメッセージを省略せず、<https://github.com/Hitsuki-Ban/Splatorium/issues> へ報告してください。Windows のバージョン、GPU、ComfyUI の種類、行った操作、最初に表示されたエラーを添えると状況を確認しやすくなります。
