#!/usr/bin/env bash
# usage: ./scripts/bump-version.sh 0.2.0
#
# package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json の
# version を一括で書き換える。1 箇所だけ変更して他を忘れる事故を防ぐ。
# 書き換え後は git tag は作らない (手動で `git tag v0.2.0` → push)。

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>  (e.g. 0.2.0)" >&2
  exit 1
fi

NEW="$1"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# semver の簡易バリデーション
if ! echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: '$NEW' is not a valid semver (expected X.Y.Z)" >&2
  exit 1
fi

echo "Bumping version → $NEW"

# 1. package.json  ("version": "X.Y.Z")
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW\"/" "$DIR/package.json"

# 2. tauri.conf.json  ("version": "X.Y.Z")
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW\"/" "$DIR/src-tauri/tauri.conf.json"

# 3. Cargo.toml  (version = "X.Y.Z" — [package] セクション内)
sed -i '' "s/^version = \"[^\"]*\"/version = \"$NEW\"/" "$DIR/src-tauri/Cargo.toml"

echo "Updated:"
grep '"version"' "$DIR/package.json" "$DIR/src-tauri/tauri.conf.json"
grep '^version' "$DIR/src-tauri/Cargo.toml"
echo "Done. Remember to commit and tag: git tag v$NEW"
