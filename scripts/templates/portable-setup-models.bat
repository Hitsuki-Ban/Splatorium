@echo off
setlocal

set "ROOT=%~dp0"
set "NODE=%ROOT%app\node\node.exe"
set "SCRIPT=%ROOT%scripts\init-models.mjs"
set "MANIFEST=%ROOT%comfy\models.json"
set "COMFY_ROOT=%ROOT%comfy\ComfyUI_windows_portable\ComfyUI"

if not exist "%NODE%" (
  echo Missing bundled Node runtime: %NODE%
  echo Place node.exe under app\node\ before running this portable package.
  exit /b 1
)

if not exist "%SCRIPT%" (
  echo Missing model initialization script: %SCRIPT%
  exit /b 1
)

if not exist "%MANIFEST%" (
  echo Missing model manifest: %MANIFEST%
  exit /b 1
)

if not exist "%COMFY_ROOT%\main.py" (
  echo Missing ComfyUI portable runtime: %COMFY_ROOT%\main.py
  echo Extract ComfyUI Windows Portable into comfy\ComfyUI_windows_portable\ before downloading models.
  exit /b 1
)

"%NODE%" "%SCRIPT%" --manifest "%MANIFEST%" --comfy-root "%COMFY_ROOT%"
