import SwiftUI

/// EditorView の右ペイン上部に表示する階層パンくず (= 現在地マップアイコン列)。
/// 各アイテムをタップで `onNavigate(index)` が呼ばれて drill-up する。
///
/// 各項目はテキストではなく **3×3 ミニマップアイコン** で表す。アイコンはその階層で
/// 「展開したセルの position」を 1 マスだけ塗る:
///  - ルート (position = nil) は中心 (centerPosition) を塗る
///  - 以降の階層は親グリッドで展開した周辺セルの position を塗る
/// 横に並ぶと「ルート中心 → 展開した周辺 → …」という現在地の経路マップになる。
///
/// アイコンは小さく均一なので折りたたみはせず、全項目を chevron 区切りで横スクロール表示する。
/// 元のセルテキストは `.accessibilityLabel` に退避する。
struct Breadcrumb: View {
    let items: [BreadcrumbItem]
    let onNavigate: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    mapButton(item: item, index: index, isCurrent: index == items.count - 1)
                    if index < items.count - 1 {
                        chevron
                    }
                }
            }
        }
    }

    /// 1 つの breadcrumb マップアイコンボタン。`isCurrent` で末尾 (現在地) を強調表示。
    @ViewBuilder
    private func mapButton(item: BreadcrumbItem, index: Int, isCurrent: Bool) -> some View {
        Button {
            // 末尾 (= 現在地) は nav しても何も起きないが、UI は active 状態で残す
            if !isCurrent {
                onNavigate(index)
            }
        } label: {
            LocationMapIcon(position: item.position ?? GridConstants.centerPosition)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.label.isEmpty ? "(無題)" : item.label)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.footnote.weight(.bold))
            .foregroundStyle(.secondary)
    }
}

/// 現在地マップアイコン。1 つの正方形を縦 2 本・横 2 本の線で 3×3 に区切り、
/// その階層で「展開したセルの position」の 1 マスだけを塗りつぶす。
private struct LocationMapIcon: View {
    let position: Int

    private static let unit = LayoutConstants.locationMapCellSize
    private var side: CGFloat { Self.unit * CGFloat(GridConstants.gridSide) }

    var body: some View {
        let col = CGFloat(position % GridConstants.gridSide)
        let row = CGFloat(position / GridConstants.gridSide)
        Canvas { ctx, size in
            let u = Self.unit
            // 塗りつぶしセル
            let cell = CGRect(x: col * u, y: row * u, width: u, height: u)
            ctx.fill(Path(cell), with: .color(.primary))
            // 外枠 + 内側の区切り線 (縦 2 / 横 2)
            var grid = Path()
            grid.addRect(CGRect(x: 0.5, y: 0.5, width: size.width - 1, height: size.height - 1))
            for i in 1..<GridConstants.gridSide {
                let p = CGFloat(i) * u
                grid.move(to: CGPoint(x: p, y: 0))
                grid.addLine(to: CGPoint(x: p, y: size.height))
                grid.move(to: CGPoint(x: 0, y: p))
                grid.addLine(to: CGPoint(x: size.width, y: p))
            }
            ctx.stroke(grid, with: .color(.secondary), lineWidth: 1)
        }
        .frame(width: side, height: side)
    }
}

struct BreadcrumbItem: Identifiable, Hashable {
    let gridId: String
    let cellId: String?  // nil = root
    let label: String
    let position: Int?   // nil = root(中心), それ以外 = 展開した周辺セル position 0-8
    var id: String { gridId }
}
