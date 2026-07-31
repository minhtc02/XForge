import XCTest

/// Hand-written UI test. Its presence is what tells XForge a UI test target
/// exists — generated XCUITest sources are added alongside it.
final class AlarmUITests: XCTestCase {
  func testAlarmListIsVisibleOnLaunch() {
    let app = XCUIApplication()
    app.launchArguments = ["--xforge-test"]
    app.launch()
    XCTAssertTrue(app.descendants(matching: .any)["alarm-list"].waitForExistence(timeout: 5))
  }
}
