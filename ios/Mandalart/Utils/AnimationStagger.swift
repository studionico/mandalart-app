import Foundation

/// drill / drill-up / 並列ナビ時の orbit-style stagger fade-in 順序。
///
/// desktop ([`../../desktop/docs/animations.md`](../../desktop/docs/animations.md)) と同じ
/// 時計回り順序を採用。`Constants.swift` の `TimingConstants.animStaggerMs` / `animFadeMs` と
/// 組み合わせて、各 cell の opacity 補間に delay を与える。
enum DrillTransitionKind: Equatable {
    /// EditorView 起動直後 (= root grid を最初に表示するとき)。中心 → 周辺の時計回り。
    case initial
    /// 周辺セル tap → 子グリッド表示。中心 (= 親 peripheral と X=C 共有) は連続なので除外、周辺 8 のみ。
    case drillDown
    /// breadcrumb → 親グリッド表示。中心も新規 fade-in が必要 (= X=C は連続だが視覚的に揃える)。周辺先 + 中心最後。
    case drillUp
    /// 並列ナビ (← / → / +)。9 セル全て新規 fade-in (中心 → 周辺時計回り)。
    case parallel
}

enum AnimationStagger {
    /// position (0-8) を該当 transition の stagger 順序内 index に変換する。
    /// 該当 transition で fade-in しないセル (= drillDown の中心 position=4) は nil を返す。
    static func staggerIndex(for position: Int, kind: DrillTransitionKind) -> Int? {
        sequence(for: kind).firstIndex(of: position)
    }

    /// position (0-8) と transition から、`onAppear` 時 `.delay(...)` に渡す秒数を計算する。
    /// `staggerIndex` が nil (= drill-down 中心など) の場合は 0 を返す (即座表示)。
    static func delay(for position: Int, kind: DrillTransitionKind) -> Double {
        guard let idx = staggerIndex(for: position, kind: kind) else { return 0 }
        return Double(idx) * Double(TimingConstants.animStaggerMs) / 1000.0
    }

    /// transition 種別ごとの fade-in 順序。先頭から `animStaggerMs` 間隔で順次 visible=true に切替。
    private static func sequence(for kind: DrillTransitionKind) -> [Int] {
        switch kind {
        case .initial, .parallel:
            // 中心 → 時計回り (S → SW → W → NW → N → NE → E → SE)
            return [4, 7, 6, 3, 0, 1, 2, 5, 8]
        case .drillDown:
            // 中心は親 peripheral と X=C 共有なので fade-in 不要、周辺 8 のみ時計回り
            return [7, 6, 3, 0, 1, 2, 5, 8]
        case .drillUp:
            // 周辺 8 + 中心最後 (= 中心が「戻ってくる」感を出す)
            return [7, 6, 3, 0, 1, 2, 5, 8, 4]
        }
    }
}
