import { chat, type AreaModule } from "./types.ts"

export const chatArea: AreaModule = {
	scenarios: [
		{
			id: "chat-channel",
			area: "chat",
			title: "Channel with messages, reactions and markdown",
			path: chat("general"),
			viewports: ["desktop", "mobile"],
			themes: ["light", "dark"],
		},
		{ id: "chat-channel-empty", area: "chat", title: "Channel with no messages", path: chat("random") },
		{ id: "chat-private-channel", area: "chat", title: "Private channel", path: chat("leadership") },
		{ id: "chat-dm", area: "chat", title: "Direct message", path: chat("dm-grace") },
		{
			id: "chat-message-hover",
			area: "chat",
			title: "Hovered message shows its action toolbar",
			path: chat("general"),
			steps: async (page) => {
				await page.getByText("Shipped the new onboarding copy").hover()
			},
		},
		{
			id: "chat-composer-focused",
			area: "chat",
			title: "Composer focused with draft text",
			path: chat("general"),
			steps: async (page) => {
				// The composer is a combobox (mention autocomplete) with no accessible name yet.
				await page.getByRole("combobox").last().click()
				await page.keyboard.type("Draft reply with **bold** text")
			},
		},
		{
			id: "chat-files-tab",
			area: "chat",
			title: "Channel files tab",
			path: `${chat("general")}/files`,
		},
	],
}
