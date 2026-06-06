import SwiftUI
import SwiftData
import UIKit

/// 現在表示中の 3×3 グリッドを off-screen で PNG / PDF にラスタライズする (Phase 8 PNG/PDF Export)。
///
/// **画面で見ているまま**を出力するのが目的: 画面の grid 一辺 (`size`) と同じサイズ・比率でレンダリングし
/// (= フォントとセルの相対比が画面と一致)、現在のテーマ (`colorScheme`) と editor 背景 (`NeutralPalette.rootBackground`) を
/// そのまま使う。`scale` で解像度だけ上げる。固定サイズ + light/白固定にするとフォントが極小・配色が別物になり乖離する。
///
/// 既知の制約: クラウドのみ存在する画像は off-screen で `.task` download が走らないため空白になる
/// (ローカル画像は `ImageStorage.loadImage` が同期ロードなので写る)。
@MainActor
enum MandalartImageRenderer {

    enum RenderError: LocalizedError {
        case rootGridNotFound(String)
        case rasterizationFailed
        var errorDescription: String? {
            switch self {
            case .rootGridNotFound(let id): return "Mandalart \(id) の root grid が見つかりません"
            case .rasterizationFailed: return "画像のレンダリングに失敗しました"
            }
        }
    }

    // MARK: - 9×9 全体ボード (iPad 9×9 表示のエクスポート)

    static func renderNineByNinePNG(
        mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> Data {
        let image = try nineByNineImage(mandalart: mandalart, size: size, in: context)
        guard let png = image.pngData() else { throw RenderError.rasterizationFailed }
        return png
    }

    static func renderNineByNinePDF(
        mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> Data {
        let image = try nineByNineImage(mandalart: mandalart, size: size, in: context)
        let pageSize = CGSize(width: image.size.width / image.scale, height: image.size.height / image.scale)
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
        return renderer.pdfData { ctx in
            ctx.beginPage()
            image.draw(in: CGRect(origin: .zero, size: pageSize))
        }
    }

    private static func nineByNineImage(
        mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> UIImage {
        let root = try rootGrid(for: mandalart, in: context)
        let layout = GridRepository.loadNineByNineLayout(rootGrid: root, in: context)
        let board = GridView9x9(layout: layout, mandalart: mandalart)
        return try rasterize(board, mandalart: mandalart, size: size, in: context)
    }

    private static func rootGrid(for mandalart: Mandalart, in context: ModelContext) throws -> Grid {
        let mid = mandalart.id
        let rootCellId = mandalart.rootCellId
        let descriptor = FetchDescriptor<Grid>(
            predicate: #Predicate<Grid> { $0.mandalartId == mid && $0.parentCellId == nil && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\Grid.sortOrder), SortDescriptor(\Grid.createdAt)]
        )
        let roots = (try? context.fetch(descriptor)) ?? []
        if let primary = roots.first(where: { $0.centerCellId == rootCellId }) { return primary }
        guard let first = roots.first else { throw RenderError.rootGridNotFound(mid) }
        return first
    }

    /// 現在表示中の 3×3 グリッドを PNG にする。`size` は画面の grid 一辺 (pt)。保存は常にライト固定。
    static func renderGridPNG(
        grid: Grid, mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> Data {
        let image = try gridImage(grid: grid, mandalart: mandalart, size: size, in: context)
        guard let png = image.pngData() else { throw RenderError.rasterizationFailed }
        return png
    }

    /// 現在表示中の 3×3 グリッドを単一ページ PDF にする (画像を 1 ページに内包、page size = 画像/scale の論理 pt)。
    static func renderGridPDF(
        grid: Grid, mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> Data {
        let image = try gridImage(grid: grid, mandalart: mandalart, size: size, in: context)
        let pageSize = CGSize(width: image.size.width / image.scale, height: image.size.height / image.scale)
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
        return renderer.pdfData { ctx in
            ctx.beginPage()
            image.draw(in: CGRect(origin: .zero, size: pageSize))
        }
    }

    // MARK: - core

    private static func gridImage(
        grid: Grid, mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> UIImage {
        let cells = GridRepository.displayCells(for: grid, in: context)
        let mask = GridRepository.hasChildMaskForGrid(displayCells: cells, in: context)
        // readOnly: false で画面の 3×3 と同じフォント (base 14pt) / 枠線にする。readOnly:true は 9×9 用の
        // 1/3 フォント (14/3) になり文字が極端に小さくなる。ImageRenderer は静的描画なので tap は発火しない。
        let board = GridView3x3(
            gridId: grid.id,
            displayCells: cells,
            mandalart: mandalart,
            transitionKind: .initial,
            readOnly: false,
            hasChildAtPosition: mask
        )
        return try rasterize(board, mandalart: mandalart, size: size, in: context)
    }

    /// グリッドビューを画面と同じ一辺 `size` でラスタライズ (= セル:文字比が画面どおり)。
    /// テーマは **ダークでも常にライト固定** (印刷/共有向け、ユーザー指定)。`scale` は解像度のみ。
    private static func rasterize<V: View>(
        _ board: V, mandalart: Mandalart, size: CGFloat, in context: ModelContext
    ) throws -> UIImage {
        let fontScale = FontConstants.scale(for: MandalartFontPreference.load(for: mandalart.id))
        let content = board
            .frame(width: size, height: size)
            .padding(LayoutConstants.exportImagePadding)
            .background(NeutralPalette.rootBackground)        // ライト解決で editor root と同じ淡色背景
            .environment(\.colorScheme, .light)               // 常にライトで保存
            .environment(\.modelContext, context)
            .environment(\.cellFontScale, fontScale)
        let renderer = ImageRenderer(content: content)
        renderer.scale = LayoutConstants.exportImageScale
        guard let image = renderer.uiImage else { throw RenderError.rasterizationFailed }
        return image
    }
}
