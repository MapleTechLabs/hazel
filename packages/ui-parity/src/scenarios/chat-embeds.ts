import { embedsChat, embedsDataset } from "../fixtures/datasets/embeds.ts"
import { richChat } from "../fixtures/datasets/rich.ts"
import { parkMouse } from "./chat-overlays.ts"
import type { AreaModule, Scenario } from "./types.ts"

/**
 * Message content served by third parties (link previews, tweets, YouTube, GIFs), AI replies
 * streamed by the Rivet message actor, and the image viewer's carousel. The fixture backend stands
 * in for the network (`backend/network.ts`, `backend/rivet.ts`).
 */

const embeds = (scenario: Omit<Scenario, "area" | "dataset">): Scenario => ({
	area: "chat-embeds",
	dataset: "embeds",
	...scenario,
})

export const chatEmbedsArea: AreaModule = {
	datasets: [embedsDataset],
	scenarios: [
		embeds({
			id: "chat-embeds-link-preview",
			title: "Link previews: with an image, text only, and a URL without a preview",
			path: embedsChat("unfurls"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Launch retro: what went well").waitFor()
			},
		}),
		embeds({
			id: "chat-embeds-tweet",
			title: "Tweet card with entities, photos and metrics, and a tweet that is gone",
			path: embedsChat("tweets"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Tweet not found").waitFor()
				await page.getByRole("link", { name: "@hazelchat" }).waitFor()
			},
		}),
		embeds({
			id: "chat-embeds-youtube",
			title: "YouTube players, one starting at a timestamp",
			path: embedsChat("videos"),
			steps: async (page) => {
				await page.getByTitle("YouTube video player").first().waitFor()
			},
		}),
		embeds({
			id: "chat-embeds-gif",
			title: "GIPHY and KLIPY GIFs with their attribution",
			path: embedsChat("gifs"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("link", { name: "via KLIPY" }).waitFor()
			},
		}),
		embeds({
			id: "chat-embeds-gif-viewer",
			title: "A GIF opened in the image viewer",
			path: embedsChat("gifs"),
			steps: async (page) => {
				await page.getByRole("img", { name: "GIF" }).first().click()
				await page.getByRole("img", { name: "GIF" }).nth(2).waitFor()
				await parkMouse(page)
			},
		}),
		embeds({
			id: "chat-embeds-ai-final",
			title: "AI replies: streamed to completion, from the cache, and failed",
			path: embedsChat("ai-replies"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Nothing is blocking the launch.").waitFor()
			},
		}),
		embeds({
			id: "chat-embeds-ai-streaming",
			title: "AI replies mid-stream (progress bar, partial text, cursor) and still thinking",
			path: embedsChat("ai-live"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Analyzing deploys").waitFor()
				await page.getByText("api", { exact: false }).first().waitFor()
			},
		}),
		{
			id: "chat-embeds-image-carousel",
			area: "chat-embeds",
			dataset: "rich",
			title: "Image viewer carousel: next twice, then a thumbnail",
			path: richChat("media"),
			steps: async (page) => {
				await page.getByText("Moodboard for the launch page").scrollIntoViewIfNeeded()
				await page.getByRole("img", { name: "moodboard-1.png" }).first().click()
				await page.getByRole("button", { name: "Next image" }).click()
				await page.getByText("2 of 5").waitFor()
				await page.getByRole("button", { name: "Next image" }).click()
				await page.getByText("3 of 5").waitFor()
				await page.getByRole("button", { name: "moodboard-5.png" }).last().click()
				await page.getByText("5 of 5").waitFor()
				await parkMouse(page)
			},
		},
		{
			id: "chat-embeds-image-carousel-keys",
			area: "chat-embeds",
			dataset: "rich",
			title: "Image viewer carousel driven by the arrow keys",
			path: richChat("media"),
			steps: async (page) => {
				await page.getByText("Moodboard for the launch page").scrollIntoViewIfNeeded()
				await page.getByRole("img", { name: "moodboard-2.png" }).first().click()
				await page.getByText("2 of 5").waitFor()
				await page.keyboard.press("ArrowRight")
				await page.getByText("3 of 5").waitFor()
				await page.keyboard.press("ArrowLeft")
				await page.keyboard.press("ArrowLeft")
				await page.getByText("1 of 5").waitFor()
				await parkMouse(page)
			},
		},
	],
}
