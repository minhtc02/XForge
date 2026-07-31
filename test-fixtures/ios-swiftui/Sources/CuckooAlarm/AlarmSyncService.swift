import Foundation

/// Syncs alarms with the backend and reports usage analytics.
final class AlarmSyncService {
  private let session = URLSession.shared
  private let endpoint = URL(string: "https://api.cuckooalarm.example.com/v1/alarms")!

  func push(_ alarms: [Alarm]) async throws {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    _ = try await session.data(for: request)
    Analytics.logEvent("alarm_sync_completed", parameters: ["count": alarms.count])
  }

  func pull() async throws -> Data {
    let (data, _) = try await session.data(from: endpoint)
    Analytics.logEvent("alarm_sync_pulled")
    return data
  }
}

/// Minimal analytics shim so the fixture has a recognizable logging call site.
enum Analytics {
  static func logEvent(_ name: String, parameters: [String: Any] = [:]) {}
}
