# ComfyUI integration

This directory contains the ComfyUI workflows and model metadata used by Splatorium. It does not contain ComfyUI itself or any model files.

| Path | Use | Sampling steps |
|---|---|---:|
| `workflows/image-to-splat.json` | Normal generation and `intel-xpu-highvram` | 20 |
| `workflows/image-to-splat-intel-xpu-fast.json` | `intel-xpu-fast` | 15 |
| `models.json` | Machine-readable download locations, destination paths, sizes, SHA-256 checksums, and license notes | — |
| `models.md` | Model setup instructions for users | — |

The two workflows differ only in their sampling-step setting. Splatorium sends the selected workflow to ComfyUI's `/prompt` endpoint after inserting the input image, seed, Gaussian count, and output name.

For a source checkout, follow [the ComfyUI setup guide](../docs/setup-comfyui.md). Portable users should follow the [English](../docs/user-guide.md) or [Japanese](../docs/user-guide.ja.md) user manual.
