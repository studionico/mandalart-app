# 自動アップデート セットアップ手順

このドキュメントでは、マンダラートデスクトップアプリの自動アップデート機能を有効化するための手動作業を説明します。コード側の実装 (プラグイン登録・UI・GitHub Actions ワークフロー) はすでに完了していますが、**署名鍵ペアの生成と GitHub Secrets への登録はセキュリティ上の理由から手動で行う必要があります**。

---

## 概要

- **配布方法**: GitHub Releases に macOS `.dmg` / Windows `.msi` / Linux `.AppImage` をアップロード
- **アップデート検知**: 起動時に `latest.json` をチェック、新バージョンがあればダイアログ表示
- **署名検証**: Tauri の minisign ベース署名で改ざんを防止
- **再起動**: インストール完了後に自動再起動 (`tauri-plugin-process`)

---

## ステップ 1: 署名鍵ペアの生成

開発マシン上でローカルに 1 度だけ実行します。

```bash
cd desktop
npx tauri signer generate -w ~/.tauri/mandalart.key
```

プロンプトでパスフレーズを設定 (空にもできますが推奨しません)。生成されるもの:

- `~/.tauri/mandalart.key` — 秘密鍵 (**絶対に git 管理・Web 公開しない**)
- `~/.tauri/mandalart.key.pub` — 公開鍵

---

## ステップ 2: 公開鍵を `tauri.conf.json` に埋め込む

```bash
cat ~/.tauri/mandalart.key.pub
```

出力された 1 行の base64 文字列を `desktop/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に貼り付け:

```json
"updater": {
  "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...",
  "endpoints": [
    "https://github.com/studionico/mandalart-app/releases/latest/download/latest.json"
  ]
}
```

> 現状は `REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY` というプレースホルダが入っています。生成した公開鍵で置き換えてください。

公開鍵を更新した後、`git commit` して push します。

---

## ステップ 3: GitHub Secrets に秘密鍵を登録

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下の 2 つを追加:

| Secret 名 | 値 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.tauri/mandalart.key` の中身全体 (複数行コピペ) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | ステップ 1 で設定したパスフレーズ (空なら空文字列) |

---

## ステップ 4: 最初のリリースを作成

バージョンタグを push するとワークフローが走ります:

```bash
# desktop/src-tauri/tauri.conf.json の version と
# desktop/package.json の version を 0.1.1 など上げてから
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions の `Release` ワークフローが macOS (Apple Silicon / Intel) / Ubuntu / Windows でビルドし、**Draft Release** に成果物をアップロードします。

- `.dmg`, `.msi`, `.AppImage` などのインストーラ
- `latest.json` — updater プラグインが参照するメタデータ (バージョン / ダウンロード URL / 署名)

Draft を確認して問題なければ **Publish release** ボタンで公開。

---

## ステップ 5: アップデート動作確認

1. 旧バージョンのアプリをインストールして起動
2. 新バージョンを公開した状態で旧バージョンアプリを再起動
3. 起動後しばらくしてアップデートダイアログが出れば OK
4. 「ダウンロードしてインストール」→ 進捗バー → 再起動

---

## 注意事項

### macOS のコードサイニング (Apple Developer 必須)

このワークフローは **Tauri の minisign 署名のみ**で、Apple のコードサイニング / Notarization は含みません。ユーザーは「開発元が未確認」警告を手動で許可する必要があります。

正式配布するなら以下を追加で設定する必要があります:

- Apple Developer Program 加入 ($99/year)
- `.cer` / `.p12` を GitHub Secrets (`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`) に登録
- `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` も追加
- tauri-action が自動で codesign + notarize を行う

### Windows のコードサイニング

Windows も未署名だと SmartScreen 警告が出ます。正式には EV コードサイニング証明書が必要 (年 $200〜400 程度)。

### バージョン番号の管理

Tauri updater は **sem-ver 比較**で新旧を判定します。リリースのたびに以下 3 箇所を同じ値に揃えてください:

- `desktop/package.json` の `"version"`
- `desktop/src-tauri/tauri.conf.json` の `"version"`
- `desktop/src-tauri/Cargo.toml` の `version`
- git タグ (`v0.1.1` 形式)

### トラブルシューティング

- **起動時に何も出ない**: 正常。新バージョンがない、またはエンドポイントが公開前。`[updater] check failed:` のログはコンソールで確認。
- **"invalid public key" エラー**: `tauri.conf.json` の pubkey がプレースホルダのまま、もしくは改行コードが混入。
- **"signature verification failed"**: リリースの署名とアプリ内蔵の pubkey が不一致。ステップ 2 をやり直し、アプリを再ビルドして再配布。
- **macOS で "開発元が未確認" 警告**: Apple コードサイニング未設定。System Preferences → Security でその場で許可、または `xattr -cr /Applications/マンダラート.app`。
