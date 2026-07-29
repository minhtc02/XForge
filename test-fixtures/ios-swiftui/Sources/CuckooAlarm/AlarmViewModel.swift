import Foundation

struct Alarm: Identifiable {
  let id = UUID()
  let label: String
  let time: Date
}

/// View model backing ``AlarmView``.
final class AlarmViewModel: ObservableObject {
  @Published private(set) var alarms: [Alarm] = []
  private let scheduler = AlarmScheduler()

  func add(label: String, at time: Date) {
    let alarm = Alarm(label: label, time: time)
    alarms.append(alarm)
    scheduler.schedule(at: time, label: label)
  }
}
