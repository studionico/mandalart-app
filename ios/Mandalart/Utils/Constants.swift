import Foundation

enum GridConstants {
    /// 3×3 / 9×9 グリッドの一辺の長さ (= 3)。
    static let gridSide: Int = 3
    /// 1 グリッドあたりのセル数 (= 9 = gridSide * gridSide)。
    static let gridCellCount: Int = gridSide * gridSide
    /// 中心セルの position (= 4)。
    static let centerPosition: Int = 4
    static let orbitOrder: [Int] = [0, 1, 2, 5, 8, 7, 6, 3]
    /// Tab 移動順 (中央 → 周辺時計回り)。desktop の [`TAB_ORDER`](../../../desktop/src/constants/tabOrder.ts) と同じ。
    /// 中心 4 から始まり時計回りに外周を一周。export / import の周辺セル配置順 (= 中心を除いた配列) も
    /// この順を使い、エクスポート → インポートの round-trip でセル位置が保たれる。
    static let tabOrder: [Int] = [4, 7, 6, 3, 0, 1, 2, 5, 8]
    /// `tabOrder` から中心を除いた配列 (= 7, 6, 3, 0, 1, 2, 5, 8)。
    /// インポート時に Markdown / IndentText の子ノードをこの順で周辺セルに配置する。
    static let peripheralPositionsByTab: [Int] = [7, 6, 3, 0, 1, 2, 5, 8]
}

enum LayoutConstants {
    static let outerGridGap: CGFloat = 8
    static let cellBaseFontSize: CGFloat = 14
    /// 9×9 view 内 inner cell のベース font (= 3×3 base ÷ gridSide)。
    /// desktop の `CELL_BASE_FONT_PX / GRID_SIDE` ミラー。
    static let cellNineByNineFontSize: CGFloat = cellBaseFontSize / CGFloat(GridConstants.gridSide)
    static let dashboardCardSize: CGFloat = 160
    /// セル / カードの cornerRadius・border は **desktop の規則を canonical** とし、iOS pt にスケールして揃える。
    /// desktop の 28px font に対して中心 6px border (= 0.21 ratio) を、iOS の 14pt 中心 font で同 ratio に維持。
    /// 詳細: [`/Users/maro02/.claude/plans/ios-swift-glistening-thacker.md`](../../../.claude/plans/ios-swift-glistening-thacker.md) Plan A。
    static let cellCornerRadius: CGFloat = 8
    /// `.strokeBorder` (= 内側塗り) に渡す中心セル枠の visible 太さ。
    /// 旧 `.stroke + clipShape` で外側半分が clip されて visible 1.5pt だった見た目を維持するため、
    /// 描画方式を `.strokeBorder` に切替えるのに合わせて値も 3 → 1.5 に半減 (= clip で削られる分を最初から描かない)。
    static let cellCenterBorder: CGFloat = 1.5
    static let cellPeripheralBorder: CGFloat = 0.5
    /// 周辺セル + 子グリッドあり (= drill 元として既に展開済) の border 太さ。子の存在を視覚提示。
    static let cellPeripheralWithChildBorder: CGFloat = 1.5
    /// 9×9 view 内の inner cell border (= 縮小表示で hairline は薄すぎるため 1pt 据え置き)。
    static let cellNineByNineInnerBorder: CGFloat = 1
    static let cardCornerRadius: CGFloat = 4
    /// Dashboard 右 aside (StockTab) の固定幅。
    /// iPad regular size class では default で開き、iPhone Landscape では default 折り畳み。
    /// LazyVGrid `.adaptive` minimum がこの幅引いた viewport で再計算される。
    static let dashboardStockAsideWidth: CGFloat = 280
    /// 現在地マップアイコン (パンくず置換) の 1 マスの一辺 (pt)。3×3 で全体 ~24pt 角。
    static let locationMapCellSize: CGFloat = 7

    // MARK: - PNG/PDF Export (現在表示中の 3×3 グリッドを画面と同じ比率で off-screen レンダリング)
    /// export 画像の grid 周囲の余白 (pt、画面の grid サイズに対して適用)。
    static let exportImagePadding: CGFloat = 24
    /// export レンダリング倍率 (解像度のみ。比率は画面の grid サイズに一致させるので scale は鮮明さ用)。
    static let exportImageScale: CGFloat = 3
}

enum TimingConstants {
    static let animStaggerMs: Int = 50
    static let animFadeMs: Int = 200
    static let convergeDurationMs: Int = 600
}

/// 文字サイズ調整 (desktop editorStore.ts ミラー)。
/// fontScale = 1.1^fontLevel。-10 で約 39%、0 で 100%、+20 で約 673%。
/// 永続化スコープは per-mandalart × per-device (`MandalartFontPreference` 経由)。
enum FontConstants {
    static let levelMin: Int = -10
    static let levelMax: Int = 20
    static let levelDefault: Int = 0
    static let stepFactor: Double = 1.1
    /// 旧グローバル文字サイズキー。per-mandalart 移行後は **新規書き込み禁止**、
    /// `MandalartFontPreference.load(for:)` の fallback (= 既存ユーザーが調整した値を
    /// 全マンダラートのデフォルトに引き継ぐ) としてのみ参照する。
    static let levelStorageKey: String = "mandalart.fontLevel"

    static func scale(for level: Int) -> CGFloat {
        CGFloat(pow(stepFactor, Double(level)))
    }
}

/// マンダラート単位の文字サイズ設定 (端末単位 UserDefaults)。
/// キー形式: `mandalart.fontLevel.<mandalartId>`。
/// per-mandalart キー未設定時は旧 global key を fallback (= 全マンダラートのデフォルト引き継ぎ)。
/// cross-device 同期はしない。desktop の `editorStore.ts` も同じ key prefix で per-mandalart 化されており設計対称。
enum MandalartFontPreference {
    static func key(for mandalartId: String) -> String {
        "mandalart.fontLevel.\(mandalartId)"
    }

    static func load(for mandalartId: String) -> Int {
        let defaults = UserDefaults.standard
        let perMandalart = defaults.object(forKey: key(for: mandalartId)) as? Int
        let legacy = defaults.object(forKey: FontConstants.levelStorageKey) as? Int
        let raw = perMandalart ?? legacy ?? FontConstants.levelDefault
        return min(FontConstants.levelMax, max(FontConstants.levelMin, raw))
    }

    static func save(_ level: Int, for mandalartId: String) {
        UserDefaults.standard.set(level, forKey: key(for: mandalartId))
    }
}
