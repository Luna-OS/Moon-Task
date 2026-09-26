import SwiftUI

/// A small moon whose lit part grows with `fraction` (0…1) — MoonTask's gauge
/// for CPU, memory and disk load, the same moon as the Windows/Linux app.
struct MoonPhase: View {
    var fraction: Double
    var size: CGFloat = 40

    var body: some View {
        let f = (min(1, max(0, fraction)) * 100).rounded() / 100
        Canvas { context, canvasSize in
            let scale = canvasSize.width / 40
            context.scaleBy(x: scale, y: scale)
            let r: CGFloat = 17
            let center = CGPoint(x: 20, y: 20)
            let disc = Path(ellipseIn: CGRect(x: 3, y: 3, width: 2 * r, height: 2 * r))

            // Glow, stronger as the moon fills.
            let glowRect = CGRect(x: 0, y: 0, width: 40, height: 40)
            context.fill(
                Path(ellipseIn: glowRect),
                with: .radialGradient(
                    Gradient(stops: [
                        .init(color: Color(hex: 0xB9AEFB).opacity(0.3 * f), location: 0.7),
                        .init(color: Color(hex: 0xB9AEFB).opacity(0), location: 1),
                    ]),
                    center: center, startRadius: 0, endRadius: 20
                )
            )
            // The dark side.
            context.fill(disc, with: .color(Color(hex: 0x221B47)))
            context.stroke(disc, with: .color(Color(hex: 0xB9AEFB).opacity(0.35)), lineWidth: 1)

            // Lit area: the right half of the disc, closed by an elliptical
            // terminator that bulges right for a crescent (f < 0.5) and left
            // for a gibbous moon (f > 0.5).
            guard f > 0 else { return }
            let rx = r * abs(1 - 2 * f)
            var lit = Path()
            lit.addArc(center: center, radius: r, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: true)
            // Back up along the terminator (an ellipse of width rx).
            let steps = 32
            for i in 0...steps {
                let t = Double(i) / Double(steps)
                let angle = Double.pi / 2 - t * Double.pi  // +90° … -90°
                let x = center.x + (f > 0.5 ? -1 : 1) * rx * CGFloat(cos(angle))
                let y = center.y + r * CGFloat(sin(angle))
                lit.addLine(to: CGPoint(x: x, y: y))
            }
            lit.closeSubpath()

            context.drawLayer { layer in
                layer.clip(to: lit)
                layer.fill(
                    disc,
                    with: .radialGradient(
                        Gradient(stops: [
                            .init(color: Color(hex: 0xFDFBFF), location: 0),
                            .init(color: Color(hex: 0xDDD6FF), location: 0.55),
                            .init(color: Color(hex: 0xA89CF2), location: 1),
                        ]),
                        center: CGPoint(x: 15.2, y: 12.8), startRadius: 0, endRadius: 31
                    )
                )
                // Craters.
                for (x, y, cr, o) in [(25.0, 14.0, 2.6, 0.28), (29, 24, 1.8, 0.25), (20, 27, 3.2, 0.2), (15, 17, 1.6, 0.22)] {
                    layer.fill(
                        Path(ellipseIn: CGRect(x: x - cr, y: y - cr, width: 2 * cr, height: 2 * cr)),
                        with: .color(Color(hex: 0x8F82E0).opacity(o))
                    )
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
