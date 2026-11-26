/**
 * What `hz:emojiPicker` offers on the web (lane A3). A small built-in set so the picker works on its
 * own; an island hands it the app's full set (emojibase, custom emoji) with `setEmojiSource`.
 */

export interface PickerEmoji {
	readonly emoji: string
	readonly name: string
}

export interface EmojiCategory {
	readonly label: string
	readonly emojis: ReadonlyArray<PickerEmoji>
}

const parse = (text: string): ReadonlyArray<PickerEmoji> =>
	text
		.trim()
		.split("\n")
		.map((line) => {
			const [emoji = "", ...name] = line.trim().split(" ")
			return { emoji, name: name.join(" ") }
		})

const builtIn: ReadonlyArray<EmojiCategory> = [
	{
		label: "Smileys",
		emojis: parse(`
😀 grinning face
😃 grinning face with big eyes
😄 grinning face with smiling eyes
😁 beaming face
😆 grinning squinting face
😅 grinning face with sweat
😂 face with tears of joy
🙂 slightly smiling face
😉 winking face
😊 smiling face with smiling eyes
😍 smiling face with heart eyes
😘 face blowing a kiss
😋 face savoring food
😎 smiling face with sunglasses
🤔 thinking face
🤨 face with raised eyebrow
😐 neutral face
😴 sleeping face
😮 face with open mouth
😢 crying face
😭 loudly crying face
😡 pouting face
🥳 partying face
🤯 exploding head
`),
	},
	{
		label: "People",
		emojis: parse(`
👍 thumbs up
👎 thumbs down
👏 clapping hands
🙌 raising hands
🙏 folded hands
👋 waving hand
🤝 handshake
✌️ victory hand
🤞 crossed fingers
👀 eyes
💪 flexed biceps
🫡 saluting face
`),
	},
	{
		label: "Nature",
		emojis: parse(`
🐿️ chipmunk
🐶 dog face
🐱 cat face
🦊 fox
🐻 bear
🐼 panda
🌱 seedling
🌲 evergreen tree
🌸 cherry blossom
🌞 sun with face
🌈 rainbow
⚡ high voltage
`),
	},
	{
		label: "Food",
		emojis: parse(`
☕ hot beverage
🍕 pizza
🍔 hamburger
🌮 taco
🍣 sushi
🍩 doughnut
🍪 cookie
🍰 shortcake
🍎 red apple
🍌 banana
🍺 beer mug
🥂 clinking glasses
`),
	},
	{
		label: "Activities",
		emojis: parse(`
🎉 party popper
🎊 confetti ball
🎁 wrapped gift
🏆 trophy
⚽ soccer ball
🎮 video game
🎯 bullseye
🎨 artist palette
`),
	},
	{
		label: "Objects",
		emojis: parse(`
💡 light bulb
📌 pushpin
📎 paperclip
📝 memo
📅 calendar
🔒 locked
🔑 key
💻 laptop
📱 mobile phone
🚀 rocket
🔥 fire
⏰ alarm clock
`),
	},
	{
		label: "Symbols",
		emojis: parse(`
❤️ red heart
💜 purple heart
💯 hundred points
✅ check mark button
❌ cross mark
⚠️ warning
❓ question mark
❗ exclamation mark
✨ sparkles
⭐ star
➕ plus
👉 backhand index pointing right
`),
	},
]

let source: ReadonlyArray<EmojiCategory> = builtIn

/** What the picker offers from now on (an island's full set). */
export const setEmojiSource = (categories: ReadonlyArray<EmojiCategory>) => {
	source = categories
}

export const emojiCategories = (): ReadonlyArray<EmojiCategory> => source

/** Categories narrowed to `query` (by name, any word prefix); empty ones drop out. */
export const searchEmoji = (query: string): ReadonlyArray<EmojiCategory> => {
	const wanted = query.trim().toLowerCase()
	if (wanted === "") return source
	return source
		.map((category) => ({
			label: category.label,
			emojis: category.emojis.filter(
				(each) =>
					each.name.split(" ").some((word) => word.startsWith(wanted)) ||
					each.name.startsWith(wanted),
			),
		}))
		.filter((category) => category.emojis.length > 0)
}
