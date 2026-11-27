// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ExternalChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../app/requests"
import {
	ChatMigrationEvents,
	ChatMigrationMessage,
	ChatMigrationNoDeps,
	doneSummary,
	GetAuthorizationUrl,
	historyPhrase,
	ListWorkspaces,
	PrepareWorkspace,
	ReadOAuthReturn,
	RedirectToProvider,
	RunMigration,
} from "./ChatMigration"

/** The chat migration wizard, walked step by step to its progress step. */

const org = OrganizationId.make("00000002-0000-4000-8000-000000000001")
const connection = SyncConnectionId.make("00000009-0000-4000-8000-000000000001")
const props = { organizationId: org, returnTo: "/hazel/settings/chat-sync", canSkip: true }

const channel = (id: string, name: string) => ({ id: ExternalChannelId.make(id), name, isPrivate: false })
const general = channel("C1", "general")
const random = channel("C2", "random")
const slackWorkspace = { id: "T1", name: "Acme Slack", owner: false }

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const heading = (text: string): Locator.Locator => ({
	description: `<hz:heading>${text}`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:heading")).filter((node) => Locator.textOf(node).trim() === text),
})

/** Mounted, with no OAuth return to resume. */
const start = (overrides: Partial<typeof props> = {}) =>
	Scene.start(ChatMigrationNoDeps, { ...props, ...overrides })
		.expectExact(ReadOAuthReturn.make({}))
		.resolve(ReadOAuthReturn, ChatMigrationMessage.CompletedReadOAuthReturn({ provider: null }))

/** Slack: the one workspace, prepared at once. */
const toChannels = () =>
	start()
		.fire(byProp("choiceGroup", "label", "Platform"), "change", { selected: ["slack"] })
		.expectExact(ListWorkspaces.make({ organizationId: org, provider: "slack" }))
		.resolve(
			ListWorkspaces,
			ChatMigrationMessage.SucceededListWorkspaces({
				organizationId: org,
				provider: "slack",
				workspaces: [slackWorkspace],
			}),
		)
		.expectExact(
			PrepareWorkspace.make({ organizationId: org, provider: "slack", workspace: slackWorkspace }),
		)
		.resolve(
			PrepareWorkspace,
			ChatMigrationMessage.SucceededPrepare({
				organizationId: org,
				workspaceId: "T1",
				syncConnectionId: connection,
				channels: [general, random],
			}),
		)

