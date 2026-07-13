# Splatorium Portable

**1 枚の絵から、立体標本。**

Splatorium は、画像から 3D Gaussian Splat を生成し、ブラウザ上の倉庫とシーンで整理・配置できるローカル 3D ワークベンチです。このフォルダーを別の場所へ移しても、アプリ、設定した実行環境、モデル、作品データをまとめて持ち運べます。別の PC へ移す場合は、配置済みの ComfyUI が移動先の GPU に対応していることを確認してください。

> この ZIP には Node.js、ComfyUI、モデルファイル本体は含まれていません。初回のみ、以下の手順で配置してください。

## 初回セットアップ

1. ZIP を、書き込み可能な短いパスへ展開します。例: `C:\SplatoriumPortable\`
2. `app\node\README.txt` を開き、記載されたメジャーバージョンの Windows 用 Node.js から `node.exe` を `app\node\` に置きます。
3. お使いの GPU に合う ComfyUI Windows Portable を展開します。`python_embeded\` と `ComfyUI\` を `comfy\ComfyUI_windows_portable\` の直下へ置きます。
4. インターネットからモデルを取得する場合は `setup-models.bat` を実行し、表示内容を確認して `download` と入力します。手元のモデルを使う場合は、[日本語ユーザーマニュアル](docs/user-guide.ja.md#手元のモデルファイルを取り込む)を参照してください。
5. `run.bat` をダブルクリックします。表示された 2 つのウィンドウを開いたまま、ブラウザで `http://localhost:8787` を開きます。

## 最初の 3D を作る

1. ブラウザへ画像をドロップするか、**画像から 3D 生成**を選びます。
2. 必要なら Gaussian 数と seed を変更し、**3D 生成を開始**を選びます。
3. 完了したモデルは倉庫へ自動的に追加されます。モデルを開いて確認するか、**シーンへ追加**して配置できます。

作品とシーンは `data\` に保存されます。バックアップや移動の前には Splatorium と ComfyUI を終了し、`data\` フォルダーをコピーしてください。

## 詳しい説明

- [ユーザーマニュアル（日本語）](docs/user-guide.ja.md)
- [User Guide (English)](docs/user-guide.md)
- [必要なモデルファイル](comfy/models.md)

## 終了する

`run.bat` を実行したウィンドウと **Splatorium ComfyUI** ウィンドウの両方で `Ctrl+C` を押すか、両方のウィンドウを閉じます。

## ライセンス

第三者ソフトウェアとモデルに関する条件は、`NOTICE`、`third-party-licenses.md`、`licenses\` を確認してください。
