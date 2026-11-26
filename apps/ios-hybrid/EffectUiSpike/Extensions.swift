import SwiftUI

/// The iOS extension registry (`docs/hazel-ui.md`, "Platform extensions"): an extension name to the
/// view drawn in its `hz:ext` placeholder. Unregistered names draw their fallback slot.
@MainActor
enum HazelExtensions {
    typealias Send = (_ event: String, _ payload: String) -> Void
    typealias Draw = (_ args: [String: JSONValue], _ send: @escaping Send) -> AnyView

    private(set) static var registry: [String: Draw] = [:]

    static func register(_ name: String, _ draw: @escaping Draw) { registry[name] = draw }

    /// The extensions this platform implements (`packages/ui/src/demo/extensions.ts`, `platforms: ["ios"]`).
    static func registerDemo() {
        register("MeshBackground") { args, send in
            AnyView(MeshBackgroundView(props: MeshBackgroundProps(args)).onTapGesture { send("Tapped", "{}") })
        }
    }
}

/// `MeshBackground`'s props, decoded from its Schema's JSON (codegen writes this in phase 1).
struct MeshBackgroundProps {
    let colors: [String]
    let speed: Double
    init(_ args: [String: JSONValue]) {
        colors = args["colors"]?.array?.compactMap(\.string) ?? []
        speed = args["speed"]?.number ?? 0
    }
}

/// Token colour names to colours (G1 stand-in until the generated `Theme.swift`).
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
