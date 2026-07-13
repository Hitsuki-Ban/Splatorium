@echo off
setlocal

set "ROOT=%~dp0"
set "NODE=%ROOT%app\node\node.exe"
set "SCRIPT=%ROOT%scripts\import-models.mjs"
set "MANIFEST=%ROOT%comfy\models.json"
set "INCOMING=%ROOT%models\incoming"
set "COMFY_ROOT=%ROOT%comfy\ComfyUI_windows_portable\ComfyUI"

if not exist "%NODE%" (
  echo Missing bundled Node runtime: %NODE%
  echo Place node.exe under app\node\ before running this portable package.
  exit /b 1
)

if not exist "%SCRIPT%" (
  echo Missing model import script: %SCRIPT%
  exit /b 1
)

if not exist "%MANIFEST%" (
  echo Missing model manifest: %MANIFEST%
  exit /b 1
)

if not exist "%INCOMING%\" (
  echo Missing incoming model directory: %INCOMING%
  echo Place files under models\incoming\ preserving the manifest source paths.
  exit /b 1
)

if not exist "%COMFY_ROOT%\main.py" (
  echo Missing ComfyUI portable runtime: %COMFY_ROOT%\main.py
  echo Extract ComfyUI Windows Portable into comfy\ComfyUI_windows_portable\ before importing models.
  exit /b 1
)

"%NODE%" "%SCRIPT%" --manifest "%MANIFEST%" --incoming-dir "%INCOMING%" --comfy-root "%COMFY_ROOT%" %*
