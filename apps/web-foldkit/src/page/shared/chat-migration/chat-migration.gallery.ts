import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { ExternalChannelId, OrganizationMemberId, SyncConnectionId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared, organizationId, uuid } from "../../../test/pages-fixtures"
import {
	connection,
	guild,
	otherGuild,
	slackConnection,
	slackWorkspace,
} from "../../../test/pages-integrations-fixtures"
import type { PageViewInputs, Shared } from "../../contract"
import * as OnboardingMessage from "../../onboarding/message"
import * as OnboardingModel from "../../onboarding/model"
import { init as initOnboarding, update as updateOnboarding } from "../../onboarding/update"
import { view as onboardingView } from "../../onboarding/view"
import * as ChatSync from "../../settings/chat-sync/model"
import { init as initChatSync, update as updateChatSync } from "../../settings/chat-sync/update"
import { view as chatSyncView } from "../../settings/chat-sync/view"
import { Message } from "./model"

/**
 * The Slack / Discord migration wizard, in Chat Sync settings (a modal) and in onboarding (a step),
 * screenshotted in light and dark (`bun run gallery`): `chat-migration-<screen>-<theme>.png`.
 */

const shared: Shared = makeShared()
const inputs = { shared }
const syncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(77))

const channel = (id: string, name: string) => ({
	id: Schema.decodeSync(ExternalChannelId)(id),
	name,
	isPrivate: false,
	isMember: true,
})
const random = channel("C07", "random")
const slackChannels = [
	channel("C01", "announcements"),
	channel("C02", "design-reviews"),
	channel("C03", "engineering"),
	channel("C04", "general"),
	channel("C05", "incidents"),
	channel("C06", "launch-room"),
	random,
	channel("C08", "support"),
]

const wrap = (message: Message) => ChatSync.Message.GotMigrationMessage({ message })
const settingsStep = (model: ChatSync.Model, message: ChatSync.Message) =>
	updateChatSync(model, message, shared).model
const settingsList = [
	ChatSync.Message.SucceededListConnections({ organizationId, connections: [connection, slackConnection] }),
].reduce(settingsStep, initChatSync(undefined, shared).model)
const settings = (...messages: ReadonlyArray<ChatSync.Message>) =>
	[ChatSync.Message.ClickedImport(), ...messages].reduce(settingsStep, settingsList)

const slackPicking = [
	Message.ClickedProvider({ provider: "slack" }),
	Message.SucceededListWorkspaces({ organizationId, provider: "slack", workspaces: [slackWorkspace] }),
	Message.SucceededPrepare({
		organizationId,
		workspaceId: slackWorkspace.id,
		syncConnectionId,
		channels: slackChannels,
	}),
	Message.ToggledChannel({ channelId: random.id, isSelected: false }),
]

const onboardingMember = {
	organizationId,
	memberId: Schema.decodeSync(OrganizationMemberId)(uuid(78)),
	name: "Acme",
	slug: null,
}
/** A creator who has not finished onboarding yet (an onboarded one is sent home). */
const onboardingShared: Shared = makeShared({
	currentUser: shared.currentUser === null ? null : { ...shared.currentUser, isOnboarded: false },
})

const onboarding = (...messages: ReadonlyArray<Message>) =>
	[
		OnboardingMessage.Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
		OnboardingMessage.Message.UpdatedMembership({ membership: onboardingMember }),
		...messages.map((message) => OnboardingMessage.Message.GotMigrationMessage({ message })),
	].reduce(
		(model, message) => updateOnboarding(model, message, onboardingShared).model,
		initOnboarding(
			{ _tag: "Onboarding", orgId: Option.none(), step: Option.some("import") },
			onboardingShared,
		).model,
	)

const frame = <M>(h: HtmlBuilder<M>, content: Html): Html =>
	h.div(
		[
			h.Id("gallery"),
			h.Class("relative h-[860px] w-[1180px] overflow-hidden bg-bg font-sans text-fg antialiased"),
		],
		[content],
	)

const mount = <PageModel, PageMessage extends { readonly _tag: string }>(
	options: Readonly<{
		Model: Schema.Codec<PageModel, unknown, never, never>
		model: PageModel
		update: (model: PageModel, message: PageMessage, shared: Shared) => { readonly model: PageModel }
		view: (model: PageModel, inputs: PageViewInputs, h: HtmlBuilder<PageMessage>) => Html
		padded: boolean
		shared?: Shared
	}>,
) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model: options.Model,
			init: () => ({ model: options.model }),
			update: (model: PageModel, message: PageMessage) => ({
				model: options.update(model, message, options.shared ?? shared).model,
			}),
			view: (model: PageModel, h: HtmlBuilder<PageMessage>) =>
				frame(
					h,
					options.padded
						? h.div([h.Class("p-8")], [options.view(model, inputs, h)])
						: options.view(model, { shared: options.shared ?? shared }, h),
				),
			container,
		}),
	)
}

const settingsScreen = (model: ChatSync.Model) => () =>
	mount({ Model: ChatSync.Model, model, update: updateChatSync, view: chatSyncView, padded: true })
const onboardingScreen = (model: OnboardingModel.Model) => () =>
	mount({
		Model: OnboardingModel.Model,
		model,
		update: updateOnboarding,
		view: onboardingView,
		padded: false,
		shared: onboardingShared,
	})

const screens: ReadonlyArray<readonly [string, () => void]> = [
	["settings-entry", settingsScreen(settingsList)],
	["settings-choose", settingsScreen(settings())],
	[
		"settings-connect-slack",
		settingsScreen(
			settings(
				wrap(Message.ClickedProvider({ provider: "slack" })),
				wrap(
					Message.FailedListWorkspaces({
						organizationId,
						provider: "slack",
						reason: "NotConnected",
					}),
				),
			),
		),
	],
	[
		"settings-discord-server",
		settingsScreen(
			settings(
				wrap(Message.ClickedProvider({ provider: "discord" })),
				wrap(
					Message.SucceededListWorkspaces({
						organizationId,
						provider: "discord",
						workspaces: [guild, otherGuild],
					}),
				),
			),
		),
	],
	["settings-channels", settingsScreen(settings(...slackPicking.map(wrap)))],
	[
		"settings-done",
		settingsScreen(
			settings(
				...[
					...slackPicking,
					Message.ClickedMigrate(),
					Message.SucceededMigrate({
						organizationId,
						linked: 7,
						created: 6,
						skipped: 0,
						takenElsewhere: 0,
					}),
				].map(wrap),
			),
		),
	],
	["onboarding-choose", onboardingScreen(onboarding())],
	["onboarding-channels", onboardingScreen(onboarding(...slackPicking))],
]

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const [name, screen] of screens) {
	for (const theme of ["light", "dark"] as const) {
		test(`${name} ${theme}`, async () => {
			await page.viewport(1180, 860)
			if (theme === "dark") document.documentElement.classList.add("dark")
			screen()
			await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
			// Let the dialog Mounts open, the step animations end and the fonts settle.
			await new Promise((resolve) => setTimeout(resolve, 600))
			await document.fonts.ready
			const gallery = document.getElementById("gallery")
			if (gallery === null) throw new Error("The gallery frame did not render")
			await page.screenshot({ path: `chat-migration-${name}-${theme}.png`, element: gallery })
		})
	}
}
