# Splatorium Portable User Guide

日本語版は [こちら](user-guide.ja.md) です。

## About Splatorium

Splatorium turns one image into a 3D Gaussian Splat and keeps the result in a browser-based collection. You can preview generated models, arrange several models in a scene, and save the composition for later.

A 3D Gaussian Splat represents an object's appearance with many small, translucent 3D ellipsoids that blend together when rendered. It can preserve soft edges and fine surface detail without describing the object as a conventional polygon mesh.

Splatorium runs on your Windows computer. ComfyUI performs the image-to-3D generation in the background, while Splatorium provides the library and scene workspace in your browser. The browser is only the interface, and your files remain in the Portable folder. LAN access lets other devices view and change the same collection without moving the files away from the host computer.

## How the parts work together

```text
Browser → Splatorium → ComfyUI
              ↓           ↓
          Library     3D generation
              ↓           ↓
              Portable data folder
```

When you choose an image, Splatorium stores the source image and asks ComfyUI to generate the 3D model. The result returns to the Splatorium library as an `.spz` file. Scene layouts, names, thumbnails, source images, and generated files are all kept under `data\`. You use one browser page for the complete workflow; ComfyUI remains a background service.

## Before you begin

The Portable ZIP contains the Splatorium application, its web interface, launch scripts, workflows, and license notices. It does **not** contain the following large or hardware-specific components:

- a Node.js runtime;
- ComfyUI Windows Portable;
- the five model files used for generation.

You add these components once after extracting the ZIP. They remain inside the Portable folder, so the complete folder can be backed up or moved together.

### System requirements

- Windows 10 or 11 on a 64-bit PC
- A current browser with WebGL 2 support
- A ComfyUI Windows Portable edition that supports your GPU
- Enough free disk space for ComfyUI, approximately 3.8 GB of model files, generated assets, and backups
- An internet connection if you want the setup script to download the models

An NVIDIA GPU with about 12 GB of VRAM is recommended for generation. Choose a ComfyUI edition that supports your GPU. The optional Intel XPU profiles require a compatible PyTorch XPU environment and an Intel XPU that reports at least 16 GiB of device memory. Start with 65,536 gaussians when you are unsure which density to use. Actual speed and available density depend on the GPU, driver, ComfyUI edition, input image, and other running applications. Viewing existing models and editing scenes require less GPU memory than generation.

## Package layout

```text
SplatoriumPortable\
├── README.md                         Short Japanese introduction
├── run.bat                           Normal launcher
├── run-profile.bat                   Optional Intel XPU launcher
├── setup-models.bat                  Download the required models
├── import-models.bat                 Verify and import existing models
├── app\node\                         Place node.exe here
├── comfy\ComfyUI_windows_portable\   Place ComfyUI here
├── comfy\models.md                   Required model list
├── data\                             Your library and scenes
├── docs\                             English and Japanese user guides
└── models\incoming\                  Place existing model files here
```

Do not run Splatorium directly from inside the ZIP viewer. Extract the whole archive first.

## First-time setup

### 1. Extract the package

1. Create a short, writable folder such as `C:\SplatoriumPortable\`.
2. Extract the complete ZIP into that folder.
3. Confirm that `run.bat`, `app\`, `comfy\`, and `data\` are in the same folder.

Avoid a read-only location. Splatorium stores the library database and generated files under `data\`.

### 2. Add Node.js

The database component is tied to a Node.js major version. Use the same major version that built this Portable package.

1. Open `app\node\README.txt` and note the required Node.js major version and Windows architecture.
2. Download the matching Windows ZIP from the [official Node.js download page](https://nodejs.org/en/download).
3. Copy `node.exe` from that distribution to `app\node\node.exe`.

Splatorium uses this file directly. A system-wide Node.js installation does not replace it.

### 3. Add ComfyUI Windows Portable

1. Download the edition for your GPU from the [official ComfyUI Windows Portable guide](https://docs.comfy.org/installation/comfyui_portable_windows).
2. Extract the ComfyUI archive.
3. Copy its `python_embeded\` and `ComfyUI\` folders into `comfy\ComfyUI_windows_portable\`.

The completed layout must contain both files below:

```text
comfy\ComfyUI_windows_portable\python_embeded\python.exe
comfy\ComfyUI_windows_portable\ComfyUI\main.py
```

### 4. Add the model files

Choose one of the following methods.

#### Download the models

1. Double-click `setup-models.bat`.
2. Review the source, destination, file size, checksum, and license shown for each file.
3. Type `download` and press Enter.
4. Wait until all five files report `downloaded` or `skipped`.

The download is several gigabytes. You can run the script again after a network interruption; files that are already complete are kept.

#### Import model files that you already have

1. Open [`comfy\models.md`](../comfy/models.md) and reproduce the listed folder structure under `models\incoming\`.
2. Place all five files in their exact locations.
3. Open PowerShell in the Portable folder and run:

   ```powershell
   .\import-models.bat --check
   ```

4. When every file is accepted, run:

   ```powershell
   .\import-models.bat
   ```

When the import completes, the five files are placed under `comfy\ComfyUI_windows_portable\ComfyUI\models\`.

## Start Splatorium

1. Double-click `run.bat`.
2. Keep the original command window and the separate **Splatorium ComfyUI** window open.
3. Wait for ComfyUI to finish loading, then open <http://localhost:8787> in a browser. The launcher prints the address but does not open the browser for you.

The Splatorium page is designed for a window at least 900 pixels wide. Use a desktop browser for editing.

## Create your first 3D asset

1. Drag one image onto the Splatorium page, or select **画像から 3D 生成** (Generate 3D from an image).
2. Choose a Gaussian count. Start with **65,536 gaussians** for the lightest workload. Higher counts may preserve more detail but require more time and memory.
3. Leave the seed empty for a new random result, or enter a number when you want to repeat the same sampling choice.
4. Select **3D 生成を開始** (Start 3D generation).
5. Keep both command windows open while the job is running.

The job appears in the model collection. When generation finishes, the completed model replaces the job entry automatically. Open it to inspect the result, rename it in the inspector, or add it to a scene.

## Arrange and save a scene

1. Select a model in the collection and choose **シーンへ追加** (Add to scene), or drag the model into the scene.
2. Select an object in the scene tree or viewport.
3. Use **移動 (W)**, **回転 (E)**, or **拡縮 (R)**. Hold `Ctrl` while transforming to snap to the grid or angle increments.
4. Enter a scene name and select **保存** (Save). Select **上書き保存** (Overwrite) after editing an existing scene.

Useful shortcuts:

| Action | Shortcut |
|---|---|
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` |
| Move / rotate / scale | `W` / `E` / `R` |
| Focus the selected object | `F` |
| Reset the camera | `Home` |

