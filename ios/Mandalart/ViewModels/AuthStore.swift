import Foundation
import Supabase

@Observable
@MainActor
final class AuthStore {
    var session: Session?
    var isLoading: Bool = false
    var lastError: String?

    var isSignedIn: Bool { session != nil }
    var userEmail: String? { session?.user.email }

    private let client = SupabaseService.shared.client

    func bootstrap() async {
        do {
            self.session = try await client.auth.session
        } catch {
            self.session = nil
        }
        Task { await listenForChanges() }
    }

    private func listenForChanges() async {
        for await change in client.auth.authStateChanges {
            self.session = change.session
        }
    }

    func signInWithEmail(_ email: String, password: String) async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let res = try await client.auth.signIn(email: email, password: password)
            self.session = res
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func signUpWithEmail(_ email: String, password: String) async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            _ = try await client.auth.signUp(email: email, password: password)
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func signOut() async {
        do {
            try await client.auth.signOut()
            self.session = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }
}
