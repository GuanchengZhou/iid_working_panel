#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "请先安装 Node.js 22.13 或更新版本。"
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || { read -k 1; exit 1; }
fi
if curl -fsS --max-time 2 http://127.0.0.1:4317/api/health >/dev/null 2>&1; then
  open "http://127.0.0.1:4317"
  echo "工作台已在运行。"
  exit 0
fi
if [[ ! -d dist ]]; then
  npm run build || { read -k 1; exit 1; }
fi
(sleep 2; open "http://127.0.0.1:4317") &
echo "IID 科研工作台：http://127.0.0.1:4317"
echo "关闭此窗口或按 Ctrl+C 可停止服务。"
npm start
