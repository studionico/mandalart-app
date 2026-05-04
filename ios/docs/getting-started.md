# getting-started.md (iOS)

iOS 版を初めてビルドして Simulator で走らせるまでの手順。

## 前提

- macOS (Tahoe 26 で動作確認、Sonoma 14 / Sequoia 15 でも動くはず)
- Xcode 16+ (App Store からインストール)
- Homebrew (xcodegen を入れるため)
- desktop 版で使っている Supabase project の URL / anon key (= [`../../desktop/.env`](../../desktop/.env))

## セットアップ手順

### 1. xcodegen install (初回のみ)

```sh
brew install xcodegen
```

xcodegen は `project.yml` から `Mandalart.xcodeproj` を再生成するツール。`xcodeproj` は gitignore 済なので、clone 直後は必ずこの手順で生成する。

### 2. .xcodeproj 生成

```sh
cd ios
xcodegen generate
```

これで `ios/Mandalart.xcodeproj` ができる。`project.yml` を修正したら毎回これを再実行する。

### 3. Secrets.swift をテンプレからコピー

```sh
cp Mandalart/Services/Secrets.swift.template Mandalart/Services/Secrets.swift
```

`Mandalart/Services/Secrets.swift` を開いて、desktop 版で使っている `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` ([`../../desktop/.env`](../../desktop/.env) 参照) を貼る:

```swift
enum Secrets {
    static let supabaseURL = URL(string: "https://your-project.supabase.co")!
    static let supabaseAnonKey = "ey..."
}
```

`Secrets.swift` 自体は [`.gitignore`](../.gitignore) で除外済なので commit されない。

### 4. Xcode で開く

```sh
open Mandalart.xcodeproj
```

初回は SPM (supabase-swift とその transitive 依存) を resolve するのでしばらく待つ (Xcode 上部のプログレスバー)。

### 5. Run

- ターゲット選択 (Xcode 上部) → 例: `iPhone 17 Pro` (iOS 26.4)
- `Cmd+R` でビルド + Simulator 起動

ダッシュボードに「マンダラートがありません」と出れば起動成功。

### 6. クラウド同期確認

- Settings (左上 person アイコン) → 「サインイン / 新規登録」
- desktop 版で使っているメール / パスワードでサインイン
- Settings → 「今すぐ同期」 → desktop で作ったマンダラートが iOS に pull されてくる

## なぜ Xcode GUI で build / run なのか

`xcodebuild` CLI で SPM 依存 (supabase-swift) を含む project をビルドすると、iOS Simulator destination が候補から消える既知の不具合がある。**Xcode GUI なら問題なくビルドできる**。詳細は [`pitfalls.md`](pitfalls.md) #1 参照。

## 困ったとき

- **起動時にクラッシュ** (SwiftData schema 不整合) → Simulator のアプリ長押し → 削除 → 再 Run。@Model フィールドを変更した後によく発生する ([`pitfalls.md`](pitfalls.md) #3)
- **Sign in 画面が出ない** → ネスト sheet の environment 伝搬問題。明示 `.environment(auth)` を確認 ([`pitfalls.md`](pitfalls.md) #2)
- **Build error: Cannot find type 'X'** → SPM が re-resolve できていない可能性。Xcode メニュー File → Packages → Reset Package Caches
- **Pull で空が返る** → サインインが切れているか、Supabase project が違う。Settings の「メール」表示で確認
