import SwiftUI

/// Effect UI on a native host (spike, `docs/cross-platform-ui.md` phase 1): the channel list's
/// Effect UI component runs in JavaScriptCore and SwiftUI draws what it commits, in Hazel's look
/// (`Theme`). No web view.
@main
struct EffectUiSpikeApp: App {
    @State private var runtime: EffectUiRuntime

    init() {
        Inter.register()
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
        ZStack {
            Theme.screenBg.ignoresSafeArea()
            if let screen = tree.screen {
                VStack(spacing: 0) {
                    band(screen.title)
                    ScrollView {
                        LazyVStack(spacing: Theme.Section.spacing) {
                            ForEach(screen.children.filter { $0.kind == "section" }) { section($0) }
                            stats
                        }
                        .padding(.horizontal, 16)
                    }
                }
            }
        }
    }

    /// The screen's top band, as the web's org header sits: its title over a hairline.
    private func band(_ title: String) -> some View {
        Text(title)
            .font(Inter.font(size: 14, weight: 500))
            .foregroundStyle(Theme.Row.labelEmphasized.opacity(0.8))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .frame(height: 56)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.bandBorder).frame(height: 1) }
    }

    private func section(_ section: UiNode) -> some View {
        VStack(spacing: Theme.Row.spacing) {
            HStack(spacing: 4) {
                Image("hazel.chevron-down")
                    .resizable()
                    .frame(width: Theme.Section.chevronSize, height: Theme.Section.chevronSize)
                Text(section.title).font(Theme.Section.font)
                Spacer()
                if let action = section.children.first(where: { $0.kind == "action" }) {
                    Button { runtime.fire(action.id) } label: {
                        Theme.icon(action.symbol ?? "plus")
                            .resizable()
                            .frame(width: Theme.Section.actionSize, height: Theme.Section.actionSize)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(action.props["label"] as? String ?? "")
                }
            }
            .foregroundStyle(Theme.Section.label)
            .padding(.leading, Theme.Section.chevronLeading)
            .frame(height: Theme.Section.headerHeight)
            .padding(.top, Theme.Section.padTop)
            ForEach(section.children.filter { $0.kind == "item" }) { row($0) }
        }
        .padding(.bottom, Theme.Section.padBottom)
    }

    private func row(_ item: UiNode) -> some View {
        let fg = item.isSelected ? Theme.Row.selectedFg
            : item.isEmphasized ? Theme.Row.labelEmphasized : Theme.Row.label
        return Button { runtime.fire(item.id) } label: {
            HStack(spacing: Theme.Row.gap) {
                if let symbol = item.symbol {
                    Theme.icon(symbol)
                        .resizable()
                        .frame(width: Theme.Row.iconSize, height: Theme.Row.iconSize)
                        .foregroundStyle(item.isSelected ? Theme.Row.selectedFg : Theme.Row.icon)
                } else {
                    Text(item.initials ?? "")
                        .font(Inter.font(size: 10, weight: 600))
                        .foregroundStyle(.white)
                        .frame(width: Theme.Row.avatarSize, height: Theme.Row.avatarSize)
                        .background(Circle().fill(Color(hex: "#7d2800")))
                }
                Text(item.title)
                    .font(Theme.Row.font)
                    .foregroundStyle(fg)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if item.badge > 0 { badge(item.badge) }
            }
            .padding(.leading, Theme.Row.padLeading)
            .padding(.trailing, Theme.Badge.trailing)
            .frame(height: Theme.Row.height)
            .background(
                RoundedRectangle(cornerRadius: Theme.Row.radius)
                    .fill(item.isSelected ? Theme.Row.selectedBg : .clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Row.radius))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(item.title)
    }

    private func badge(_ count: Int) -> some View {
        Text("\(count)")
            .font(Theme.Badge.font)
            .monospacedDigit()
            .foregroundStyle(Theme.Badge.fg)
            .padding(.horizontal, Theme.Badge.padX)
            .frame(minWidth: Theme.Badge.minWidth, minHeight: Theme.Badge.height)
            .background(Capsule().fill(Theme.Badge.bg))
    }

    /// What the last batch cost, so the numbers are in the screenshot.
    private var stats: some View {
        Text("\(tree.batches) batches · last \(tree.lastOps) ops, \(tree.lastBytes) B, \(String(format: "%.2f", tree.lastApplyMs)) ms")
            .font(Inter.font(size: 12, weight: 400))
            .foregroundStyle(Theme.Section.label)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.Section.chevronLeading)
            .padding(.vertical, 16)
    }
}

/// The web's pressed wash (`--wash`) under a row while it is held.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(
            RoundedRectangle(cornerRadius: Theme.Row.radius)
                .fill(configuration.isPressed ? Theme.pressedBg : .clear)
        )
    }
}
