#!/usr/bin/env bash

set -euo pipefail

no_login=false

usage() {
  printf '%s\n' \
    '用法：install.sh [--no-login]' \
    '' \
    '默认安装 sharge CLI 后执行 sharge login。' \
    '使用 --no-login 只安装 CLI。'
}

while (($# > 0)); do
  case "$1" in
    --no-login)
      no_login=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '不支持的安装器参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '安装 sharge 需要 Node.js 20 或更高版本。' >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || ((node_major < 20)); then
  printf '安装 sharge 需要 Node.js 20 或更高版本；当前是 %s。\n' \
    "$(node --version)" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' '安装 sharge 需要 npm。' >&2
  exit 1
fi

install_prefix="${SHARGE_INSTALL_PREFIX:-${HOME}/.local}"
package_spec="${SHARGE_INSTALL_PACKAGE:-@sharge/cli}"
binary="${install_prefix}/bin/sharge"

mkdir -p "$install_prefix"
npm install --global --prefix "$install_prefix" "$package_spec"

if [[ ! -x "$binary" ]]; then
  printf 'CLI 安装完成，但没有找到可执行文件：%s\n' "$binary" >&2
  exit 1
fi

printf 'sharge CLI 已安装：%s\n' "$binary"
case ":${PATH:-}:" in
  *":${install_prefix}/bin:"*) ;;
  *)
    printf '%s\n' '当前 PATH 尚未包含安装目录。请执行：'
    printf '  export PATH=%q/bin:"$PATH"\n' "$install_prefix"
    ;;
esac

if [[ "$no_login" == true ]]; then
  printf '%s\n' '已按 --no-login 跳过登录。需要时执行：sharge login'
  exit 0
fi

set +e
"$binary" login
login_status=$?
set -e
if ((login_status != 0)); then
  printf '%s\n' \
    'sharge CLI 已安装但登录未完成。请修复网络或授权问题后执行：sharge login' >&2
  exit "$login_status"
fi
