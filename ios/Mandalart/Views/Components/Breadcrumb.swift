import SwiftUI

/// EditorView の右ペイン上部に表示する階層パンくずリスト。
/// 各アイテムをタップで `onNavigate(index)` が呼ばれて drill-up する。
///
/// **3 階層以下**: 全項目を chevron 区切りで横並び表示。
/// **4 階層以上**: `[root] > [...] menu > [N-1] > [N]` の 5 要素 (= 4 文 + 3 chevron) に折りたたみ、
/// `[...]` をタップすると Menu で省略中間階層 (index 1〜N-3) を一覧表示、選択で drill-up。
///
/// 各 label は `lineLimit(1)` + `truncationMode(.tail)` + `frame(maxWidth: 120)` で個別 truncate。
/// 長いセル文字でも右ペイン (240pt) に収まる。
struct Breadcrumb: View {
    let items: [BreadcrumbItem]
    let onNavigate: (Int) -> Void

    /// label の最大幅 (pt)。iPhone Pro Landscape の memoW=240 から逆算 (root + chevron + ... +
    /// chevron + 末尾 2 項 + chevron = ~120pt 余裕)。実機で testing して微調整可。
    private static let labelMaxWidth: CGFloat = 120

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                if items.count <= 3 {
                    // 3 階層以下: 全項目を従来通り表示
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        labelButton(item: item, index: index, isCurrent: index == items.count - 1)
                        if index < items.count - 1 {
                            chevron
                        }
                    }
                } else {
                    // 4 階層以上: root + Menu(...) + 末尾 2 項 に折りたたみ
                    let rootIndex = 0
                    let lastIndex = items.count - 1
                    let secondLastIndex = items.count - 2
                    let middleRange = 1..<(items.count - 2)  // Menu に格納する index 群

                    labelButton(item: items[rootIndex], index: rootIndex, isCurrent: false)
                    chevron
                    middleMenu(middleRange: middleRange)
                    chevron
                    labelButton(item: items[secondLastIndex], index: secondLastIndex, isCurrent: false)
                    chevron
                    labelButton(item: items[lastIndex], index: lastIndex, isCurrent: true)
                }
            }
        }
    }

    /// 1 つの breadcrumb ラベルボタン。`isCurrent` で末尾 (現在地) を強調表示。
    @ViewBuilder
    private func labelButton(item: BreadcrumbItem, index: Int, isCurrent: Bool) -> some View {
        Button {
            // 末尾 (= 現在地) は nav しても何も起きないが、UI は active 状態で残す
            if !isCurrent {
                onNavigate(index)
            }
        } label: {
            Text(item.label.isEmpty ? "(無題)" : item.label)
                .font(isCurrent ? .headline : .subheadline)
                .foregroundStyle(isCurrent ? .primary : .secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: Self.labelMaxWidth, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    /// 折りたたまれた中間階層 (= index 1〜N-3) を Menu で展開するボタン。
    /// label は `…` アイコン、選択で `onNavigate(originalIndex)` 呼び出し。
    @ViewBuilder
    private func middleMenu(middleRange: Range<Int>) -> some View {
        Menu {
            ForEach(middleRange, id: \.self) { index in
                Button {
                    onNavigate(index)
                } label: {
                    Text(items[index].label.isEmpty ? "(無題)" : items[index].label)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minWidth: 28, minHeight: 24)
        }
        .accessibilityLabel("省略された中間階層を表示")
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.caption2)
            .foregroundStyle(.tertiary)
    }
}

struct BreadcrumbItem: Identifiable, Hashable {
    let gridId: String
    let cellId: String?  // nil = root
    let label: String
    var id: String { gridId }
}
