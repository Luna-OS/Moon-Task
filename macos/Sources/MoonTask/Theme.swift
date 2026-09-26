import AppKit
import SwiftUI

/// MoonTask's palette — the night-sky colors of src/styles/tokens.css, with
/// their light-theme counterparts. Every color resolves per appearance, so
/// the theme switch (or the system's) recolors everything at once.
enum Palette {
    static let background = dynamic(dark: 0x0B0920, light: 0xF5F2FB)
    static let night900 = dynamic(dark: 0x141030, light: 0xFFFFFF)
    static let text = dynamic(dark: 0xFBF7F0, light: 0x1C1733)
    static let textMuted = dynamic(dark: 0xFBF7F0, light: 0x1C1733, darkAlpha: 0.62, lightAlpha: 0.64)
    static let textFaint = dynamic(dark: 0xFBF7F0, light: 0x1C1733, darkAlpha: 0.40, lightAlpha: 0.42)
    static let accent = dynamic(dark: 0xD6CFFD, light: 0x5B4BC4)
    static let lavender = dynamic(dark: 0xB9AEFB, light: 0x7D6DE0)
    static let border = dynamic(dark: 0xB9AEFB, light: 0x3B2E6B, darkAlpha: 0.18, lightAlpha: 0.16)
    static let borderStrong = dynamic(dark: 0xB9AEFB, light: 0x3B2E6B, darkAlpha: 0.36, lightAlpha: 0.32)
    static let glassTop = dynamic(dark: 0x1D1742, light: 0xFFFFFF, darkAlpha: 0.62, lightAlpha: 0.82)
    static let glassBottom = dynamic(dark: 0x141030, light: 0xFFFFFF, darkAlpha: 0.70, lightAlpha: 0.70)
    static let inset = dynamic(dark: 0x0B0920, light: 0xF1EEF8, darkAlpha: 0.55)
    static let selected = dynamic(dark: 0xB9AEFB, light: 0x7D6DE0, darkAlpha: 0.15, lightAlpha: 0.14)
    static let fresh = dynamic(dark: 0x7FE3C6, light: 0x23967A, darkAlpha: 0.12, lightAlpha: 0.12)
    static let chart1 = dynamic(dark: 0x8676E3, light: 0x7D6DE0)
    static let chart2 = dynamic(dark: 0x33AB8B, light: 0x23967A)
    static let grid = dynamic(dark: 0xB9AEFB, light: 0x3B2E6B, darkAlpha: 0.10, lightAlpha: 0.10)
    static let warning = dynamic(dark: 0xF3C766, light: 0xA86B00)
    static let danger = dynamic(dark: 0xF28B92, light: 0xC2323D)
    static let success = dynamic(dark: 0x7FE3C6, light: 0x1D7D65)

    static let ownerCurrent = dynamic(dark: 0xB9AEFB, light: 0x7D6DE0)
    static let ownerSystem = dynamic(dark: 0x9AD7F5, light: 0x2F86B5)
    static let ownerOther = dynamic(dark: 0xF7B89A, light: 0xC7663B)

    static func dynamic(
        dark: UInt32, light: UInt32, darkAlpha: CGFloat = 1, lightAlpha: CGFloat = 1
    ) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark ? NSColor(hex: dark, alpha: darkAlpha) : NSColor(hex: light, alpha: lightAlpha)
        })
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, dark, light
    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "Follow macOS"
        case .dark: return "Night"
        case .light: return "Day"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .dark: return .dark
        case .light: return .light
        }
    }
}

/// Keys of the user's settings (UserDefaults).
enum SettingKey {
    static let theme = "theme"
    static let refreshInterval = "refreshInterval"
    static let showKernel = "showKernel"
    static let confirmOwn = "confirmOwn"
}

extension Font {
    /// Numbers that line up in columns.
    static func figure(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }
}
