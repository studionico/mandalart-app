# マンダラート

階層的な 3×3 グリッドで思考を展開するデスクトップアプリ。
各セルをクリックするとさらに 3×3 に掘り下げられる無限階層式の思考ツール。

## 開発

アクティブなコードベースは [`desktop/`](desktop/) 配下の Tauri v2 + Vite + React アプリです。

```bash
cd desktop
npm install
npm run tauri dev
```

詳細は [`CLAUDE.md`](CLAUDE.md) および [`desktop/docs/`](desktop/docs/) を参照してください。

## リポジトリ構成

- [`desktop/`](desktop/) — Tauri デスクトップアプリ（現行版）
- [`_old_web/`](_old_web/) — Next.js + Supabase で試作した初期 web 版（メンテ停止、参照用）
- [`CLAUDE.md`](CLAUDE.md) — Claude Code 向けプロジェクトガイド
