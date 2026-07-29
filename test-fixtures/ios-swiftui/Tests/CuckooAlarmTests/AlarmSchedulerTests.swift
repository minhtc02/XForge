import XCTest
@testable import CuckooAlarm

final class AlarmSchedulerTests: XCTestCase {
  func testScheduleDoesNotThrow() {
    let scheduler = AlarmScheduler()
    scheduler.schedule(at: Date(), label: "Wake up")
  }
}
