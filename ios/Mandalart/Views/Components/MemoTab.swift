import SwiftUI
import SwiftData

/// EditorView 右ペインのメモタブ。`grid.memo` を編集 / プレビュー切替で扱う。
///
/// **編集**: SwiftUI `TextEditor` (multi-line)。`grid.memo` を直接 binding し、
/// `@Observable` の自動通知経由で realtime 同期も即時反映される (= `@State` 経由だと
/// sync 受信時に追従できないことがある)。ロック中は disable。
///
/// **プレビュー**: 行単位で render し、`# / ## / ###` 見出しと `- ` リストを手動 parse、
/// 各行の inline (太字 / italic / リンク) は `AttributedString(markdown:)` に委譲。
/// **iOS 標準の `AttributedString.MarkdownParsingOptions(.inlineOnlyPreservingWhitespace)` を
/// 1 度の `Text` で render すると見出しや改行が崩れる**ので、line-by-line で組み立てる方式を採用。
///
/// **同期**: `grid.memo` 変更時に `grid.updatedAt` を進める → 15 秒間隔の auto-push (= MandalartApp)
/// または scene .background で push される。debounced save は不要 (SwiftData autosave + 15 秒 polling
/// で十分)。
///
/// **対応 Markdown** (desktop の `MemoTab.tsx` の `renderMarkdown` と揃える):
/// - `# 見出し1` / `## 見出し2` / `### 見出し3`
/// - `**bold**` / `*italic*`
/// - `- リスト項目`
/// - 改行 (= 段落区切り)
/// - `[link text](url)` ※ desktop 側は未対応のため iOS で書いても desktop ではリンク化されない
struct MemoTab: View {
    let grid: Grid
    let mandalart: Mandalart

    @State private var mode: Mode = .edit
    @FocusState private var isEditing: Bool

    enum Mode: String, CaseIterable, Identifiable {
        case edit = "編集"
        case preview = "プレビュー"
        var id: String { rawValue }
    }

    /// `grid.memo` の `String?` を `String` 双方向 Binding に変換 (TextEditor 用)。
    /// 空文字は nil 化して保存。SwiftData の `@Model` プロパティ直接 set なので
    /// realtime / auto-push の sync 経路で自然に反映される。
    private var memoBinding: Binding<String> {
        Binding(
            get: { grid.memo ?? "" },
            set: { newValue in
                guard !mandalart.locked else { return }
                let normalized: String? = newValue.isEmpty ? nil : newValue
                if grid.memo != normalized {
                    grid.memo = normalized
                    grid.updatedAt = Date()
                }
            }
        )
    }

    var body: some View {
        VStack(spacing: 8) {
            Picker("", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            switch mode {
            case .edit:
                editor
            case .preview:
                preview
            }
        }
    }

    private var editor: some View {
        TextEditor(text: memoBinding)
            .font(.callout)
            .scrollContentBackground(.hidden)
            .padding(8)
            .background(NeutralPalette.surfaceBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .focused($isEditing)
            .disabled(mandalart.locked)
    }

    private var preview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                let memoText = grid.memo ?? ""
                if memoText.isEmpty {
                    Text("(メモなし)")
                        .foregroundStyle(.secondary)
                } else {
                    let lines = memoText.components(separatedBy: "\n")
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        renderedLine(line)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
        .background(NeutralPalette.surfaceBackground)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    /// 1 行を Markdown として render。見出し / リスト / 通常段落で分岐、inline 装飾は
    /// `AttributedString(markdown:)` に委譲。空行は spacer として最小高で残す。
    @ViewBuilder
    private func renderedLine(_ line: String) -> some View {
        if line.hasPrefix("### ") {
            Text(inlineMarkdown(String(line.dropFirst(4))))
                .font(.subheadline.weight(.semibold))
                .padding(.top, 2)
        } else if line.hasPrefix("## ") {
            Text(inlineMarkdown(String(line.dropFirst(3))))
                .font(.body.weight(.semibold))
                .padding(.top, 4)
        } else if line.hasPrefix("# ") {
            Text(inlineMarkdown(String(line.dropFirst(2))))
                .font(.title3.weight(.bold))
                .padding(.top, 4)
        } else if line.hasPrefix("- ") {
            HStack(alignment: .top, spacing: 6) {
                Text("•").font(.callout)
                Text(inlineMarkdown(String(line.dropFirst(2)))).font(.callout)
            }
        } else if line.isEmpty {
            // 空行 = 段落区切り。1 行ぶんの spacer として最小高で残す
            Text(" ").font(.callout)
        } else {
            Text(inlineMarkdown(line)).font(.callout)
        }
    }

    /// 行内の inline 装飾 (太字 / italic / リンク等) を `AttributedString` に変換。
    /// パース失敗時は plain `AttributedString` にフォールバック。
    private func inlineMarkdown(_ text: String) -> AttributedString {
        if let attr = try? AttributedString(markdown: text) {
            return attr
        }
        return AttributedString(text)
    }
}
