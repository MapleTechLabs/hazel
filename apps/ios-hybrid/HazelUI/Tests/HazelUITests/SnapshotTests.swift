import SwiftUI
import UIKit
import XCTest
@testable import HazelUI

/// Phase 1.5 (lane E): every conformance case (`packages/ui/src/conformance/fixtures`) drawn through
/// `TreeView` in a real window, light and dark, compact and regular, compared with the PNGs in
/// `__snapshots__/<tag>/`. A case that draws a `NotImplementedView` is skipped and its lanes named.
///
/// Tolerance: a pixel differs when any RGBA channel differs by more than `channelTolerance` (of 255);
/// a case passes when sizes match and at most `pixelTolerance` (0.2%) of pixels differ. One pinned
/// simulator (`hazel-ui-ci`, iPhone 17 Pro, iOS 26.4) renders the same bytes run to run; the slack
/// covers antialiasing at glyph edges between Xcode point releases.
///
/// Environment (pass through xcodebuild as `TEST_RUNNER_<name>`): `HAZELUI_LANES=S1,S4` limits the
/// cases to tags those lanes own; `HAZELUI_RECORD=1` writes the references instead of comparing.
@MainActor
final class SnapshotTests: XCTestCase {
    nonisolated static let channelTolerance = 4
    nonisolated static let pixelTolerance = 0.002

    private static let checkout = URL(filePath: #filePath).deletingLastPathComponent()
    static let fixtures = checkout.appending(path: "../../../../../packages/ui/src/conformance/fixtures").standardized
    static let references = checkout.appending(path: "__snapshots__").standardized
    static let failures = checkout.appending(path: "../../.build/snapshot-failures").standardized

    enum Theme: String, CaseIterable { case light, dark }
    enum SizeClass: String, CaseIterable {
        case compact, regular
        var width: CGFloat { self == .compact ? 402 : 820 }
    }

    private var window: UIWindow?

    /// A case id without its tag, safe as a file name (`plain.subtitle-Last_message_preview`).
    static func fileName(_ id: String) -> String {
        let name = id.split(separator: "/").dropFirst().joined(separator: "/")
        return String(name.map { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) ? $0 : "_" })
    }

    override func tearDown() async throws {
        window?.isHidden = true
        window = nil
    }

    private var env: [String: String] { ProcessInfo.processInfo.environment }

