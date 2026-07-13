# Splatorium に必要なモデルファイル

Splatorium の 3D 生成には、次の 5 ファイルが必要です。モデルファイルはサイズが大きく、それぞれに利用条件があるため、Portable ZIP には含まれていません。

## 自動でダウンロードする

Portable フォルダー直下の `setup-models.bat` を実行してください。取得元、保存先、ファイルサイズ、SHA-256、ライセンス情報が表示されます。内容を確認して `download` と入力すると、ファイルが ComfyUI の正しいフォルダーへ保存されます。

途中で終了した場合は、同じスクリプトをもう一度実行してください。正しく保存済みのファイルは再利用されます。

## 手元のファイルを取り込む

すでにモデルファイルを持っている場合は、Portable フォルダーの `models\incoming\` に次の構成で置きます。

```text
models\incoming\
├── background_removal\birefnet.safetensors
├── clip_vision\dino_v3_vit_h.safetensors
├── diffusion_models\triposplat_fp16.safetensors
└── vae\
    ├── flux2-vae.safetensors
    └── triposplat_vae_decoder_fp16.safetensors
```

配置を確認するには `import-models.bat --check`、ComfyUI へコピーするには `import-models.bat` を実行してください。ファイルサイズと SHA-256 が一致したファイルだけが取り込まれます。

## ファイル一覧

| 用途 | 配置先（ComfyUI フォルダーからの相対パス） | サイズ (bytes) | SHA-256 |
|---|---|---:|---|
| TripoSplat diffusion model | `models/diffusion_models/triposplat_fp16.safetensors` | 741,106,994 | `c870b97ac1d6bc9177608a5ec625e19ef9f3c5019aa68f64b0fb7803abcd6d20` |
| TripoSplat VAE decoder | `models/vae/triposplat_vae_decoder_fp16.safetensors` | 576,148,442 | `ed0d0c3d43b599e326845d0ec70f3cf77be9a55e2d97627ac3b34d2830763cc8` |
| FLUX.2 VAE | `models/vae/flux2-vae.safetensors` | 336,213,556 | `d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5` |
| DINOv3 vision encoder | `models/clip_vision/dino_v3_vit_h.safetensors` | 1,681,247,696 | `a29ef35101a16966972a0d50732a6f3a608ff7cfffb2afa9bbe9007cb842cc53` |
| BiRefNet background removal | `models/background_removal/birefnet.safetensors` | 444,473,596 | `9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154` |

## 取得元とライセンス

- セットアップスクリプトが使用する配布元: <https://huggingface.co/VAST-AI/TripoSplat>
- BiRefNet の配布ページ: <https://huggingface.co/Comfy-Org/BiRefNet>
- DINOv3 の利用条件: [`../licenses/dinov3/LICENSE.md`](../licenses/dinov3/LICENSE.md)
- すべての第三者表記: [`../third-party-licenses.md`](../third-party-licenses.md)

モデルを取得または利用する前に、それぞれの配布元とライセンス条件を確認してください。特に DINOv3 由来のファイルには、用途や輸出管理に関する条件があります。
