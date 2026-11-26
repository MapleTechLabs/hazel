import Foundation

// The emoji `hz:emojiPicker` offers on iOS (lane S3): the web's built-in set
// (`web/primitives/overlays/emoji-data.ts`), copied by hand; keep the two in step.

struct OverlayEmoji: Equatable {
    let emoji: String
    let name: String
}

struct OverlayEmojiCategory: Equatable {
    let label: String
    let emojis: [OverlayEmoji]
}

enum OverlayEmojiData {
    static let builtIn: [OverlayEmojiCategory] = [
        OverlayEmojiCategory(label: "Smileys", emojis: [
            OverlayEmoji(emoji: "😀", name: "grinning face"),
            OverlayEmoji(emoji: "😃", name: "grinning face with big eyes"),
            OverlayEmoji(emoji: "😄", name: "grinning face with smiling eyes"),
            OverlayEmoji(emoji: "😁", name: "beaming face"),
            OverlayEmoji(emoji: "😆", name: "grinning squinting face"),
            OverlayEmoji(emoji: "😅", name: "grinning face with sweat"),
            OverlayEmoji(emoji: "😂", name: "face with tears of joy"),
            OverlayEmoji(emoji: "🙂", name: "slightly smiling face"),
            OverlayEmoji(emoji: "😉", name: "winking face"),
            OverlayEmoji(emoji: "😊", name: "smiling face with smiling eyes"),
            OverlayEmoji(emoji: "😍", name: "smiling face with heart eyes"),
            OverlayEmoji(emoji: "😘", name: "face blowing a kiss"),
            OverlayEmoji(emoji: "😋", name: "face savoring food"),
            OverlayEmoji(emoji: "😎", name: "smiling face with sunglasses"),
            OverlayEmoji(emoji: "🤔", name: "thinking face"),
            OverlayEmoji(emoji: "🤨", name: "face with raised eyebrow"),
            OverlayEmoji(emoji: "😐", name: "neutral face"),
            OverlayEmoji(emoji: "😴", name: "sleeping face"),
            OverlayEmoji(emoji: "😮", name: "face with open mouth"),
            OverlayEmoji(emoji: "😢", name: "crying face"),
            OverlayEmoji(emoji: "😭", name: "loudly crying face"),
            OverlayEmoji(emoji: "😡", name: "pouting face"),
            OverlayEmoji(emoji: "🥳", name: "partying face"),
            OverlayEmoji(emoji: "🤯", name: "exploding head"),
        ]),
        OverlayEmojiCategory(label: "People", emojis: [
            OverlayEmoji(emoji: "👍", name: "thumbs up"),
            OverlayEmoji(emoji: "👎", name: "thumbs down"),
            OverlayEmoji(emoji: "👏", name: "clapping hands"),
            OverlayEmoji(emoji: "🙌", name: "raising hands"),
            OverlayEmoji(emoji: "🙏", name: "folded hands"),
            OverlayEmoji(emoji: "👋", name: "waving hand"),
            OverlayEmoji(emoji: "🤝", name: "handshake"),
            OverlayEmoji(emoji: "✌️", name: "victory hand"),
            OverlayEmoji(emoji: "🤞", name: "crossed fingers"),
            OverlayEmoji(emoji: "👀", name: "eyes"),
            OverlayEmoji(emoji: "💪", name: "flexed biceps"),
            OverlayEmoji(emoji: "🫡", name: "saluting face"),
        ]),
        OverlayEmojiCategory(label: "Nature", emojis: [
            OverlayEmoji(emoji: "🐿️", name: "chipmunk"),
            OverlayEmoji(emoji: "🐶", name: "dog face"),
            OverlayEmoji(emoji: "🐱", name: "cat face"),
            OverlayEmoji(emoji: "🦊", name: "fox"),
            OverlayEmoji(emoji: "🐻", name: "bear"),
            OverlayEmoji(emoji: "🐼", name: "panda"),
            OverlayEmoji(emoji: "🌱", name: "seedling"),
            OverlayEmoji(emoji: "🌲", name: "evergreen tree"),
            OverlayEmoji(emoji: "🌸", name: "cherry blossom"),
            OverlayEmoji(emoji: "🌞", name: "sun with face"),
            OverlayEmoji(emoji: "🌈", name: "rainbow"),
            OverlayEmoji(emoji: "⚡", name: "high voltage"),
        ]),
        OverlayEmojiCategory(label: "Food", emojis: [
            OverlayEmoji(emoji: "☕", name: "hot beverage"),
            OverlayEmoji(emoji: "🍕", name: "pizza"),
            OverlayEmoji(emoji: "🍔", name: "hamburger"),
            OverlayEmoji(emoji: "🌮", name: "taco"),
            OverlayEmoji(emoji: "🍣", name: "sushi"),
            OverlayEmoji(emoji: "🍩", name: "doughnut"),
            OverlayEmoji(emoji: "🍪", name: "cookie"),
            OverlayEmoji(emoji: "🍰", name: "shortcake"),
            OverlayEmoji(emoji: "🍎", name: "red apple"),
            OverlayEmoji(emoji: "🍌", name: "banana"),
            OverlayEmoji(emoji: "🍺", name: "beer mug"),
            OverlayEmoji(emoji: "🥂", name: "clinking glasses"),
        ]),
        OverlayEmojiCategory(label: "Activities", emojis: [
            OverlayEmoji(emoji: "🎉", name: "party popper"),
            OverlayEmoji(emoji: "🎊", name: "confetti ball"),
            OverlayEmoji(emoji: "🎁", name: "wrapped gift"),
            OverlayEmoji(emoji: "🏆", name: "trophy"),
            OverlayEmoji(emoji: "⚽", name: "soccer ball"),
            OverlayEmoji(emoji: "🎮", name: "video game"),
            OverlayEmoji(emoji: "🎯", name: "bullseye"),
            OverlayEmoji(emoji: "🎨", name: "artist palette"),
        ]),
        OverlayEmojiCategory(label: "Objects", emojis: [
            OverlayEmoji(emoji: "💡", name: "light bulb"),
            OverlayEmoji(emoji: "📌", name: "pushpin"),
            OverlayEmoji(emoji: "📎", name: "paperclip"),
            OverlayEmoji(emoji: "📝", name: "memo"),
            OverlayEmoji(emoji: "📅", name: "calendar"),
            OverlayEmoji(emoji: "🔒", name: "locked"),
            OverlayEmoji(emoji: "🔑", name: "key"),
            OverlayEmoji(emoji: "💻", name: "laptop"),
            OverlayEmoji(emoji: "📱", name: "mobile phone"),
            OverlayEmoji(emoji: "🚀", name: "rocket"),
            OverlayEmoji(emoji: "🔥", name: "fire"),
            OverlayEmoji(emoji: "⏰", name: "alarm clock"),
        ]),
        OverlayEmojiCategory(label: "Symbols", emojis: [
            OverlayEmoji(emoji: "❤️", name: "red heart"),
            OverlayEmoji(emoji: "💜", name: "purple heart"),
            OverlayEmoji(emoji: "💯", name: "hundred points"),
            OverlayEmoji(emoji: "✅", name: "check mark button"),
            OverlayEmoji(emoji: "❌", name: "cross mark"),
            OverlayEmoji(emoji: "⚠️", name: "warning"),
            OverlayEmoji(emoji: "❓", name: "question mark"),
            OverlayEmoji(emoji: "❗", name: "exclamation mark"),
            OverlayEmoji(emoji: "✨", name: "sparkles"),
            OverlayEmoji(emoji: "⭐", name: "star"),
            OverlayEmoji(emoji: "➕", name: "plus"),
            OverlayEmoji(emoji: "👉", name: "backhand index pointing right"),
        ]),
    ]

    /// Categories narrowed to `query` (by name, any word prefix); empty ones drop out, as on the web.
    static func search(_ query: String) -> [OverlayEmojiCategory] {
        let wanted = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !wanted.isEmpty else { return builtIn }
        return builtIn.compactMap { category in
            let emojis = category.emojis.filter { each in
                each.name.split(separator: " ").contains { $0.hasPrefix(wanted) } || each.name.hasPrefix(wanted)
            }
            return emojis.isEmpty ? nil : OverlayEmojiCategory(label: category.label, emojis: emojis)
        }
    }
}
