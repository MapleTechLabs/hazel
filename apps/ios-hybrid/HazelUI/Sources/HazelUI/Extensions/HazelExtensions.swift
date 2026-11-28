import Foundation
import os
import SwiftUI

/// The iOS extension registry (`docs/hazel-ui.md`, "Platform extensions"): an extension's name to the
/// view drawn in its `hz:ext` placeholder. A name nobody registered draws the placeholder's fallback.
@MainActor
public enum HazelExtensions {
    /// Fires one of the extension's declared events on its placeholder node.
    public typealias Send = @MainActor (_ event: String, _ payload: JSONValue) -> Void
    typealias Draw = @MainActor (_ args: JSONValue, _ send: @escaping Send) -> AnyView?

    static let log = Logger(subsystem: "sh.hazel.ui", category: "extensions")
    private static var registry: [String: Draw] = [:]
    /// Extensions that fill their screen and scroll themselves (a web view, a map): a screen lays
    /// them out as it does a list, not inside its own scroll view.
    private static var filling: Set<String> = []

    /// Whether `name` fills its screen (`register(_:props:fills:draw:)`).
    public static func fills(_ name: String) -> Bool { filling.contains(name) }

    /// Every name registered on this platform.
    public static var registered: Set<String> { Set(registry.keys) }
    public static func isRegistered(_ name: String) -> Bool { registry[name] != nil }

    /// Registers `name` with its props as raw JSON (the placeholder's `args`).
    public static func register<V: View>(_ name: String, draw: @escaping @MainActor (JSONValue, @escaping Send) -> V) {
        registry[name] = { args, send in AnyView(draw(args, send)) }
    }

    /// Registers `name` with its props decoded into `P` (codegen's struct for the props Schema). Props
    /// that do not decode draw the fallback and log once per value.
    public static func register<P: Decodable, V: View>(
        _ name: String, props: P.Type, fills: Bool = false, draw: @escaping @MainActor (P, @escaping Send) -> V
    ) {
        if fills { filling.insert(name) } else { filling.remove(name) }
        registry[name] = { args, send in
            do {
                return AnyView(draw(try args.decode(P.self), send))
            } catch {
                log.error("\(name, privacy: .public): props do not decode: \(error, privacy: .public)")
                return nil
            }
        }
    }

    public static func unregister(_ name: String) {
        registry.removeValue(forKey: name)
        filling.remove(name)
    }

    /// The registered view for `name`, or nil (not registered, or its props did not decode).
    static func view(_ name: String, args: JSONValue, send: @escaping Send) -> AnyView? {
        registry[name].flatMap { $0(args, send) }
    }

    /// The startup check: every extension the manifest lists for iOS is registered, and nothing is
    /// registered that the manifest does not declare. Logs what is wrong.
    @discardableResult
    public static func check(_ manifest: ExtensionManifest, platform: String = "ios") -> ManifestReport {
        let report = ManifestReport(manifest: manifest, registered: registered, platform: platform)
        for name in report.missing {
            log.error("\(name, privacy: .public) is declared for \(platform, privacy: .public) but not registered")
        }
        for name in report.undeclared {
            log.error("\(name, privacy: .public) is registered but no extension declares it for \(platform, privacy: .public)")
        }
        return report
    }
}

/// What the shared code declares (`Hazel.extension({ name, props, events, platforms })`), as JSON:
/// `[{"name": "MeshBackground", "platforms": ["ios"], "events": ["Tapped"]}]`.
public struct ExtensionManifest: Decodable, Equatable, Sendable {
    public struct Entry: Decodable, Equatable, Sendable {
        public let name: String
        public let platforms: [String]
        public let events: [String]

        public init(name: String, platforms: [String], events: [String] = []) {
            self.name = name
            self.platforms = platforms
            self.events = events
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decode(String.self, forKey: .name)
            platforms = try c.decode([String].self, forKey: .platforms)
            events = try c.decodeIfPresent([String].self, forKey: .events) ?? []
        }

        enum CodingKeys: String, CodingKey { case name, platforms, events }
    }

    public let extensions: [Entry]

    public init(_ extensions: [Entry]) { self.extensions = extensions }

    public init(from decoder: any Decoder) throws {
        extensions = try decoder.singleValueContainer().decode([Entry].self)
    }

    public init(json: Data) throws {
        self = try JSONDecoder().decode(ExtensionManifest.self, from: json)
    }
}

/// The manifest against what a platform registered.
public struct ManifestReport: Equatable, Sendable {
    /// Declared for the platform, not registered: the placeholder draws its fallback there.
    public let missing: [String]
    /// Registered, but no declaration lists the platform (a typo, or a stale registration).
    public let undeclared: [String]
    public var ok: Bool { missing.isEmpty && undeclared.isEmpty }

    public init(manifest: ExtensionManifest, registered: Set<String>, platform: String) {
        let declared = Set(manifest.extensions.filter { $0.platforms.contains(platform) }.map(\.name))
        missing = declared.subtracting(registered).sorted()
        undeclared = registered.subtracting(declared).sorted()
    }
}
