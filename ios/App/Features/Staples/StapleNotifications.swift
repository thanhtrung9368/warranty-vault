import Foundation
import UserNotifications
import WarrlyKit

/// Local restock check-ins for essentials.
///
/// The server deliberately has no cron entry for staples: "is the shampoo
/// empty?" is a question only the person holding the bottle can answer. The app
/// schedules one local notification at `lastBoughtAt + cadenceDays`; the user
/// answers by opening the item and tapping "Đã mua lại" or "Sắp hết".
///
/// If notification permission is denied, sync does nothing and the screen still
/// works as a manual list. It never prompts on its own — the app's Settings
/// screen owns the permission request.
enum StapleNotifications {
    private static let prefix = "staple."

    static func sync(_ items: [Staple]) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional:
                break
            default:
                return
            }

            center.getPendingNotificationRequests { pending in
                let ours = pending
                    .map(\.identifier)
                    .filter { $0.hasPrefix(prefix) }
                if !ours.isEmpty {
                    center.removePendingNotificationRequests(withIdentifiers: ours)
                }

                let calendar = Calendar.current
                let now = Date()
                for item in items {
                    guard item.state == .ENOUGH,
                          let cadence = item.cadenceDays,
                          cadence > 0,
                          let last = item.lastBoughtAt,
                          let nextDay = calendar.date(
                            byAdding: .day,
                            value: cadence,
                            to: calendar.startOfDay(for: last)
                          ),
                          let fire = calendar.date(
                            bySettingHour: 9, minute: 0, second: 0, of: nextDay
                          ),
                          fire > now
                    else { continue }

                    let content = UNMutableNotificationContent()
                    content.title = L.t("Warrly")
                    content.body = L.t("%@ sắp đến lúc kiểm tra — còn đủ không?", item.name)
                    content.sound = .default

                    var components = calendar.dateComponents(
                        [.year, .month, .day, .hour, .minute], from: fire
                    )
                    components.timeZone = .current
                    let trigger = UNCalendarNotificationTrigger(
                        dateMatching: components, repeats: false
                    )
                    let request = UNNotificationRequest(
                        identifier: prefix + item.id,
                        content: content,
                        trigger: trigger
                    )
                    center.add(request)
                }
            }
        }
    }
}
