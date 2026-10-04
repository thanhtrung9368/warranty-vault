import SwiftUI
import WarrantyVaultKit

enum ThemePreference: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return L.t("Theo hệ thống")
        case .light:  return L.t("Sáng")
        case .dark:   return L.t("Tối")
        }
    }

    var icon: String {
        switch self {
        case .system: return "gearshape"
        case .light:  return "sun.max"
        case .dark:   return "moon.fill"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

@MainActor
final class ThemeStore: ObservableObject {
    private static let storageKey = "wv_theme"

    @Published var preference: ThemePreference {
        didSet {
            UserDefaults.standard.set(preference.rawValue, forKey: Self.storageKey)
        }
    }

    init() {
        let raw = UserDefaults.standard.string(forKey: Self.storageKey) ?? ""
        self.preference = ThemePreference(rawValue: raw) ?? .system
    }
}
