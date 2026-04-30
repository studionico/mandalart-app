# ツール運用ワークフロー

## 概要

Claude Code 用に整備されたプロジェクト専用ツール 3 種:

| 種別 | ツール | 配置 |
|---|---|---|
| slash command | [`/sync-docs`](../../.claude/commands/sync-docs.md) | docs 同期検査 |
| subagent | [`migration-release-check`](../../.claude/agents/migration-release-check.md) | Supabase ALTER 漏れ予防 |
| slash command | [`/check-rules`](../../.claude/commands/check-rules.md) | 規約違反 / Tauri 落とし穴の検出 |

各ツールの仕様詳細は配置先ファイルに記述。本 doc は **どのタイミングで何を組合せて使うか** を整理する。

---

## ツール早見表

### `/sync-docs [<range>]`

| 項目 | 値 |
|---|---|
| タイプ | slash command |
| 配置 | [`.claude/commands/sync-docs.md`](../../.claude/commands/sync-docs.md) |
| 検査対象 | git diff の変更ファイル + 対応 docs カテゴリ |
| 引数例 | (空 = uncommitted) / `HEAD~5` / `main` / `<branch>` |
| 主な用途 | constants / API / migration / store / type / component / hook / animation の 8 カテゴリで「コードに追加されたが docs 未記載 / docs に書かれたがコード削除済み」を検出 |
| 副作用 | なし (レポートのみ、書込みは行わない) |

### `migration-release-check`

| 項目 | 値 |
|---|---|
| タイプ | subagent |
| 配置 | [`.claude/agents/migration-release-check.md`](../../.claude/agents/migration-release-check.md) |
| 検査対象 | [`desktop/src-tauri/migrations/`](../src-tauri/migrations/) 全件 + `lib.rs` / [`cloud-sync-setup.md`](cloud-sync-setup.md) / [`push.ts`](../src/lib/sync/push.ts) / [`pull.ts`](../src/lib/sync/pull.ts) / [`realtime.ts`](../src/lib/realtime.ts) / [`types/index.ts`](../src/types/index.ts) |
| 起動方法 | (a) main Claude が新 SQL migration 検知で proactively 自動起動 (b) 「リリース前チェックして」のような自然言語で依頼 (c) Agent ツールで `subagent_type: migration-release-check` 明示指定 |
| 主な用途 | 各 migration の Supabase 手動 ALTER 漏れ + sync コード未配線の検出 (落とし穴 #17 / PGRST204 thrash 予防) |
| 副作用 | なし (レポートのみ) |

### `/check-rules [<scope>]`

| 項目 | 値 |
|---|---|
| タイプ | slash command |
| 配置 | [`.claude/commands/check-rules.md`](../../.claude/commands/check-rules.md) |
| 検査対象 | 9 ルール (localStorage / `window.confirm` / `<a download>.click()` / HTML5 D&D / position 裸比較 / setTimeout magic / CSS keyframes transform var / `_old_web/` import / 9-3 裸数値) |
| 引数例 | (空 = 全 src) / `<file>` / `<glob>` / `--diff` |
| 主な用途 | コーディング規約違反 / Tauri 落とし穴 / 副次的な dead code 発見 |
| 副作用 | なし (レポートのみ)。[`tasks.md`](tasks.md) 29.1 ESLint plugin 化までの繋ぎ |

---

## 推奨組合せワークフロー

### A. 通常コミット前 (軽量・毎回)

```
編集 → /check-rules --diff → 違反修正 → /cp
```

`--diff` で uncommitted な追加行のみ走査するため数秒で完了。Tauri 落とし穴の埋込みを
水際で防ぐ。`lint-staged` は ESLint 標準ルールしか見ないので `/check-rules` がプロジェクト
固有規約 (`STORAGE_KEYS` 強制、`CENTER_POSITION` 強制等) を補完する。

### B. PR 提出前 / 機能完了時 (中量)

```
/check-rules → /sync-docs HEAD~N → 両方の指摘を修正 → /cp
```

機能ブランチで複数コミット重ねた後の総点検。N は機能ブランチで重ねた commit 数
(典型は 3〜10)。docs の追従漏れと規約違反を一括捕捉。

### C. リリース直前 (最重量・必須)

```
/sync-docs main → migration-release-check → /check-rules → 全部修正 → /cp → git tag
```

特に **`migration-release-check` がリリース blocker** (Supabase ALTER 漏れがあると配布後に
PGRST204 thrash 発生 → 落とし穴 #17)。`git tag v...` 前に必ず通すこと。

### D. 週次健康診断 (定期・任意)

```
/sync-docs <先週のタグ or commit> → /check-rules → 軽微な違反は累積前に潰す
```

時間経過で増えるドリフトを定期的に解消し、エンジン状態の hygiene を担保する。

---

## ツール選択ガイド (シーン別)

| 「こうしたい」 | 使うべきツール |
|---|---|
| 機能を実装した。docs 更新忘れがないか? | `/sync-docs` |
| 新 migration を追加した。配布前に大丈夫か? | `migration-release-check` |
| 中心セルロジックに `position === 4` を書いた気がする | `/check-rules` |
| `localStorage.getItem('xxx')` で読んでみたが定数化忘れたかも | `/check-rules` |
| Supabase 手動 ALTER の漏れだけが心配 | `migration-release-check` (focused) |
| この PR、規約違反してないか軽くチェックしたい | `/check-rules <PR の追加ファイル glob>` |
| 新規セッションで前回までの状態を確認したい | 3 ツールいずれもレポートのみで副作用無し、安全に走らせて OK |

---

## 注意点

1. **3 ツールいずれも「レポートのみ」、勝手に書き換えない**。修正案ドラフトは出るが
   ユーザーが承認してから個別に Edit ツールで適用するフロー。誤検出した場合の余計な
   書換を避ける設計
2. **false positive 許容**: 完璧な静的解析は目指さない。grep ベースで 80% カバーし、
   残り 20% は人間判断で除外する想定 ([`tasks.md`](tasks.md) 29.1 の ESLint plugin
   化で精度を上げる方向)
3. **ツール自体のメンテ**: ルール追加・カテゴリ拡張は各ツールの `.md` ファイルを直接編集
   する。future Claude session が必要に応じて拡張可能
4. **重複オーバーヘッド**: A → B → C と進むほど重くなるので、コミット頻度に応じて使い分ける
   (毎コミットで C を走らせる必要はない)
5. **新ツール追加時**: 本 doc の「ツール早見表」+「ワークフロー」+「シーン別ガイド」3 セクション
   に行を追加すること。`/sync-docs` で本 doc が「対応 docs」として認識されるよう構造を維持
