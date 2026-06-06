import Foundation

/// vault フォルダモード (Phase 2) のピュア層が扱う型。
/// desktop [`src/lib/vault/types.ts`](../../../desktop/src/lib/vault/types.ts) の Swift 移植。
///
/// 設計方針: vault の各ファイルは **DB の行 (Grid / Cell / Mandalart row) を直接シリアライズ**する。
/// iOS の SwiftData `@Model` は ModelContext 管理下で自由に生成できないため、ピュア層は @Model に
/// 触れず、ここで定義する **プレーン `struct` 行型** (`VaultGrid` / `VaultCell` / `VaultMandalart`)
/// だけを扱う。@Model ↔ struct の詰め替えは将来の DB 統合 Stage の責務。
///
/// タイムスタンプ (`createdAt` / `updatedAt`) は desktop と同じく **ISO8601 文字列のまま** 保持する
/// (vault ファイルでは JSON 文字列として焼く)。SwiftData の `Date` との変換も DB 統合 Stage で行う。

/// vault モードの grid ファイル / mandalart ファイルの format 識別子 (desktop: `VAULT_FORMAT`)。
let vaultFormat = "md-mandalart-v1"

/// grid の種別ラベル (行から導出、可読性のために frontmatter に明示記録する)。
enum GridKind: String, Codable {
    case root
    case drilled
    case parallel
}

// MARK: - プレーン行型 (ピュア層が扱う in-memory 表現、@Model 非依存)

/// vault が扱う grid 行。desktop の plain `Grid` 型に相当 (vault が触る列のみ)。
struct VaultGrid: Equatable {
    var id: String
    var mandalartId: String
    var centerCellId: String
    var parentCellId: String?
    var sortOrder: Int
    var memo: String?
    var createdAt: String
    var updatedAt: String
}

/// vault が扱う cell 行。desktop の plain `Cell` 型に相当。
struct VaultCell: Equatable {
    var id: String
    var gridId: String
    var position: Int
    var text: String
    var imagePath: String?
    var color: String?
    var done: Bool
    var createdAt: String
    var updatedAt: String
}

/// vault が扱う mandalart 行。desktop の plain `Mandalart` 型に相当。
/// `userId` は local 専用概念で vault には焼かない (parse 時は "" 補完)。
struct VaultMandalart: Equatable {
    var id: String
    var userId: String
    var title: String
    var rootCellId: String
    var showCheckbox: Bool
    var lastGridId: String?
    var sortOrder: Int?
    var pinned: Bool
    var folderId: String?
    var locked: Bool
    var createdAt: String
    var updatedAt: String
}

// MARK: - frontmatter に焼く Serialized 型 (Codable, JSON 直列化対象)

/// grid ファイルの frontmatter に焼く grid 行 (mandalart_id / deleted_at は implied なので省く)。
/// プロパティ名は camelCase、JSON キーは `.convertToSnakeCase` で snake_case に変換する。
struct SerializedGrid: Codable {
    var id: String
    var centerCellId: String
    var parentCellId: String?
    var sortOrder: Int
    var memo: String?
    var kind: GridKind
    var createdAt: String
    var updatedAt: String
}

/// grid ファイルの frontmatter に焼く cell 行 (grid_id / deleted_at は implied なので省く)。
struct SerializedCell: Codable {
    var id: String
    var position: Int
    var text: String
    var imagePath: String?
    var color: String?
    var done: Bool
    var createdAt: String
    var updatedAt: String
}

/// `_mandalart.md` の frontmatter に焼く mandalart 行。
/// 省くもの: user_id / image_path / folder_id / deleted_at に加え、`last_grid_id` も除外する
/// (= どのサブグリッドを最後に開いたかは端末ローカルの UI 状態で、ナビゲーションのたびに値が動き
/// `_mandalart.md` を churn させるため。import 時は nil 復元)。
struct SerializedMandalart: Codable {
    var id: String
    var title: String
    var rootCellId: String
    var showCheckbox: Bool
    var sortOrder: Int?
    var pinned: Bool
    var locked: Bool
    var createdAt: String
    var updatedAt: String
}

// MARK: - vault ファイル / マンダラート単位の入出力

/// vault 内の 1 ファイル (path はマンダラートフォルダからの相対)。
struct VaultFile: Equatable {
    /// 例: `_mandalart.md` / `<gridId>.md`
    var path: String
    var content: String
}

/// 1 マンダラート分の vault ファイル群。
struct MandalartVaultFiles {
    /// マンダラートフォルダ名 (表示用、真の id は中身の frontmatter)。例: `健康-a1b2c3`
    var dirName: String
    var files: [VaultFile]
}

/// 1 マンダラート分の DB 行 (ピュア変換の入出力)。folder は id ではなく **name** で持つ
/// (vault は portable な folder_name を正とし、folder_id はキャッシュ再構築時に caller が解決する)。
struct MandalartRows {
    var mandalart: VaultMandalart
    /// mandalart.folderId が指すフォルダ名 (vault に書く portable な分類ラベル)。
    var folderName: String
    var grids: [VaultGrid]
    var cells: [VaultCell]
}