Saved scenes appear in the same collection as models. Devices connected through the local network see the same collection and scene updates.

## Daily start and stop

After the first-time setup, start the app with `run.bat`, wait for ComfyUI to finish loading, and open <http://localhost:8787>.

To stop a normal session:

1. Finish or cancel any work in progress.
2. In the window that launched `run.bat`, press `Ctrl+C`, or close the window.
3. In the **Splatorium ComfyUI** window, press `Ctrl+C`, or close the window.

Both processes must be stopped. Closing the browser alone does not stop them.

## Data, backup, and moving the package

Splatorium stores the collection database, uploaded images, generated models, thumbnails, and saved scenes under `data\`.

To make a backup:

1. Stop Splatorium and ComfyUI.
2. Copy the complete `data\` folder to another drive.
3. Keep the folder structure unchanged.

To move the configured Portable package, stop both processes and copy the complete `SplatoriumPortable\` folder. This also keeps the local Node.js runtime, ComfyUI, and model files. On the destination computer, confirm that the copied ComfyUI edition supports that computer's GPU before starting Splatorium.

Before replacing your current copy, stop both processes and back up the complete configured folder. Extract the new release into a separate folder and read its release notes before copying any data or runtime components into it. Do not overwrite the configured folder with the new ZIP.

## Use Splatorium from another device

When the host computer and another device are on the same trusted network:

1. Start Splatorium on the host computer.
2. Find the host computer's IPv4 address in Windows network settings or with `ipconfig`.
3. On the other device, open `http://HOST-IP:8787`.
4. If the page does not load, allow the Node.js process on private networks in Windows Firewall and confirm that port 8787 is not blocked.

