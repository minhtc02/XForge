import SwiftUI

/// Entry point for the Alarm feature list.
struct AlarmView: View {
  @StateObject private var viewModel = AlarmViewModel()

  var body: some View {
    List(viewModel.alarms) { alarm in
      Text(alarm.label)
        .accessibilityIdentifier("alarm-row-\(alarm.id)")
    }
    .accessibilityIdentifier("alarm-list")
  }
}
