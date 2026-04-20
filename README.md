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

## macOS でインストールするとき

現在のリリースビルドは Apple Developer Program の正式署名を行っていないため、macOS
(特に Apple Silicon + Sequoia 以降) でインストール直後に起動しようとすると:

- 「“Mandalart.app” は壊れているため開けません。ゴミ箱に入れる必要があります。」
- または 「“Mandalart.app” の開発元を検証できませんでした。」

と警告が出ます。**「ゴミ箱に入れる」は押さないでください** (アプリ本体が消えます)。
以下いずれかの方法で 1 回だけ quarantine 属性を外せば、以降は普通にダブルクリックで起動できます。

### 方法 1: Terminal で 1 コマンド (推奨・確実)

Applications フォルダに `Mandalart.app` をドラッグしてから:

```bash
xattr -cr /Applications/Mandalart.app
```

別の場所に置いた場合はそのパスに合わせて調整してください。

### 方法 2: 右クリック → 開く (GUI 操作)

1. 警告ダイアログで「**完了**」(または「キャンセル」) を押して閉じる
2. Finder で `Mandalart.app` を **右クリック (Ctrl+クリック) → 「開く」**
3. 再度出る警告ダイアログに「**開く**」ボタンが追加されているのでそれを押す

### 方法 3: システム設定から許可

1. 警告ダイアログを閉じる
2. **システム設定 → プライバシーとセキュリティ** を開く
3. 下の方に「“Mandalart” の使用を制限しています」が出ているので **「このまま開く」** を押す

---

Linux / Windows 版はこの手順不要です。

## リポジトリ構成

- [`desktop/`](desktop/) — Tauri デスクトップアプリ（現行版）
- [`_old_web/`](_old_web/) — Next.js + Supabase で試作した初期 web 版（メンテ停止、参照用）
- [`CLAUDE.md`](CLAUDE.md) — Claude Code 向けプロジェクトガイド
