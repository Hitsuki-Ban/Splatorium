@echo off
setlocal

set "ROOT=%~dp0"
set "NODE=%ROOT%app\node\node.exe"
set "HELPER=%ROOT%scripts\launch-comfy-profile.mjs"

if not exist "%NODE%" (
  echo Missing bundled Node runtime: %NODE%
  echo Place node.exe under app\node\ before running this portable package.
  exit /b 1
)

if not exist "%HELPER%" (
  echo Missing portable profile launcher: %HELPER%
  exit /b 1
)

if "%~1"=="" (
  echo Missing profile. Usage: run-profile.bat ^<intel-xpu-highvram^|intel-xpu-fast^>
  exit /b 1
)

set "PROFILE="
if /i "%~1"=="intel-xpu-highvram" set "PROFILE=intel-xpu-highvram"
if /i "%~1"=="intel-xpu-fast" set "PROFILE=intel-xpu-fast"
if defined PROFILE goto profile_ok
echo Unknown portable profile. Usage: run-profile.bat ^<intel-xpu-highvram^|intel-xpu-fast^>
exit /b 1

:profile_ok

if not "%~2"=="" (
  echo The profile launcher accepts exactly one profile name and no additional arguments.
  exit /b 1
)

"%NODE%" "%HELPER%" "%PROFILE%"
