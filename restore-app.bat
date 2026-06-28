@echo off
setlocal

if "%~1"=="" (
  echo Usage: restore-app.bat "server\backup\<file>.db.gz"
  exit /b 1
)

if exist server\taskmanager.db copy /Y server\taskmanager.db server\taskmanager.db.bak >nul
powershell -Command "$in = [System.IO.File]::OpenRead('%~1'); $gz = New-Object IO.Compression.GzipStream($in,[IO.Compression.CompressionMode]::Decompress); $out = [System.IO.File]::Create('server\\taskmanager.db'); $gz.CopyTo($out); $out.Dispose(); $gz.Dispose(); $in.Dispose();"
echo Restore complete.
