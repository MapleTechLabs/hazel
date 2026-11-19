import SwiftUI

/// How the web draws its composer (`web/composer-capture.ts`).
struct ComposerLook: Decodable, Equatable {
    struct Box: Decodable, Equatable { let x, y, w, h: CGFloat; let bg, border: String; let bw, radius: CGFloat }
    struct TextStyle: Decodable, Equatable { let color: String; let size: CGFloat; let weight: Int }
    struct Placeholder: Decodable, Equatable { let text, color: String }
    struct Action: Decodable, Equatable, Identifiable { let id, label: String; let icon: String?; let font: TextStyle }
    struct Send: Decodable, Equatable { let id: String; let icon: String?; let bg, color: String; let size: CGFloat }
    let box: Box
    let font: TextStyle
    let placeholder: Placeholder
    let actions: [Action]
    let send: Send
    let hasContent: Bool
    let bottom: CGFloat
}

/// The message composer, natively: a native text view and the system keyboard, in the web composer's
/// look. The draft goes into the web's editor as it is typed (drafts, typing indicators stay the
/// app's own), and Send presses the web's own send.
struct NativeComposer: View {
    let look: ComposerLook
    let bridge: WebBridge
    @State private var text = ""
    @State private var draftSync: Task<Void, Never>?
    @FocusState private var isFocused: Bool

    private static let primary = Color(red: 0x69 / 255, green: 0x38 / 255, blue: 0xEF / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(look.placeholder.text)
                        .font(WebFont.font(size: look.font.size, weight: look.font.weight))
                        .foregroundStyle(Color(css: look.placeholder.color))
                        .allowsHitTesting(false)
                }
                TextField("", text: $text, axis: .vertical)
                    .font(WebFont.font(size: look.font.size, weight: look.font.weight))
                    .foregroundStyle(Color(css: look.font.color))
                    .tint(Self.primary)
                    .lineLimit(1...6)
                    .focused($isFocused)
                    .onChange(of: text) { _, new in syncDraft(new) }
            }
            .padding(.horizontal, 16)
            .padding(.top, 15)
            .padding(.bottom, 8)
            HStack(spacing: 16) {
                ForEach(look.actions) { action in
                    Button {
                        bridge.composerAction(action.id)
                    } label: {
                        HStack(spacing: 6) {
                            if let key = action.icon, let image = bridge.icons[key] {
                                Image(uiImage: image).resizable().frame(width: 16, height: 16)
                            }
                            Text(action.label)
                                .font(WebFont.font(size: action.font.size, weight: action.font.weight))
                                .foregroundStyle(Color(css: action.font.color))
                        }
                        .frame(minHeight: 32)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
                sendButton
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
        }
        // Liquid Glass over the rows that scroll under it, as the system's own inputs float.
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: Self.radius))
    }

    private static let radius: CGFloat = 26

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var sendButton: some View {
        Button(action: send) {
            Group {
                if let key = look.send.icon, let image = bridge.icons[key] {
                    Image(uiImage: image).renderingMode(.template).resizable().frame(width: 16, height: 16)
                } else {
                    Image(systemName: "arrow.up").font(.system(size: 14, weight: .semibold))
                }
            }
            .foregroundStyle(hasText ? .white : Color(css: look.send.color))
            .frame(width: max(look.send.size, 32), height: max(look.send.size, 32))
            .background(hasText ? Self.primary : Color(css: look.send.bg), in: .circle)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.12), value: hasText)
        .accessibilityLabel("Send message")
    }

    /// The draft reaches the web's editor a moment after typing pauses (not every keystroke).
    private func syncDraft(_ value: String) {
        draftSync?.cancel()
        draftSync = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            bridge.composerDraft(value)
        }
    }

    private func send() {
        guard hasText else { return }
        draftSync?.cancel()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        bridge.composerSend(text.trimmingCharacters(in: .whitespacesAndNewlines))
        text = ""
    }
}
