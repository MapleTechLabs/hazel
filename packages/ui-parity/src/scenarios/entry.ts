import { emptyDataset, emptyIds } from "../fixtures/datasets/empty.ts"
import {
	multiOrgDataset,
	publicOrganizationBySlug,
	publicOrgSlug,
	signedOutDataset,
} from "../fixtures/datasets/entry.ts"
import { onboardingDataset } from "../fixtures/datasets/onboarding.ts"
import type { AreaModule, Scenario } from "./types.ts"

/** Signed-out and pre-org screens: root, sign-in/up, onboarding, select organization, join. */

const area = "entry"
const responsive = { viewports: ["desktop", "mobile"] } as const
const responsiveThemed = { ...responsive, themes: ["light", "dark"] } as const

/** Creator-flow steps reachable through `?step=`; welcome is the bare `/onboarding`. */
const onboardingSteps = [
	["profile", "profileInfo", "Profile details"],
	["timezone", "timezoneSelection", "Timezone selection"],
	["theme", "themeSelection", "Theme and brand colour"],
	["use-cases", "useCases", "Use cases"],
	["role", "role", "Role"],
	["invite-team", "teamInvitation", "Invite your team"],
] as const

const rootScenarios: Scenario[] = [
	{ id: "root-signed-in", area, title: "Root redirects an onboarded member to their org", path: "/" },
	{
		id: "root-signed-out",
		area,
		title: "Root redirects an anonymous visitor to sign-in",
		path: "/",
		dataset: "signed-out",
	},
	{
		id: "root-onboarding",
		area,
		title: "Root redirects a new user to onboarding",
		path: "/",
		dataset: "onboarding",
	},
]

// Clerk's prebuilt components mount into an empty container in parity runs (see README Known gaps).
const authScenarios: Scenario[] = [
	{
		id: "sign-in",
		area,
		title: "Sign-in page (Clerk component container)",
		path: "/sign-in",
		dataset: "signed-out",
		...responsiveThemed,
	},
	{
		id: "sign-up",
		area,
		title: "Sign-up page (Clerk component container)",
		path: "/sign-up",
		dataset: "signed-out",
		...responsiveThemed,
	},
]

const onboardingScenarios: Scenario[] = [
	{
		id: "onboarding-welcome",
		area,
		title: "Onboarding welcome, creating a workspace",
		path: "/onboarding",
		dataset: "onboarding",
		...responsiveThemed,
	},
	{
		id: "onboarding-welcome-continue",
		area,
		title: "Get Started advances to the profile step",
		path: "/onboarding",
		dataset: "onboarding",
		steps: async (page) => {
			await page.getByRole("button", { name: /Get Started/ }).click()
			await page.getByRole("button", { name: /Back/ }).waitFor()
		},
	},
	...onboardingSteps.map(
		([id, step, title]): Scenario => ({
			id: `onboarding-${id}`,
			area,
			title: `Onboarding step: ${title}`,
			path: `/onboarding?step=${step}`,
			dataset: "onboarding",
			...responsive,
		}),
	),
	{
		id: "onboarding-profile-invalid",
		area,
		title: "Profile step with an empty first name",
		path: "/onboarding?step=profileInfo",
		dataset: "onboarding",
		steps: async (page) => {
			await page.getByRole("textbox", { name: "First name" }).fill("")
		},
	},
	{
		id: "onboarding-invite-team-filled",
		area,
		title: "Invite step with a teammate's email entered",
		path: "/onboarding?step=teamInvitation",
		dataset: "onboarding",
		steps: async (page) => {
			await page.getByRole("textbox", { name: "Email 1" }).fill("grace@hazel.test")
			await page.getByRole("button", { name: "Add another email" }).click()
		},
	},
	{
		id: "onboarding-setup-organization",
		area,
		title: "Organization setup (Clerk component container)",
		path: "/onboarding/setup-organization",
		dataset: "onboarding",
		...responsiveThemed,
	},
]

const selectOrganizationScenarios: Scenario[] = [
	{
		id: "select-organization",
		area,
		title: "Organization picker with three organizations",
		path: "/select-organization",
		dataset: "multi-org",
		...responsiveThemed,
	},
	{
		id: "select-organization-empty",
		area,
		title: "No organizations: create your workspace",
		path: "/select-organization",
		dataset: "onboarding",
		...responsive,
	},
	{
		id: "select-organization-unfinished",
		area,
		title: "Picking an organization without a slug opens its setup",
		path: "/select-organization",
		dataset: "multi-org",
		steps: async (page) => {
			await page.getByRole("button", { name: /Orbit Studio/ }).click()
			await page.waitForURL(/\/onboarding\/setup-organization/)
		},
	},
]

const joinScenarios: Scenario[] = [
	{
		id: "join-signed-out",
		area,
		title: "Public invite seen by an anonymous visitor",
		path: `/join/${publicOrgSlug}`,
		dataset: "signed-out",
		...responsiveThemed,
	},
	{
		id: "join-signed-in",
		area,
		title: "Public invite seen by a signed-in user",
		path: `/join/${publicOrgSlug}`,
		...responsive,
	},
	{
		id: "join-not-found",
		area,
		title: "Invalid or non-public invite link",
		path: "/join/does-not-exist",
		dataset: "signed-out",
		...responsive,
	},
]

const emptyScenarios: Scenario[] = [
	{
		id: "empty-org-home",
		area,
		title: "Home of a brand-new organization",
		path: `/${emptyIds.orgSlug}`,
		dataset: "empty",
		...responsiveThemed,
	},
	{
		id: "empty-chat",
		area,
		title: "Chat index with no channels",
		path: `/${emptyIds.orgSlug}/chat`,
		dataset: "empty",
		...responsive,
	},
]

export const entryArea: AreaModule = {
	scenarios: [
		...rootScenarios,
		...authScenarios,
		...onboardingScenarios,
		...selectOrganizationScenarios,
		...joinScenarios,
		...emptyScenarios,
	],
	datasets: [onboardingDataset, emptyDataset, signedOutDataset, multiOrgDataset],
	rpc: () => ({ "organization.getBySlugPublic": publicOrganizationBySlug }),
}
