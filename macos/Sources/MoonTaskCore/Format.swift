import Foundation

/// Number formatting shared by every view — fixed English units, like the
/// Windows and Linux app, so screenshots and docs match.
public enum Format {
    private static let units = ["B", "KB", "MB", "GB", "TB", "PB"]

    /// 1024-based sizes, as Activity Monitor and Finder's memory figures use.
    public static func bytes(_ value: Double, precision: Int? = nil) -> String {
        if value < 1024 { return "\(Int(max(0, value))) B" }
        var v = value
        var unit = 0
        while v >= 1024 && unit < units.count - 1 {
            v /= 1024
            unit += 1
        }
        let digits = precision ?? (v >= 100 ? 0 : 1)
        return String(format: "%.\(digits)f %@", v, units[unit])
    }

    public static func bytes(_ value: UInt64, precision: Int? = nil) -> String {
        bytes(Double(value), precision: precision)
    }

    public static func rate(_ bytesPerSecond: Double) -> String {
        bytesPerSecond < 1 ? "0 B/s" : bytes(bytesPerSecond) + "/s"
    }

    public static func percent(_ value: Double, digits: Int = 1) -> String {
        String(format: "%.\(digits)f %%", value)
    }

    public static func temperature(_ celsius: Double) -> String {
        String(format: "%.0f °C", celsius)
    }

    /// "3 d 4 h", "2 h 5 min", "12 min", "40 s"
    public static func duration(_ seconds: Double) -> String {
        let s = Int(max(0, seconds))
        let days = s / 86_400
        let hours = (s % 86_400) / 3_600
        let minutes = (s % 3_600) / 60
        if days > 0 { return "\(days) d \(hours) h" }
        if hours > 0 { return "\(hours) h \(minutes) min" }
        if minutes > 0 { return "\(minutes) min" }
        return "\(s) s"
    }

    /// CPU time as h:mm:ss.
    public static func cpuTime(_ seconds: Double) -> String {
        let s = Int(max(0, seconds))
        return String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

    public static func count(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    public static func dateTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .medium
        return f.string(from: date)
    }
}
