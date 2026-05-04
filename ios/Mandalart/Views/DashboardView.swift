import SwiftUI
import SwiftData

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AuthStore.self) private var auth

    @Query(filter: #Predicate<Mandalart> { $0.deletedAt == nil })
    private var mandalartsRaw: [Mandalart]

    @Query(filter: #Predicate<Folder> { $0.deletedAt == nil })
    private var foldersRaw: [Folder]

    @State private var selectedFolderId: String?
    @State private var query: String = ""
    @State private var showSettings = false

    @State private var showAddFolder = false
    @State private var newFolderName: String = ""

    @State private var renameTarget: Folder?
    @State private var renameInput: String = ""

    let onOpenMandalart: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 12)]

    /// 並び順: Inbox (isSystem) を先頭に固定 → sortOrder ASC → createdAt ASC
    private var sortedFolders: [Folder] {
        foldersRaw.sorted { lhs, rhs in
            if lhs.isSystem != rhs.isSystem { return lhs.isSystem }
            if lhs.sortOrder != rhs.sortOrder { return lhs.sortOrder < rhs.sortOrder }
            return lhs.createdAt < rhs.createdAt
        }
    }

    /// 並び順 (Phase 4 phase 2 と同じ): pinned DESC → sortOrder ASC (nil 後ろ) → createdAt DESC
    private func sortedMandalarts(in folderId: String?) -> [Mandalart] {
        mandalartsRaw
            .filter { folderId == nil || $0.folderId == folderId }
            .sorted { lhs, rhs in
                if lhs.pinned != rhs.pinned { return lhs.pinned }
                switch (lhs.sortOrder, rhs.sortOrder) {
                case let (a?, b?) where a != b: return a < b
                case (_?, nil): return true
                case (nil, _?): return false
                default: break
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    /// 検索中は全 folder 横断、空のときは選択中 folder のみ (desktop と同等)。
    private var visibleMandalarts: [Mandalart] {
        if !query.isEmpty {
            let lower = query.lowercased()
            return sortedMandalarts(in: nil).filter { $0.title.lowercased().contains(lower) }
        }
        return sortedMandalarts(in: selectedFolderId)
    }

    var body: some View {
        NavigationStack {
            mainGrid
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, placement: .toolbar, prompt: "検索")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: {
                        Image(systemName: auth.isSignedIn ? "person.crop.circle.fill" : "person.crop.circle")
                    }
                }
                // 人アイコン横の空きスペースに folder tab を配置 (= 縦スペース節約)
                ToolbarItem(placement: .principal) {
                    folderTabBar
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        try? MandalartFactory.create(
                            title: "新規マンダラート",
                            folderId: selectedFolderId,
                            in: modelContext
                        )
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView().environment(auth)
            }
            .sheet(isPresented: $showAddFolder) {
                FolderNameSheet(
                    title: "新規フォルダ",
                    name: $newFolderName,
                    confirmLabel: "追加",
                    onConfirm: { addFolder() }
                )
                .presentationDetents([.height(200)])
            }
            .sheet(
                isPresented: Binding(
                    get: { renameTarget != nil },
                    set: { if !$0 { renameTarget = nil } }
                )
            ) {
                FolderNameSheet(
                    title: "フォルダ名を変更",
                    name: $renameInput,
                    confirmLabel: "保存",
                    onConfirm: { commitRename() }
                )
                .presentationDetents([.height(200)])
            }
        }
        .onAppear { initSelectedFolder() }
        .onChange(of: foldersRaw.count) { _, _ in initSelectedFolder() }
    }

    // MARK: - Folder tab bar (toolbar principal slot)

    private var folderTabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(sortedFolders) { folder in
                    folderTab(folder)
                }
                Button {
                    newFolderName = ""
                    showAddFolder = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func folderTab(_ folder: Folder) -> some View {
        let isSelected = folder.id == selectedFolderId
        let count = mandalartsRaw.filter { $0.folderId == folder.id && $0.deletedAt == nil }.count
        HStack(spacing: 4) {
            Image(systemName: folder.isSystem ? "tray.fill" : "folder.fill")
                .font(.caption2)
            Text(folder.name)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .lineLimit(1)
            if count > 0 {
                Text("\(count)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .foregroundStyle(isSelected ? Color.primary : Color.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(isSelected ? Color.primary.opacity(0.12) : Color.clear)
        )
        .contentShape(Capsule())
        .onTapGesture { selectedFolderId = folder.id }
        .contextMenu { folderContextMenu(for: folder) }
    }

    @ViewBuilder
    private func folderContextMenu(for folder: Folder) -> some View {
        Button {
            renameInput = folder.name
            renameTarget = folder
        } label: {
            Label("名前変更", systemImage: "pencil")
        }

        if !folder.isSystem {
            Button(role: .destructive) {
                try? FolderRepository.deleteFolder(folder, in: modelContext)
                if selectedFolderId == folder.id {
                    selectedFolderId = sortedFolders.first(where: { $0.isSystem })?.id
                }
            } label: {
                Label("削除 (中身を Inbox へ)", systemImage: "trash")
            }
        }
    }

    // MARK: - Main grid

    private var mainGrid: some View {
        ScrollView {
            if visibleMandalarts.isEmpty {
                emptyState
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(visibleMandalarts) { m in
                        MandalartCard(mandalart: m)
                            .onTapGesture { onOpenMandalart(m.id) }
                            .contextMenu { mandalartContextMenu(for: m) }
                    }
                }
                .padding(12)
            }
        }
    }

    @ViewBuilder
    private func mandalartContextMenu(for m: Mandalart) -> some View {
        Button {
            m.pinned.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(m.pinned ? "ピン留めを外す" : "ピン留め",
                  systemImage: m.pinned ? "pin.slash" : "pin")
        }

        Button {
            m.locked.toggle()
            m.updatedAt = Date()
            try? modelContext.save()
        } label: {
            Label(m.locked ? "ロックを外す" : "ロック",
                  systemImage: m.locked ? "lock.open" : "lock")
        }

        Button {
            try? MandalartFactory.duplicate(m, in: modelContext)
        } label: {
            Label("複製", systemImage: "doc.on.doc")
        }

        Menu {
            ForEach(sortedFolders) { folder in
                Button {
                    m.folderId = folder.id
                    m.updatedAt = Date()
                    try? modelContext.save()
                } label: {
                    HStack {
                        if folder.id == m.folderId {
                            Image(systemName: "checkmark")
                        }
                        Text(folder.name)
                    }
                }
            }
        } label: {
            Label("フォルダ移動", systemImage: "folder")
        }

        Divider()

        Button(role: .destructive) {
            Task { try? await MandalartFactory.permanentDelete(m, in: modelContext) }
        } label: {
            Label("削除", systemImage: "trash")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.3x3")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            if !query.isEmpty {
                Text("「\(query)」に一致するマンダラートはありません")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if let folder = sortedFolders.first(where: { $0.id == selectedFolderId }) {
                Text("\(folder.name) は空です")
                    .foregroundStyle(.secondary)
                Button("新規作成") {
                    try? MandalartFactory.create(
                        title: "新規マンダラート",
                        folderId: selectedFolderId,
                        in: modelContext
                    )
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
            } else {
                Text("マンダラートがありません")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 60)
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Actions

    private func initSelectedFolder() {
        let hasSelected = selectedFolderId != nil &&
            sortedFolders.contains(where: { $0.id == selectedFolderId })
        if !hasSelected {
            selectedFolderId = sortedFolders.first(where: { $0.isSystem })?.id
                ?? sortedFolders.first?.id
        }
    }

    private func addFolder() {
        let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            newFolderName = ""
            return
        }
        do {
            let folder = try FolderRepository.createFolder(name: name, in: modelContext)
            selectedFolderId = folder.id
        } catch {
            print("[dashboard] createFolder failed:", error)
        }
        newFolderName = ""
    }

    private func commitRename() {
        guard let target = renameTarget else { return }
        do {
            try FolderRepository.renameFolder(target, to: renameInput, in: modelContext)
        } catch {
            print("[dashboard] renameFolder failed:", error)
        }
        renameTarget = nil
        renameInput = ""
    }
}

// MARK: - FolderNameSheet (日本語 IME 動作のため alert ではなく sheet ベース)

private struct FolderNameSheet: View {
    let title: String
    @Binding var name: String
    let confirmLabel: String
    let onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("フォルダ名", text: $name)
                    .focused($isFocused)
                    .submitLabel(.done)
                    .onSubmit {
                        if !trimmedName.isEmpty { confirm() }
                    }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(confirmLabel) { confirm() }
                        .disabled(trimmedName.isEmpty)
                }
            }
        }
        .onAppear { isFocused = true }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func confirm() {
        onConfirm()
        dismiss()
    }
}

private struct MandalartCard: View {
    let mandalart: Mandalart

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(uiColor: .secondarySystemBackground))
                .aspectRatio(1, contentMode: .fit)
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 4) {
                        if mandalart.pinned {
                            Image(systemName: "pin.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if mandalart.locked {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(6)
                }
                .overlay(
                    Text(mandalart.title)
                        .font(.system(size: 14, weight: .medium))
                        .multilineTextAlignment(.center)
                        .padding(8)
                        .foregroundStyle(.primary)
                )
            Text(mandalart.updatedAt.formatted(.relative(presentation: .named)))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
