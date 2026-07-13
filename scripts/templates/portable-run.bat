@echo off
setlocal

set "ROOT=%~dp0"
set "NODE=%ROOT%app\node\node.exe"
set "SERVER=%ROOT%app\server\dist\index.js"
set "PUBLIC=%ROOT%app\server\public"
set "DATA=%ROOT%data"
set "WORKFLOW=%ROOT%comfy\workflows\image-to-splat.json"
set "MANIFEST=%ROOT%comfy\models.json"
set "COMFY_ROOT=%ROOT%comfy\ComfyUI_windows_portable"
set "COMFY_PY=%COMFY_ROOT%\python_embeded\python.exe"
set "COMFYUI_MODEL_ROOT=%COMFY_ROOT%\ComfyUI"
set "COMFY_MAIN=%COMFYUI_MODEL_ROOT%\main.py"

if not exist "%NODE%" (
  echo Missing bundled Node runtime: %NODE%
  echo Place node.exe under app\node\ before running this portable package.
  exit /b 1
)

if not exist "%SERVER%" (
  echo Missing Splatorium server entrypoint: %SERVER%
  exit /b 1
)

if not exist "%PUBLIC%\index.html" (
  echo Missing Splatorium web static files: %PUBLIC%
  exit /b 1
)

if not exist "%WORKFLOW%" (
  echo Missing ComfyUI workflow: %WORKFLOW%
  exit /b 1
)

if not exist "%MANIFEST%" (
  echo Missing model manifest: %MANIFEST%
  exit /b 1
)

if not exist "%COMFY_PY%" (
  echo Missing ComfyUI portable Python: %COMFY_PY%
  echo Extract ComfyUI Windows Portable into comfy\ComfyUI_windows_portable\.
  exit /b 1
)

if not exist "%COMFY_MAIN%" (
  echo Missing ComfyUI entrypoint: %COMFY_MAIN%
  echo Extract ComfyUI Windows Portable into comfy\ComfyUI_windows_portable\.
  exit /b 1
)

if not exist "%DATA%" mkdir "%DATA%"

set "HOST=0.0.0.0"
set "PORT=8787"
set "COMFYUI_URL=http://127.0.0.1:8189"
set "SPLATORIUM_DATA_DIR=%DATA%"
set "SPLATORIUM_WEB_DIR=%PUBLIC%"
set "IMAGE_TO_SPLAT_WORKFLOW_PATH=%WORKFLOW%"
set "SPLATORIUM_MODEL_MANIFEST=%MANIFEST%"
set "COMFYUI_ROOT=%COMFYUI_MODEL_ROOT%"

echo Starting ComfyUI on %COMFYUI_URL%
start "Splatorium ComfyUI" "%COMFY_PY%" "%COMFY_MAIN%" --listen 127.0.0.1 --port 8189 --disable-auto-launch

echo Starting Splatorium server
echo Local URL: http://localhost:%PORT%
echo LAN URL: http://^<this-pc-ip^>:%PORT%
"%NODE%" "%SERVER%"
