import SwiftUI

struct SignInView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var mode: Mode = .signIn

    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "サインイン"
        case signUp = "新規登録"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
                Section("メール") {
                    TextField("you@example.com", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("パスワード", text: $password)
                }
                if let err = auth.lastError {
                    Section { Text(err).foregroundStyle(.red).font(.caption) }
                }
                Section {
                    Button {
                        Task {
                            switch mode {
                            case .signIn: await auth.signInWithEmail(email, password: password)
                            case .signUp: await auth.signUpWithEmail(email, password: password)
                            }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if auth.isLoading {
                                ProgressView()
                            } else {
                                Text(mode.rawValue).bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(email.isEmpty || password.isEmpty || auth.isLoading)
                }
                Section {
                    Text("ローカル保存のみで使う場合はサインインなしでもアプリは動きます。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("アカウント")
        }
    }
}
