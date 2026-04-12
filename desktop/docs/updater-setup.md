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
- **macOS で "開発元が未確認" 警告**: Apple コードサイニング未設定。System Preferences → Security でその場で許可、または `xattr -cr /Applications/Mandalart.app`。
- **macOS で「アプリが壊れている」**: 同上。`xattr -cr /Applications/Mandalart.app` で隔離属性を剥がせば起動できる。

### 過去にハマった点（今回のセットアップで判明したもの）

これらは現在の `tauri.conf.json` / `tauri.windows.conf.json` / `.github/workflows/release.yml` で対応済み。同じ現象に当たったときの参照用に残す。

#### 1. WiX (Windows MSI) の Unicode パス問題
- 症状: `release (windows-latest)` ジョブで `failed to bundle project ... light.exe` エラー
- 原因: `productName` が日本語 `マンダラート` だと、出力ファイル `マンダラート_X.Y.Z_x64_en-US.msi` を WiX 3 の `light.exe` が扱えない
- 対策: `productName` を ASCII (`Mandalart`) に統一。ウィンドウタイトルだけ日本語にする場合は `app.windows[0].title` で別途設定

#### 2. tauri-action が `Signature not found for the updater JSON. Skipping upload...` を出す
- 症状: ビルドは成功し `.sig` ファイルもローカルには生成されているが、リリース assets に `latest.json` が含まれない
- 原因: `releaseDraft: true` だと `tauri-action` の `uploadVersionJSON` が直前にアップロードした `.sig` asset を `listReleaseAssets` で取得できず、JSON 生成をスキップする ([tauri-action#943](https://github.com/tauri-apps/tauri-action/issues/943) / [#1098](https://github.com/tauri-apps/tauri-action/issues/1098))
- 対策: `releaseDraft: false` に変更。Draft で運用したいなら、ビルドを matrix で行い、最後に `needs:` で集約ジョブを追加してそこで `includeUpdaterJson: true` を指定するパターン
- 補足: `tauri.conf.json` の `bundle.createUpdaterArtifacts: true` も明示的に設定すること（Tauri v2 推奨）

#### 3. 非 ASCII の productName で release asset 名が壊れる
- 症状: ローカルでは `マンダラート_X.Y.Z_amd64.deb` だが、リリース assets には `_X.Y.Z_amd64.deb`（先頭の `マンダラート` が消えた状態）でアップロードされる
- 原因: GitHub Releases API が非 ASCII プレフィックスを URL エンコード時に剥ぎ落とす挙動
- 影響: tauri-action が後続の sig マッチングで失敗 → `latest.json` 生成失敗
- 対策: 上記と同じく `productName` を ASCII に統一

#### 4. プライベートリポジトリだと updater が 404 になる
- 症状: `latest.json` は assets に存在するのに、エンドユーザーのアプリでアップデート検知が失敗
- 原因: GitHub Releases の assets はプライベートリポジトリの場合、認証なしのダウンロードができない（アプリ内 updater は当然ユーザー認証しない）
- 対策: いずれかを選ぶ
  - リポジトリを Public にする（一番シンプル）
  - 別の公開ストレージ（S3 / R2 / Vercel Blob 等）に成果物だけコピーして `endpoints` をそちらに向ける
  - 公開ミラーリポジトリに成果物だけ転送する
