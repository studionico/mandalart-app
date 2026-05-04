import Foundation
import Supabase

/// Wrapper around the Supabase Swift client. One shared instance for the app.
/// Uses the same Supabase project as the desktop version (via Secrets.swift).
final class SupabaseService {
    static let shared = SupabaseService()

    let client: SupabaseClient

    private init() {
        self.client = SupabaseClient(
            supabaseURL: Secrets.supabaseURL,
            supabaseKey: Secrets.supabaseAnonKey
        )
    }
}
