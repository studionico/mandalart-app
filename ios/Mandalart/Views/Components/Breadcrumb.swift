import SwiftUI

/// EditorView の右ペイン上部に表示する階層パンくずリスト。
/// 各アイテムをタップで `onNavigate(index)` が呼ばれて drill-up する。
struct Breadcrumb: View {
    let items: [BreadcrumbItem]
    let onNavigate: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    Button {
                        // 末尾 (= 現在地) は nav しても何も起きないが、UI は active 状態で残す
                        if index < items.count - 1 {
                            onNavigate(index)
                        }
                    } label: {
                        Text(item.label.isEmpty ? "(無題)" : item.label)
                            .font(index == items.count - 1 ? .headline : .subheadline)
                            .foregroundStyle(index == items.count - 1 ? .primary : .secondary)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    if index < items.count - 1 {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

struct BreadcrumbItem: Identifiable, Hashable {
    let gridId: String
    let cellId: String?  // nil = root
    let label: String
    var id: String { gridId }
}