Splatorium does not provide user accounts in this version. Anyone who can reach the address can view and change the shared collection, so use LAN access only on a network you trust.

## Optional Intel XPU profiles

Start with `run.bat`. The profile launcher is only for an Intel XPU that reports at least 16 GiB of device memory and has a compatible PyTorch XPU environment inside ComfyUI.

For the standard 20-step workflow with ComfyUI high-VRAM mode:

```powershell
.\run-profile.bat intel-xpu-highvram
```

For a 15-step workflow that favors speed and may produce a visibly different result:

```powershell
.\run-profile.bat intel-xpu-fast
```

The profile launcher checks the device and selected workflow before starting. It does not accept additional ComfyUI arguments.

The profile launcher runs Splatorium and ComfyUI in the same command window. To stop a profile session, finish the current job and press `Ctrl+C` in that window.

## Troubleshooting

### `Missing bundled Node runtime`

Confirm that the file is exactly `app\node\node.exe`. Do not rename the Node.js installer or place the file in the Portable root.

### `NODE_MODULE_VERSION` appears

The Node.js major version is different from the one used to build the package. Open `app\node\README.txt`, download the stated major version, and replace `app\node\node.exe`.

### `Missing ComfyUI portable Python` or `Missing ComfyUI entrypoint`

The ComfyUI folder is missing or nested one level too deep. Confirm the two paths shown in [Add ComfyUI Windows Portable](#3-add-comfyui-windows-portable).

### A model download or import is rejected

Read the path named in the message. Remove the incomplete or incorrect copy at that path, then run `setup-models.bat` or `import-models.bat` again. Do not rename model files; their folders and names must match [`comfy\models.md`](../comfy/models.md).

### A generation job reports a missing model

Stop the session and run `setup-models.bat`, or repeat the import check for your existing files. Restart Splatorium after all five files are present.

### The browser cannot open `http://localhost:8787`

Check the command window for an error. Another application may already be using port 8787, or the server may have stopped. Close the conflicting application, then run `run.bat` again.

### ComfyUI cannot use port 8189

Close another ComfyUI instance or application that uses port 8189, then restart Splatorium.

### The Intel XPU profile does not start

Read the device message in the command window. These profiles require an Intel XPU with at least 16 GiB reported memory. Use `run.bat` for the normal launcher when the profile requirements are not met.

### Generation takes a long time

Generation time depends strongly on the GPU and selected Gaussian count. Start with 65,536 gaussians, close other GPU-heavy applications, and keep both command windows open. The first job after startup may take longer while ComfyUI loads the models.

## Build the Portable package from source

This section is for readers who have a Splatorium source checkout. It is not required when you downloaded a release ZIP.

Requirements:

- Windows
- Node.js 22 or later
- pnpm 10.33.1, as recorded in `package.json`
- Git

From the repository root, run:

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

The build creates:

```text
dist\portable\SplatoriumPortable\
dist\portable\SplatoriumPortable.zip
```

`pnpm build:portable-app` creates both outputs and prints the ZIP SHA-256. The three verification commands check the built application and archive. The final command checks the browser workflow after Chromium is installed by the preceding command. When configuring the generated package, use the Node.js major version shown in its `app\node\README.txt`.

## Licenses and help

Read `NOTICE`, `third-party-licenses.md`, and the files under `licenses\` before distributing or using the included workflows with model files. The DINOv3-derived vision encoder has additional use and trade-control conditions in `licenses\dinov3\LICENSE.md`.

If this guide does not solve a problem, copy the complete message from both command windows and report it at <https://github.com/Hitsuki-Ban/Splatorium/issues>. Include your Windows version, GPU, ComfyUI edition, the action you performed, and the first error shown.
