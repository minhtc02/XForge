import Foundation
import UserNotifications

/// Schedules local notifications for alarms.
final class AlarmScheduler {
  private let center = UNUserNotificationCenter.current()

  func schedule(at date: Date, label: String) {
    let content = UNMutableNotificationContent()
    content.title = label
    let trigger = UNCalendarNotificationTrigger(
      dateMatching: Calendar.current.dateComponents([.hour, .minute], from: date),
      repeats: true
    )
    let request = UNNotificationRequest(
      identifier: UUID().uuidString,
      content: content,
      trigger: trigger
    )
    center.add(request)
  }
}
