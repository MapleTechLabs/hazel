import { defaultIds } from "../fixtures/datasets/default.ts"
import { personalIds } from "../fixtures/datasets/personal.ts"
import { org, type AreaModule } from "./types.ts"

const profile = (userId: string) => `${org}/profile/${userId}`

/** Org home (member directory), the chat index (channel browser) and user profiles. */
export const homeArea: AreaModule = {
	scenarios: [
		// Org home
		{
			id: "home-members",
			area: "home",
			title: "Org home member directory",
			path: org,
			viewports: ["desktop", "mobile"],
			themes: ["light", "dark"],
		},
		{
			id: "home-members-menu",
			area: "home",
			title: "Member actions menu open",
			path: org,
			steps: async (page) => {
				await page.getByRole("button", { name: "Member actions" }).first().click()
				await page.getByRole("menuitem", { name: "Copy email" }).waitFor()
			},
		},
		{
			id: "home-members-search",
			area: "home",
			title: "Member search narrowed to one result",
			path: org,
			steps: async (page) => {
				await page.getByRole("searchbox").fill("grace")
			},
		},
		{
			id: "home-members-search-empty",
			area: "home",
			title: "Member search with no matches",
			path: org,
			steps: async (page) => {
				await page.getByRole("searchbox").fill("nobody-matches-this")
			},
		},
		{
			id: "home-members-overflow",
			area: "home",
			title: "Member directory with many long names",
			path: org,
			dataset: "personal-overflow",
			viewports: ["desktop", "mobile"],
		},
		// Chat index
		{
			id: "chat-index",
			area: "home",
			title: "All channels, public tab",
			path: `${org}/chat`,
			viewports: ["desktop", "mobile"],
			themes: ["light", "dark"],
		},
		{
			id: "chat-index-private",
			area: "home",
			title: "All channels, private tab",
			path: `${org}/chat`,
			steps: async (page) => {
				await page.getByRole("tab", { name: /Private/ }).click()
			},
		},
		{
			id: "chat-index-dms",
			area: "home",
			title: "All channels, direct messages tab",
			path: `${org}/chat`,
			steps: async (page) => {
				await page.getByRole("tab", { name: /Direct messages/ }).click()
			},
		},
		{
			id: "chat-index-overflow",
			area: "home",
			title: "All channels with long names, unread badges and a muted channel",
			path: `${org}/chat`,
			dataset: "personal-overflow",
			viewports: ["desktop", "mobile"],
		},
		// Profiles
		{
			id: "profile-other",
			area: "home",
			title: "Another member's profile",
			path: profile(defaultIds.user("grace")),
			viewports: ["desktop", "mobile"],
			themes: ["light", "dark"],
		},
		{
			id: "profile-own",
			area: "home",
			title: "Own profile with the Edit Profile link",
			path: profile(defaultIds.user("ada")),
		},
		{
			id: "profile-busy",
			area: "home",
			title: "Profile of a busy member",
			path: profile(defaultIds.user("margaret")),
		},
		{
			id: "profile-offline",
			area: "home",
			title: "Profile of an offline member",
			path: profile(defaultIds.user("linus")),
		},
		{
			id: "profile-long-name",
			area: "home",
			title: "Profile with a long name and email",
			path: profile(personalIds.longMember),
			dataset: "personal-overflow",
			viewports: ["desktop", "mobile"],
		},
		{
			id: "profile-not-found",
			area: "home",
			title: "Profile of an unknown user",
			path: profile(personalIds.missingUser),
		},
	],
}
