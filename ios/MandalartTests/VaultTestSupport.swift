import Foundation

// 注: Vault/*.swift と Utils/Constants.swift は MandalartTests ターゲットへ直接コンパイルされる
// (app ターゲット = Supabase リンクに依存させない)。よって `@testable import Mandalart` は不要で、
// VaultGrid / GridConstants 等のシンボルは同一テストモジュール内に存在する。

/// vault ピュア層テスト用の共有フィクスチャ。
/// desktop `__tests__/vaultModel.test.ts` の `cell()` / `grid()` / `sampleRows()` に対応。

let TS = "2026-06-02T00:00:00.000Z"

func makeCell(
    _ id: String,
    _ gridId: String,
    _ position: Int,
    text: String = "",
    imagePath: String? = nil,
    color: String? = nil,
    done: Bool = false,
    createdAt: String = TS,
    updatedAt: String = TS
) -> VaultCell {
    VaultCell(
        id: id, gridId: gridId, position: position, text: text, imagePath: imagePath,
        color: color, done: done, createdAt: createdAt, updatedAt: updatedAt
    )
}

func makeGrid(
    _ id: String,
    centerCellId: String,
    parentCellId: String? = nil,
    sortOrder: Int = 0,
    memo: String? = nil,
    mandalartId: String = "m-1",
    createdAt: String = TS,
    updatedAt: String = TS
) -> VaultGrid {
    VaultGrid(
        id: id, mandalartId: mandalartId, centerCellId: centerCellId, parentCellId: parentCellId,
        sortOrder: sortOrder, memo: memo, createdAt: createdAt, updatedAt: updatedAt
    )
}

/// root + drilled(X=C) + 並列 + lazy(空セル省略) を含む realistic な 1 マンダラート。
func sampleRows() -> MandalartRows {
    let mandalart = VaultMandalart(
        id: "m-1",
        userId: "",
        title: "健康 / 2026",
        rootCellId: "c-root-center",
        showCheckbox: true,
        lastGridId: "g-drill",
        sortOrder: 3,
        pinned: true,
        folderId: "folder-xyz",
        locked: false,
        createdAt: TS,
        updatedAt: "2026-06-02T01:00:00.000Z"
    )
    let grids: [VaultGrid] = [
        makeGrid("g-root", centerCellId: "c-root-center", parentCellId: nil, sortOrder: 0,
                 memo: "ルートのメモ\n複数行 \"引用\" : #"),
        makeGrid("g-drill", centerCellId: "c-root-p2", parentCellId: "c-root-p2", sortOrder: 0),
        makeGrid("g-par", centerCellId: "c-par-center", parentCellId: nil, sortOrder: 1),
    ]
    let cells: [VaultCell] = [
        // root grid: 中心 + 周辺 2 つ (他は lazy で省略)
        makeCell("c-root-center", "g-root", 4, text: "健康", color: "red-100", done: true),
        makeCell("c-root-p2", "g-root", 2, text: "運動", imagePath: "images/c-root-p2-1.jpg"),
        makeCell("c-root-p0", "g-root", 0, text: "食事"),
        // drilled grid (X=C): 自グリッドに中心行は持たない、周辺のみ
        makeCell("c-drill-p1", "g-drill", 1, text: "筋トレ", done: true),
        // 並列 grid: 独立中心 + 周辺
        makeCell("c-par-center", "g-par", 4, text: "健康(並列)"),
        makeCell("c-par-p3", "g-par", 3, text: "睡眠", color: "blue-100"),
    ]
    return MandalartRows(mandalart: mandalart, folderName: "Inbox", grids: grids, cells: cells)
}

func sortedById<T>(_ arr: [T], _ id: (T) -> String) -> [T] {
    arr.sorted { id($0) < id($1) }
}

// MARK: - I/O テスト用 (Stage I/O)

/// ユニークな temp ディレクトリを作成して返す (呼び出し側が tearDown で削除)。
func makeUniqueTempDir() -> URL {
    let url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        .appendingPathComponent("vaulttest-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// temp ディレクトリを削除 (best-effort)。
func removeTempDir(_ url: URL) {
    try? FileManager.default.removeItem(at: url)
}
