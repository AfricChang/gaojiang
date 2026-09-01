@echo off
setlocal

rem %~dp0 是本脚本所在目录（tools\），上一级即仓库根。
rem 用相对推导而非硬编码绝对路径，仓库改名或换机器都不用改这个文件。
set "GAOJIANG_ROOT=%~dp0.."
set "NODE_NO_WARNINGS=1"
node --experimental-strip-types "%GAOJIANG_ROOT%\scripts\mermaid-export.ts" %*
exit /b %ERRORLEVEL%
