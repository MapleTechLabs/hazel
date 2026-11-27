import HazelUI
import SwiftUI
import UIKit

/// The demo's extensions on iOS (`packages/ui/src/demo/extensions.ts`), registered with HazelUI's
/// registry and checked against what the shared code declares.
@MainActor
enum DemoExtensions {
    /// Stand-in for the generated manifest: the demo's two declarations.
    static let manifest = ExtensionManifest([
        .init(name: "MeshBackground", platforms: ["ios"], events: ["Tapped"]),
        .init(name: "ActivityChart", platforms: ["web"]),
    ])

    static func register() {
        HazelExtensions.register("MeshBackground", props: MeshBackgroundProps.self) { props, send in
            MeshBackgroundView(props: props).onTapGesture { send("Tapped", [:]) }
        }
        HazelExtensions.check(manifest)
    }
}

/// `MeshBackground`'s props, decoded from its Schema's JSON (codegen writes this struct later).
struct MeshBackgroundProps: Decodable {
    let colors: [String]
    let speed: Double
}

/// Token colour names to colours (G1 stand-in until extensions get token lookups from the theme).
enum TokenColors {
    static func color(_ token: String) -> Color {
        switch token {
        case "brand.500": Color(hex: "#6938ef")
        case "brand.300": Color(hex: "#bda5fa")
        case "accent.400": Color(hex: "#9e77ed")
        default: Color(hex: "#e4e4e7")
        }
    }
}

/// A SwiftUI `MeshGradient` drifting at `speed`: something only iOS draws.
struct MeshBackgroundView: View {
    let props: MeshBackgroundProps

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = Float(timeline.date.timeIntervalSinceReferenceDate * props.speed)
            let a = props.colors.first.map(TokenColors.color) ?? .purple
            let b = props.colors.dropFirst().first.map(TokenColors.color) ?? .blue
            MeshGradient(
                width: 3, height: 3,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 0.5], [0.5 + 0.25 * sin(t), 0.5 + 0.2 * cos(t * 1.3)], [1, 0.5],
                    [0, 1], [0.5, 1], [1, 1],
                ],
                colors: [a, b, a, b, .white.opacity(0.9), b, a, b, a]
            )
        }
        .frame(height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .bottomLeading) {
            Text("MeshBackground · iOS extension")
                .font(Inter.font(size: 12, weight: 500))
                .foregroundStyle(.white)
                .padding(10)
        }
    }
}

extension Color {
    /// `#rrggbb` or `#rrggbbaa`, for the stand-in token colours above.
    init(hex: String) {
        var value: UInt64 = 0
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        Scanner(string: digits).scanHexInt64(&value)
        let hasAlpha = digits.count == 8
        let rgb = hasAlpha ? value >> 8 : value
        self.init(uiColor: UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
        ))
    }
}
