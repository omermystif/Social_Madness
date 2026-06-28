@echo off
setlocal

if not exist node_modules (
  echo Root dependencies are missing. Run npm install first.
  exit /b 1
)

if not exist server\node_modules (
  echo Server dependencies are missing. Installing them now...
  pushd server
  call npm install || exit /b 1
  popd
)

call npm run build || exit /b 1
pushd server
call npm run migrate || exit /b 1
call npm run start
popd