    func testConformanceSnapshots() async throws {
        let all = try ConformanceFixtures.load(from: Self.fixtures)
        XCTAssertGreaterThan(all.count, 0, "no fixtures at \(Self.fixtures.path)")
        let lanes = env["HAZELUI_LANES"].flatMap { $0.isEmpty ? nil : Set($0.split(separator: ",").map(String.init)) }
        let cases = all.filter { lanes == nil || lanes!.contains($0.lane) }
        let record = env["HAZELUI_RECORD"] == "1"
        var passed = 0, recorded = 0
        var skipped: [String: Set<String>] = [:]
        var failed: [String] = []

        for c in cases {
            var missingLanes: [String: String] = [:]
            for theme in Theme.allCases {
                for size in SizeClass.allCases {
                    NotImplementedView.resetDrawn()
                    let image = try await render(c, theme: theme, size: size)
                    if !NotImplementedView.drawn.isEmpty {
                        missingLanes.merge(NotImplementedView.drawn) { a, _ in a }
                        continue
                    }
                    let name = "\(Self.fileName(c.id)).\(theme.rawValue)-\(size.rawValue).png"
                    let reference = Self.references.appending(path: c.tag).appending(path: name)
                    if record {
                        try FileManager.default.createDirectory(at: reference.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try image.write(to: reference)
                        recorded += 1
                        continue
                    }
                    guard let expected = try? Data(contentsOf: reference) else {
                        failed.append("\(c.id) \(theme)-\(size): no reference; run with HAZELUI_RECORD=1 and commit \(reference.lastPathComponent)")
                        continue
                    }
                    if let problem = Snapshot.compare(expected, image) {
                        failed.append("\(c.id) \(theme)-\(size): \(problem)")
                        let out = Self.failures.appending(path: c.tag)
                        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
                        try? image.write(to: out.appending(path: name.replacingOccurrences(of: ".png", with: ".actual.png")))
                    } else {
                        passed += 1
                    }
                }
            }
            if !missingLanes.isEmpty {
                for (tag, lane) in missingLanes { skipped[lane, default: []].insert(tag) }
                print("HAZELUI_SNAPSHOT skip \(c.id): not implemented: \(missingLanes.sorted { $0.key < $1.key }.map { "lane \($0.value) (\($0.key))" }.joined(separator: ", "))")
            }
        }
        for (lane, tags) in skipped.sorted(by: { $0.key < $1.key }) {
            print("HAZELUI_SNAPSHOT not implemented: lane \(lane) (\(tags.sorted().joined(separator: ", ")))")
        }
        print("HAZELUI_SNAPSHOT \(passed) passed, \(recorded) recorded, \(failed.count) failed, \(cases.count) cases; tolerance channel \(Self.channelTolerance), pixels \(Self.pixelTolerance * 100)%")
        for failure in failed { XCTFail(failure) }
        if passed == 0, recorded == 0, failed.isEmpty {
            throw XCTSkip("not implemented: \(skipped.keys.sorted().map { "lane \($0)" }.joined(separator: ", "))")
        }
    }

    /// The case in a window of the size class's width, in the theme; PNG bytes at 2x.
    private func render(_ c: ConformanceCase, theme: Theme, size: SizeClass) async throws -> Data {
        let tree = try ConformanceFixtures.tree(c)
        let width: CGFloat? = c.frame == "inline" ? nil : (c.frame == "sidebar" ? 240 : size.width)
        let root = SnapshotRoot(tree: tree, width: width)
            .environment(\.horizontalSizeClass, size == .regular ? .regular : .compact)
        let controller = UIHostingController(rootView: root)
        // No status bar or home indicator insets: a case is drawn edge to edge.
        controller.safeAreaRegions = []
        controller.overrideUserInterfaceStyle = theme == .dark ? .dark : .light
        controller.view.backgroundColor = .systemBackground
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        let window = self.window ?? scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        self.window = window
        window.overrideUserInterfaceStyle = controller.overrideUserInterfaceStyle
        window.frame = CGRect(x: 0, y: 0, width: size.width, height: 2000)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        let fitted = controller.sizeThatFits(in: CGSize(width: width ?? size.width, height: 2000))
        let bounds = CGRect(x: 0, y: 0, width: max(1, ceil(fitted.width)), height: max(1, min(2000, ceil(fitted.height))))
        controller.view.frame = bounds
        for _ in 0..<3 {
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(10))
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = true
        // `layer.render`, not `drawHierarchy`: the package's test runner has no window scene on screen.
        return UIGraphicsImageRenderer(bounds: bounds, format: format).pngData { context in
            controller.view.layer.render(in: context.cgContext)
        }
    }
}

/// What a snapshot draws: the case's tree, at its frame's width (or its own width when `nil`).
private struct SnapshotRoot: View {
    let tree: Tree
    let width: CGFloat?

    var body: some View {
        TreeView(tree: tree)
            .frame(width: width, alignment: .topLeading)
            .fixedSize(horizontal: width == nil, vertical: true)
    }
}

/// PNG comparison with no dependency: both images into RGBA8 buffers, compared per channel.
enum Snapshot {
    static func pixels(_ data: Data) -> (width: Int, height: Int, bytes: [UInt8])? {
        guard let image = UIImage(data: data)?.cgImage else { return nil }
        let width = image.width, height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? (width, height, bytes) : nil
    }

    /// Nil when within tolerance, else what differs.
    static func compare(_ expected: Data, _ actual: Data) -> String? {
        guard let a = pixels(expected), let b = pixels(actual) else { return "could not decode a PNG" }
        guard a.width == b.width, a.height == b.height else { return "size \(b.width)x\(b.height), expected \(a.width)x\(a.height)" }
        var differing = 0, maxDelta = 0
        for i in stride(from: 0, to: a.bytes.count, by: 4) {
            var delta = 0
            for c in 0..<4 { delta = max(delta, abs(Int(a.bytes[i + c]) - Int(b.bytes[i + c]))) }
            maxDelta = max(maxDelta, delta)
            if delta > SnapshotTests.channelTolerance { differing += 1 }
        }
        let ratio = Double(differing) / Double(a.width * a.height)
        return ratio <= SnapshotTests.pixelTolerance ? nil : String(format: "%.3f%% of pixels differ (max delta %d)", ratio * 100, maxDelta)
    }
}