describe("chat migration wizard", () => {
	test("starts on the platform step and can be skipped", () => {
		start()
			.expect(heading("Coming from Slack or Discord?"))
			.toExist()
			.fire(button("Skip for now"), "press")
			.emitted(ChatMigrationEvents.Skipped())
		start({ canSkip: false }).expect(button("Skip for now")).toBeAbsent()
	})

	test("Slack walks to the progress step: every channel picked, 30 days, then Continue", () => {
		const s = toChannels()
			.expect(heading("Choose what to bring from Acme Slack"))
			.toExist()
			.expect(button("Migrate 2 channels"))
			.toExist()
		expect(s.get(byProp("choiceGroup", "label", "History to import")).props?.["selected"]).toEqual([
			"30d",
		])
		s.fire(byProp("toggle", "label", "Bring #random"), "change", { checked: false })
			.fire(byProp("choiceGroup", "label", "History to import"), "change", { selected: ["7d"] })
			.fire(button("Migrate 1 channel"), "press")
			.expectExact(
				RunMigration.make({
					organizationId: org,
					syncConnectionId: connection,
					channels: [{ externalChannelId: general.id, externalChannelName: "general" }],
					history: "7d",
				}),
			)
		expect(s.get(button("Starting...")).props).toMatchObject({ loading: true, disabled: true })
		const result = { linked: 1, created: 1, skipped: 0, takenElsewhere: 0 }
		s.resolve(RunMigration, ChatMigrationMessage.SucceededMigrate({ organizationId: org, result }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Migrating 1 channel from Slack",
						description: "Past messages import in the background.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
			.expect(heading("You're all set"))
			.toExist()
			.fire(button("Continue"), "press")
			.emitted(ChatMigrationEvents.Finished())
	})

	test("select all follows the search; none picked disables Migrate", () => {
		toChannels()
			.fire(byProp("toggle", "label", "Select all"), "change", { checked: false })
			.expect(button("Pick a channel"))
			.toExist()
			.fire(Locator.tag("hz:searchField"), "change", { value: "gen", rev: 1, edit: 0 })
			.fire(byProp("toggle", "label", "Select all matching"), "change", { checked: true })
			.expect(button("Migrate 1 channel"))
			.toExist()
	})

	test("Discord picks a server; Back returns to the list and keeps the picks", () => {
		const servers = [
			{ id: "G1", name: "Gamers", owner: true },
			{ id: "G2", name: "Builders", owner: false },
		]
		start()
			.fire(byProp("choiceGroup", "label", "Platform"), "change", { selected: ["discord"] })
			.resolve(
				ListWorkspaces,
				ChatMigrationMessage.SucceededListWorkspaces({
					organizationId: org,
					provider: "discord",
					workspaces: servers,
				}),
			)
			.expect(heading("Pick a Discord server"))
			.toExist()
			.fire(byProp("item", "title", "Builders"), "press")
			.resolve(
				PrepareWorkspace,
				ChatMigrationMessage.SucceededPrepare({
					organizationId: org,
					workspaceId: "G2",
					syncConnectionId: connection,
					channels: [general, random],
				}),
			)
			.fire(byProp("toggle", "label", "Bring #general"), "change", { checked: false })
			.fire(button("Back"), "press")
			.expect(heading("Pick a Discord server"))
			.toExist()
			.fire(byProp("item", "title", "Builders"), "press")
			.resolve(
				PrepareWorkspace,
				ChatMigrationMessage.SucceededPrepare({
					organizationId: org,
					workspaceId: "G2",
					syncConnectionId: connection,
					channels: [general, random],
				}),
			)
			.expect(button("Migrate 1 channel"))
			.toExist()
	})

	test("not connected: authorize, then leave for the provider's consent page", () => {
		start()
			.fire(byProp("choiceGroup", "label", "Platform"), "change", { selected: ["slack"] })
			.resolve(
				ListWorkspaces,
				ChatMigrationMessage.FailedListWorkspaces({
					organizationId: org,
					provider: "slack",
					problem: null,
				}),
			)
			.expect(heading("Connect Slack"))
			.toExist()
			.fire(button("Connect Slack"), "press")
			.expectExact(
				GetAuthorizationUrl.make({
					organizationId: org,
					provider: "slack",
					returnTo: props.returnTo,
				}),
			)
			.resolve(
				GetAuthorizationUrl,
				ChatMigrationMessage.SucceededGetAuthorizationUrl({
					organizationId: org,
					url: "https://slack.test/oauth",
				}),
			)
			.expectExact(RedirectToProvider.make({ url: "https://slack.test/oauth" }))
			.resolve(RedirectToProvider, Component.noop)
			.expect(button("Opening..."))
			.toExist()
	})

	test("a failed step says why and retries it", () => {
		const problem = {
			title: "Could not load Slack channels",
			description: "Slack refused.",
			canRetry: true,
		}
		start()
			.fire(byProp("choiceGroup", "label", "Platform"), "change", { selected: ["slack"] })
			.resolve(
				ListWorkspaces,
				ChatMigrationMessage.SucceededListWorkspaces({
					organizationId: org,
					provider: "slack",
					workspaces: [slackWorkspace],
				}),
			)
			.resolve(
				PrepareWorkspace,
				ChatMigrationMessage.FailedPrepare({ organizationId: org, workspaceId: "T1", problem }),
			)
			.expect(heading("Could not load Slack channels"))
			.toExist()
			.fire(button("Try again"), "press")
			.expectExact(
				PrepareWorkspace.make({ organizationId: org, provider: "slack", workspace: slackWorkspace }),
			)
			.keepPending(PrepareWorkspace)
	})

	test("an OAuth return resumes once the organization is known", () => {
		Scene.start(ChatMigrationNoDeps, { ...props, organizationId: null })
			.resolve(ReadOAuthReturn, ChatMigrationMessage.CompletedReadOAuthReturn({ provider: "slack" }))
			.props({ ...props })
			.subscription(
				`resume:"${org}","slack"`,
				ChatMigrationMessage.ResumedProvider({ organizationId: org, provider: "slack" }),
			)
			.expectExact(ListWorkspaces.make({ organizationId: org, provider: "slack" }))
			.keepPending(ListWorkspaces)
	})

	test("the progress step's copy", () => {
		expect(doneSummary("slack", { linked: 3, created: 2, skipped: 1, takenElsewhere: 1 })).toBe(
			"Linked 3 Slack channels (2 new in Hazel). 1 channel already synced here, left as they were. 1 channel already syncs into another Hazel workspace, so it was left out.",
		)
		expect(historyPhrase("discord", "none")).toBe("New messages sync from now on.")
	})
})
