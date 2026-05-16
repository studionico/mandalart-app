import SwiftUI

/// desktop の `ShredderIcon` ([`DragActionPanel.tsx`](../../../../desktop/src/components/editor/DragActionPanel.tsx))
/// を SwiftUI Path で移植したベクター描画。24×24 viewBox を仮想座標として
/// 受け取った frame に等倍スケールする (`.aspectRatio(1, contentMode: .fit)`)。
///
/// 上部の入紙トレー (rounded rect) + 排出スリット (水平線) + 細断紙 4 本
/// (高さの違う縦線) で「家庭用シュレッダー」を表現する。
/// 色は `foregroundStyle` の伝播 (= currentColor 等価) で外側から制御する想定。
struct ShredderIcon: View {
    /// SVG strokeWidth=2 (24pt 換算) ベース。`Label` の icon slot で `.imageScale` と
    /// 合わせて使うときは少し細めの 1.6 が見映え。
    var lineWidth: CGFloat = 1.6

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) / 24.0
            Path { p in
                // 入紙トレー: rect x=4 y=4 width=16 height=6 (rx=1)
                let tray = CGRect(x: 4 * s, y: 4 * s, width: 16 * s, height: 6 * s)
                p.addRoundedRect(in: tray, cornerSize: CGSize(width: s, height: s))

                // 排出スリット: 水平線 y=11、x=2..22
                p.move(to: CGPoint(x: 2 * s, y: 11 * s))
                p.addLine(to: CGPoint(x: 22 * s, y: 11 * s))

                // 細断紙 4 本 (x, y1, y2)
                let verticals: [(CGFloat, CGFloat, CGFloat)] = [
                    (6, 14, 20),
                    (10, 14, 18),
                    (14, 14, 20),
                    (18, 14, 17),
                ]
                for (x, y1, y2) in verticals {
                    p.move(to: CGPoint(x: x * s, y: y1 * s))
                    p.addLine(to: CGPoint(x: x * s, y: y2 * s))
                }
            }
            .stroke(style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

#Preview {
    HStack(spacing: 24) {
        ShredderIcon()
            .frame(width: 24, height: 24)
            .foregroundStyle(.red)
        ShredderIcon()
            .frame(width: 48, height: 48)
            .foregroundStyle(.primary)
        ShredderIcon(lineWidth: 2.4)
            .frame(width: 80, height: 80)
            .foregroundStyle(.blue)
    }
    .padding()
}
