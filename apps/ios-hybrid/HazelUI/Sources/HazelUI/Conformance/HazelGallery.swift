import SwiftUI

/// The iOS gallery (phase 1.5): every conformance case drawn through `TreeView`, grouped by tag, in
/// light or dark and either size class. The spike app shows it with `-HazelScreen gallery`.
public struct HazelGallery: View {
    let cases: [ConformanceCase]
    let failure: String?
    @State private var dark = false
    @State private var regular = false
    @State private var filter = ""

    public init(fixtures directory: URL) {
        do {
            cases = try ConformanceFixtures.load(from: directory)
            failure = nil
        } catch {
            cases = []
            failure = "\(error)"
        }
    }

    private var shown: [ConformanceCase] {
        filter.isEmpty ? cases : cases.filter { $0.id.localizedCaseInsensitiveContains(filter) }
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if let failure { Text(failure).foregroundStyle(.red) }
                    ForEach(shown) { c in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(c.id)  ·  lane \(c.lane)").font(.caption.monospaced()).foregroundStyle(.secondary)
                            GalleryCase(c: c)
                        }
                    }
                }
                .padding(16)
            }
            .searchable(text: $filter, prompt: "Filter cases")
            .navigationTitle("Hazel UI (\(shown.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Toggle("Dark", isOn: $dark).toggleStyle(.button)
                    Toggle("Regular", isOn: $regular).toggleStyle(.button)
                }
            }
        }
        .environment(\.horizontalSizeClass, regular ? .regular : .compact)
        .preferredColorScheme(dark ? .dark : .light)
    }
}

/// One case's own tree, built once when the row is made.
struct GalleryCase: View {
    let c: ConformanceCase
    private let tree: Tree?
    private let error: String?

    init(c: ConformanceCase) {
        self.c = c
        do {
            tree = try ConformanceFixtures.tree(c)
            error = nil
        } catch {
            tree = nil
            self.error = "\(error)"
        }
    }

    var body: some View {
        if let tree {
            TreeView(tree: tree)
                .frame(width: c.frame == "sidebar" ? 240 : nil, alignment: .leading)
                .frame(maxWidth: c.frame == "screen" ? .infinity : nil, alignment: .leading)
        } else if let error {
            Text(error).font(.caption).foregroundStyle(.red)
        }
    }
}
