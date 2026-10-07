import type { Page } from "playwright"

/**
 * The emoji picker (frimousse) downloads emojibase data from a CDN, which captures block. It reads
 * a cached copy from storage first, so scenarios seed this small fixed set before opening it.
 */

const categories = [
	{
		index: 0,
		label: "Smileys & emotion",
		emojis: "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭",
	},
	{ index: 1, label: "People & body", emojis: "👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🙏" },
	{ index: 3, label: "Animals & nature", emojis: "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦅🦉" },
	{ index: 4, label: "Food & drink", emojis: "🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦" },
	{ index: 6, label: "Activities", emojis: "🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🎗🎟🎫" },
	{ index: 8, label: "Symbols", emojis: "❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝✅❌⭐🔥💯" },
]

const emojiData = {
	data: {
		locale: "en",
		emojis: categories.flatMap((category) =>
			[...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(category.emojis)].map(
				({ segment }, index) => ({
					emoji: segment,
					category: category.index,
					label: `${category.label} ${index + 1}`,
					version: 1,
					tags: [],
				}),
			),
		),
		categories: categories.map(({ index, label }) => ({ index, label })),
		skinTones: {
			light: "Light skin tone",
			"medium-light": "Medium-light skin tone",
			medium: "Medium skin tone",
			"medium-dark": "Medium-dark skin tone",
			dark: "Dark skin tone",
		},
	},
	metadata: { emojisEtag: null, messagesEtag: null },
}

/** Seeds frimousse's cache for the current page; call before opening a picker. */
export const seedEmojiPicker = (page: Page) =>
	page.evaluate((data) => {
		localStorage.setItem("frimousse/data/en", JSON.stringify(data))
		sessionStorage.setItem("frimousse/metadata", JSON.stringify({ emojiVersion: 1, countryFlags: false }))
	}, emojiData)
