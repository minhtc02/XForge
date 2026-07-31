import CoreData
import Foundation

/// Core Data record backing a persisted alarm.
final class AlarmRecord: NSManagedObject {
  @NSManaged var label: String
  @NSManaged var fireDate: Date
}

/// Wraps the persistent container and the last-sync marker.
final class AlarmStore {
  private let container = NSPersistentContainer(name: "CuckooAlarm")
  private let defaults = UserDefaults.standard

  var lastSyncedAt: Date? {
    get { defaults.object(forKey: "alarm.lastSyncedAt") as? Date }
    set { defaults.set(newValue, forKey: "alarm.lastSyncedAt") }
  }
}
