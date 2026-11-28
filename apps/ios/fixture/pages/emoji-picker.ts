import type { PageFixture } from "../page-fixture"

/**
 * The reaction picker on #general: a small emoji set in the dataset cache (frimousse's key, so no
 * CDN fetch) and two recent picks, so both sides draw the same grid.
 */
const set = (category: number, line: string) =>
	line.split(" ").map((emoji, index) => ({
		emoji,
		category,
		label: `Emoji ${category}.${index}`,
		version: 1,
		tags: [],
	}))

const data = {
	locale: "en",
	emojis: [
		...set(0, "😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 😘 😋 😎 🤔 😐 😴 😮"),
		...set(1, "👍 👎 👏 🙌 🙏 💪 👋 ✌️ 🤝 👀"),
		...set(2, "❤️ 🔥 🎉 ✨ ⭐ ✅ ❌ 💯"),
	],
	categories: [
		{ index: 0, label: "Smileys & emotion" },
		{ index: 1, label: "People & body" },
		{ index: 2, label: "Symbols" },
	],
	skinTones: {
		light: "Light",
		"medium-light": "Medium-light",
		medium: "Medium",
		"medium-dark": "Medium-dark",
		dark: "Dark",
	},
}

const fixture: PageFixture = {
	seed: () => {
		try {
			globalThis.localStorage?.setItem(
				"frimousse/data/en",
				JSON.stringify({ data, metadata: { emojisEtag: null, messagesEtag: null } }),
			)
			globalThis.localStorage?.setItem(
				"hazel-recent-emojis",
				JSON.stringify([
					{ emoji: "👍", label: "Thumbs up", imageUrl: null },
					{ emoji: "🎉", label: "Party popper", imageUrl: null },
				]),
			)
		} catch {}
	},
}

export default fixture
