import SwiftUI

/// The fixed, decorative night sky behind the app: a lavender glow, a few
/// stars and a crescent moon in the corner. In the day theme it fades to a
/// soft lavender wash.
struct SkyBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Palette.background
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                ZStack {
                    RadialGradient(
                        colors: [Color(hex: 0xB9AEFB).opacity(scheme == .dark ? 0.16 : 0.22), .clear],
                        center: UnitPoint(x: 0.85, y: -0.05), startRadius: 0, endRadius: max(w, h) * 0.6
                    )
                    RadialGradient(
                        colors: [Color(hex: 0x3B2E6B).opacity(scheme == .dark ? 0.55 : 0.10), .clear],
                        center: UnitPoint(x: 0, y: 0), startRadius: 0, endRadius: max(w, h) * 0.55
                    )
                    if scheme == .dark {
                        Canvas { context, size in
                            for star in Self.stars {
                                let rect = CGRect(
                                    x: star.x * size.width, y: star.y * size.height,
                                    width: star.r * 2, height: star.r * 2
                                )
                                context.fill(Path(ellipseIn: rect), with: .color(.white.opacity(star.o)))
                            }
                        }
                        Crescent()
                            .frame(width: 90, height: 90)
                            .position(x: w - 90, y: 70)
                            .opacity(0.5)
                    }
                }
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    /// Fixed positions, so the sky doesn't change between launches.
    private static let stars: [(x: Double, y: Double, r: Double, o: Double)] = {
        var seed: UInt64 = 0x4D6F_6F6E
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 33) / Double(UInt64(1) << 31)
        }
        return (0..<70).map { _ in (next(), next(), 0.4 + next() * 0.9, 0.15 + next() * 0.5) }
    }()
}

/// A soft crescent moon.
private struct Crescent: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(
                    colors: [Color(hex: 0xFDFBFF), Color(hex: 0xDDD6FF), Color(hex: 0xA89CF2)],
                    center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: 50
                ))
                .mask {
                    Rectangle()
                        .overlay(Circle().offset(x: 22, y: -14).blendMode(.destinationOut))
                        .compositingGroup()
                }
                .shadow(color: Color(hex: 0xB9AEFB).opacity(0.6), radius: 18)
        }
    }
}
