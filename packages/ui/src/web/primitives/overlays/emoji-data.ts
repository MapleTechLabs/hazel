/**
 * What `hz:emojiPicker` offers on the web (lane A3): a small built-in set for a picker given no
 * `categories`, and today's search over names and tags.
 */
import type { EmojiCategory, PickerEmoji } from "../../../vocabulary/content.ts"

export type { EmojiCategory, PickerEmoji }

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

/** The built-in set, for a picker given no `categories`. */
export const builtInCategories: ReadonlyArray<EmojiCategory> = builtIn

/** How well `each` matches `wanted` (today's `searchEmojis`): its name 10, each matching tag 1. */
const score = (each: PickerEmoji, wanted: string) =>
	(each.name.toLowerCase().includes(wanted) ? 10 : 0) +
	(each.keywords ?? []).filter((tag) => tag.toLowerCase().includes(wanted)).length

/**
 * Categories narrowed to `query`, best matches first within each; the recently used drop out while
 * searching, as do categories left empty.
 */
export const searchEmoji = (
	categories: ReadonlyArray<EmojiCategory>,
	query: string,
): ReadonlyArray<EmojiCategory> => {
	const wanted = query.trim().toLowerCase()
	if (wanted === "") return categories
	return categories
		.filter((category) => category.recent !== true)
		.map((category) => ({
			label: category.label,
			emojis: category.emojis
				.map((each) => ({ each, points: score(each, wanted) }))
				.filter(({ points }) => points > 0)
				.sort((a, b) => b.points - a.points)
				.map(({ each }) => each),
		}))
		.filter((category) => category.emojis.length > 0)
}
