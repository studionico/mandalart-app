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

## 実機 (iPhone) にインストールする

開発中は **Free Apple ID Signing** (= Apple Developer Program $99/年に未加入でも使える経路) を推奨。Phase 11 で App Store / TestFlight 配布に切替予定。

### 経路 A: Free Apple ID Signing (= 開発中、無料、推奨)

**制限**: 証明書が **7 日で expire** (= 1 週間ごとに Xcode から再ビルドが必要) / Personal Team で同時 install できる Free signed app は最大 3 個 / Push 通知 / In-App Purchase / iCloud / Universal Links は使えない (本プロジェクトは Supabase REST 通信のみで全て該当なし、問題なし ✓)。

#### 手順

1. **iPhone を Mac に USB 接続** (Lightning/USB-C ケーブル)。初回は iPhone 側で「このコンピュータを信頼」を選択
2. **xcodeproj を最新化して開く**
   ```sh
   cd ios
   xcodegen generate
   open Mandalart.xcodeproj
   ```
3. **Signing & Capabilities を設定**
   - Project navigator で `Mandalart` (= 一番上の青いアイコン) を選択
   - 中央パネルで `Mandalart` target を選択 → **Signing & Capabilities** タブ
   - **Team**: ドロップダウンから自分の Apple ID (= `<あなたの名前> (Personal Team)`) を選択
   - **Automatically manage signing** にチェック
   - **Bundle Identifier** が `jp.mandalart.app.ios` のままだと「他のユーザーが先に登録済」エラーになる可能性あり。その場合は **末尾に自分の suffix を付ける** (例: `jp.mandalart.app.ios.<あなたのハンドル>`)。この変更は [`project.yml`](../project.yml) の `PRODUCT_BUNDLE_IDENTIFIER` を編集 → `xcodegen generate` 再実行で反映するのが推奨 (= xcodeproj 側を直接編集すると次回の xcodegen で消える)
4. **destination で実機を選択**: 上部 toolbar で「Mandalart > iPhone 17 Pro Simulator」と表示されている部分をクリック → 接続した iPhone の実機名 (= USB 接続時に「**接続デバイス**」セクションに出る) に切替
5. **Cmd+R で Build & Run** (= 初回は数分。SPM resolve + 署名 + iPhone へのインストール)
6. **iPhone 側で「信頼」設定** (= 初回のみ)
   - 起動時に「**信頼されていない開発元**」alert が出る (アプリは起動しない)
   - iPhone の **設定 → 一般 → VPN とデバイス管理 → デベロッパAPP → <Apple ID>** を開く
   - 「**<Apple ID> を信頼**」をタップ → 確認
7. **アプリ起動** → サインイン → 同期検証 (= desktop で作ったマンダラートが pull されるか)

#### 7 日経過後の再ビルド

- iPhone でアプリを開くと「アプリを利用できません」alert が出る
- iPhone を Mac に再接続 → Xcode で `Cmd+R` するだけ (= 自動で署名し直して再 install)
- iCloud 経由のデータは Supabase でクラウド保存されているので、再 install しても消えない (= Settings から再サインイン → pull で復元)

### 経路 B: TestFlight (= Apple Developer Program 加入後、Phase 11)

**前提**: Apple Developer Program 加入 ($99/年)。本プロジェクトの [`tasks.md`](tasks.md) では **Phase 11** で「MVP 完成後」とされており、現状未加入。

加入後の手順 (= ざっくり):

1. **App Store Connect** でアプリ ID 登録 (`jp.mandalart.app.ios`)
2. Xcode で **Product → Archive** (= destination は `Any iOS Device (arm64)`)
3. Organizer の Archives タブから **Distribute App → App Store Connect → Upload**
4. App Store Connect の **TestFlight タブ** で内部テスター (= 自分の Apple ID メール) を招待
5. 招待された端末で **TestFlight アプリ** から install (= 90 日有効、再ビルド不要)

詳細手順は Phase 11 着手時に [`tasks.md`](tasks.md) Phase 11 節 + 別途追加予定の `release.md` で文書化する。

## 困ったとき

- **起動時にクラッシュ** (SwiftData schema 不整合) → Simulator のアプリ長押し → 削除 → 再 Run。@Model フィールドを変更した後によく発生する ([`pitfalls.md`](pitfalls.md) #3)
- **Sign in 画面が出ない** → ネスト sheet の environment 伝搬問題。明示 `.environment(auth)` を確認 ([`pitfalls.md`](pitfalls.md) #2)
- **Build error: Cannot find type 'X'** → SPM が re-resolve できていない可能性。Xcode メニュー File → Packages → Reset Package Caches
- **Pull で空が返る** → サインインが切れているか、Supabase project が違う。Settings の「メール」表示で確認
