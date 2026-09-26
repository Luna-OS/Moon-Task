import MoonTaskCore
import SwiftUI

/// A frosted night-glass panel — the card every section is built from.
struct GlassCard<Content: View>: View {
    var title: String?
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.text)
            }
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass()
    }
}

extension View {
    /// The glass surface: a soft gradient, a hairline border and rounded
    /// corners.
    func glass(cornerRadius: CGFloat = 16) -> some View {
        background(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(LinearGradient(
                    colors: [Palette.glassTop, Palette.glassBottom], startPoint: .top, endPoint: .bottom
                ))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(Palette.border, lineWidth: 1)
                )
        )
    }

    func inset(cornerRadius: CGFloat = 10) -> some View {
        background(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(Palette.inset)
        )
    }
}

/// Small caps label above a value.
struct Eyebrow: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Palette.textMuted)
    }
}

/// A headline measure with its moon, a line of context and a sparkline.
struct StatTile: View {
    var label: String
    var value: String
    var detail: String
    var fraction: Double
    var series: [Double]
    var max: Double?
    var tone: Color = Palette.chart1

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                MoonPhase(fraction: fraction, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow(text: label)
                    Text(value)
                        .font(.figure(22, weight: .semibold))
                        .foregroundStyle(Palette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            Text(detail)
                .font(.system(size: 11.5))
                .foregroundStyle(Palette.textMuted)
                .lineLimit(1)
                .truncationMode(.middle)
            Sparkline(values: series, max: max, tone: tone)
                .frame(height: 34)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}

/// The sidebar's compact moon gauges.
struct SideGauge: View {
    var label: String
    var value: String
    var fraction: Double

    var body: some View {
        HStack(spacing: 10) {
            MoonPhase(fraction: fraction, size: 28)
            VStack(alignment: .leading, spacing: 1) {
                Eyebrow(text: label)
                Text(value)
                    .font(.figure(12))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .inset()
    }
}

/// A tiny area chart without axes.
struct Sparkline: View {
    var values: [Double]
    var max: Double?
    var tone: Color = Palette.chart1

    var body: some View {
        GeometryReader { geo in
            let top = Swift.max(max ?? (values.max() ?? 0), 1e-9)
            let count = Swift.max(values.count, 2)
            let step = geo.size.width / CGFloat(count - 1)
            let points = values.enumerated().map { i, v in
                CGPoint(
                    x: CGFloat(i + count - values.count) * step,
                    y: geo.size.height * (1 - CGFloat(Swift.min(1, v / top)))
                )
            }
            if points.count > 1 {
                let line = Path { p in p.addLines(points) }
                let area = Path { p in
                    p.move(to: CGPoint(x: points[0].x, y: geo.size.height))
                    p.addLines(points)
                    p.addLine(to: CGPoint(x: points[points.count - 1].x, y: geo.size.height))
                    p.closeSubpath()
                }
                area.fill(LinearGradient(
                    colors: [tone.opacity(0.35), tone.opacity(0.02)], startPoint: .top, endPoint: .bottom
                ))
                line.stroke(tone, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

/// A slim horizontal bar.
struct Meter: View {
    var fraction: Double
    var tone: Color = Palette.lavender

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.inset)
                Capsule()
                    .fill(LinearGradient(
                        colors: [tone.opacity(0.75), tone], startPoint: .leading, endPoint: .trailing
                    ))
                    .frame(width: Swift.max(0, geo.size.width * CGFloat(Swift.min(1, fraction))))
            }
        }
        .frame(height: 6)
        .accessibilityValue(Format.percent(fraction * 100, digits: 0))
    }
}

/// Label/value pairs in two aligned columns.
struct Facts: View {
    var items: [(String, String)]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 7) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                GridRow {
                    Text(item.0)
                        .foregroundStyle(Palette.textMuted)
                    Text(item.1)
                        .foregroundStyle(Palette.text)
                        .textSelection(.enabled)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                .font(.system(size: 12))
            }
        }
    }
}

extension Owner {
    var color: Color {
        switch self {
        case .current: return Palette.ownerCurrent
        case .system: return Palette.ownerSystem
        case .other: return Palette.ownerOther
        case .kernel: return Palette.textFaint
        }
    }
}

struct OwnerDot: View {
    var owner: Owner

    var body: some View {
        Circle()
            .fill(owner.color)
            .frame(width: 7, height: 7)
            .help(owner.label)
            .accessibilityLabel(owner.label)
    }
}

struct Chip: View {
    var text: String
    var tone: Color = Palette.lavender

    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(tone)
            .background(Capsule().fill(tone.opacity(0.14)))
    }
}

/// An empty state that explains itself.
struct EmptyNote: View {
    var symbol: String
    var title: String
    var text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 26))
                .foregroundStyle(Palette.lavender)
            Text(title).font(.headline).foregroundStyle(Palette.text)
            Text(text)
                .font(.callout)
                .foregroundStyle(Palette.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
        .padding(30)
        .frame(maxWidth: .infinity)
    }
}

extension ProcessState {
    var tone: Color {
        switch self {
        case .running: return Palette.success
        case .stopped: return Palette.warning
        case .zombie: return Palette.danger
        default: return Palette.textMuted
        }
    }
}
