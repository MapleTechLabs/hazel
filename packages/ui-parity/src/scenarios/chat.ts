import type { Page } from "playwright"
import { richChat, richDataset } from "../fixtures/datasets/rich.ts"
import { chatOverlayScenarios, parkMouse } from "./chat-overlays.ts"
import { chat, org, type AreaModule, type Scenario } from "./types.ts"

/** A scenario on the `rich` dataset (threads, embeds, attachments, bots, ...). */
const rich = (scenario: Omit<Scenario, "area" | "dataset">): Scenario => ({
	area: "chat",
	dataset: "rich",
	...scenario,
})

const scrollTo = async (page: Page, text: string) => {
	await page.getByText(text).first().scrollIntoViewIfNeeded()
}

const richStates: ReadonlyArray<Scenario> = [
	rich({
		id: "chat-rich-channel",
		title: "Channel with date separators, pins, a thread, custom emoji, a mention and a Discord-synced message",
		path: richChat("launch"),
		viewports: ["desktop", "mobile"],
		themes: ["light", "dark"],
	}),
	rich({
		id: "chat-date-separators",
		title: "Scrolled to the oldest day: grouped messages and date separators",
		path: richChat("launch"),
		steps: (page) => scrollTo(page, "Kicking off the launch channel"),
	}),
	rich({
		id: "chat-reply-preview",
		title: "Reply with its quoted parent and a code block above",
		path: richChat("launch"),
		steps: (page) => scrollTo(page, "Rollout plan for the sync service"),
	}),
	rich({
		id: "chat-thread-panel",
		title: "Thread panel open beside the channel",
		path: richChat("launch"),
		themes: ["light", "dark"],
		steps: async (page) => {
			await page.getByRole("button", { name: /3 replies/ }).click()
			await page.getByText("CI freeze and release tagging are mine.").waitFor()
			await parkMouse(page)
		},
	}),
	rich({
		id: "chat-thread-channel",
		title: "Thread opened as its own channel, with the parent breadcrumb",
		path: richChat("launch-thread"),
	}),
	rich({
		id: "chat-pinned-messages",
		title: "Pinned messages panel",
		path: richChat("launch"),
		themes: ["light", "dark"],
		steps: async (page) => {
			await page.getByRole("button", { name: "View pinned messages" }).click()
			await page.getByRole("dialog").waitFor()
		},
	}),
	rich({
		id: "chat-embed-github",
		title: "GitHub bot: merged PR and push embeds",
		path: richChat("github"),
	}),
	rich({
		id: "chat-embed-railway",
		title: "Railway bot: crashed and deployed embeds",
		path: richChat("deploys"),
		themes: ["light", "dark"],
	}),
	rich({
		id: "chat-embed-openstatus",
		title: "OpenStatus bot: down and recovered",
		path: richChat("status"),
	}),
	rich({
		id: "chat-embed-rich-link",
		title: "Rich link embed with author, thumbnail, image and footer",
		path: richChat("links"),
	}),
	rich({
		id: "chat-attachments",
		title: "Image grids, documents and a video",
		path: richChat("media"),
		viewports: ["desktop", "mobile"],
	}),
	rich({
		id: "chat-attachments-grid",
		title: "Five-image grid with the +1 overlay",
		path: richChat("media"),
		steps: (page) => scrollTo(page, "Moodboard for the launch page"),
	}),
	rich({
		id: "chat-image-viewer",
		title: "Image viewer opened from an attachment",
		path: richChat("media"),
		steps: async (page) => {
			await page.getByRole("img", { name: "dashboard.png" }).click()
			// The viewer has no dialog role; it renders a second copy of the image.
			await page.getByRole("img", { name: "dashboard.png" }).nth(1).waitFor()
		},
	}),
	rich({
		id: "chat-long-message",
		title: "Long message with a wide code line and an unbroken token",
		path: richChat("long-reads"),
		viewports: ["desktop", "mobile"],
		// Taller than the mobile viewport, and the initial scroll lands at either end. Pin it to the
		// start: scrolling up can't chain into the page, scrolling down sometimes moves the body 1px.
		steps: async (page) => {
			await page.getByText("Raw trace id for reference").hover()
			await page.mouse.wheel(0, -10_000)
			await parkMouse(page)
		},
	}),
	rich({
		id: "chat-join-banner",
		title: "Public channel the user hasn't joined",
		path: richChat("announcements"),
		themes: ["light", "dark"],
	}),
	rich({ id: "chat-typing-indicator", title: "Two teammates typing", path: richChat("standup") }),
	rich({
		id: "chat-files-tab-populated",
		title: "Files tab with media and document rows",
		path: `${richChat("media")}/files`,
		themes: ["light", "dark"],
	}),
	rich({ id: "chat-files-media", title: "All media gallery", path: `${richChat("media")}/files/media` }),
	// The chat index (`/$orgSlug/chat`) is covered by the home area (chat-index*).
]

export const chatArea: AreaModule = {
	datasets: [richDataset],
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
		...richStates,
		...chatOverlayScenarios,
	],
}
