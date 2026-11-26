import SwiftUI

/// Effect UI on a native host (spike, `docs/cross-platform-ui.md` phase 1): the channel list's
/// Effect UI component runs in JavaScriptCore and SwiftUI draws what it commits. No web view.
@main
struct EffectUiSpikeApp: App {
    @State private var runtime: EffectUiRuntime

    init() {
        let runtime = MainActor.assumeIsolated { EffectUiRuntime() }
        _runtime = State(initialValue: runtime)
    }

    var body: some Scene {
        WindowGroup {
            ChannelListScreen(runtime: runtime)
                .task { runtime.start() }
        }
    }
}

struct ChannelListScreen: View {
    let runtime: EffectUiRuntime
    private var tree: EffectUiTree { runtime.tree }

    var body: some View {
        NavigationStack {
            Group {
                if let screen = tree.screen {
                    List {
                        ForEach(screen.children.filter { $0.kind == "section" }) { section in
                            Section {
                                ForEach(section.children.filter { $0.kind == "item" }) { item in
                                    row(item)
                                }
                            } header: {
                                header(section)
                            }
                        }
                        Section("Bridge") { stats }
                    }
                    .navigationTitle(screen.title)
                } else {
                    ProgressView()
                }
            }
        }
    }

    private func header(_ section: UiNode) -> some View {
        HStack {
            Text(section.title)
            Spacer()
            if let action = section.children.first(where: { $0.kind == "action" }) {
                Button { runtime.fire(action.id) } label: {
                    Image(systemName: action.symbol ?? "plus")
                }
                .accessibilityLabel(action.props["label"] as? String ?? "")
            }
        }
    }

    private func row(_ item: UiNode) -> some View {
        Button { runtime.fire(item.id) } label: {
            Label {
                Text(item.title)
                    .fontWeight(item.isEmphasized ? .semibold : .regular)
                    .foregroundStyle(.primary)
            } icon: {
                if let symbol = item.symbol {
                    Image(systemName: symbol)
                } else {
                    Text(item.initials ?? "")
                        .font(.caption2.weight(.semibold))
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(.tint.opacity(0.2)))
                }
            }
        }
        .badge(item.badge)
        .listRowBackground(item.isSelected ? Color.accentColor.opacity(0.15) : nil)
    }

    private var stats: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Batches: \(tree.batches)")
            Text("Last batch: \(tree.lastOps) ops, \(tree.lastBytes) bytes")
            Text(String(format: "Applied in %.2f ms", tree.lastApplyMs))
        }
        .font(.footnote.monospacedDigit())
        .foregroundStyle(.secondary)
    }
}
