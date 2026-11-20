import { ExternalChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import {
	GetChatMigrationOAuthUrl,
	ListChatMigrationWorkspaces,
	RunChatMigration,
	PrepareChatMigrationWorkspace,
} from "./command"
import { init, Message, type Model, Phase } from "./model"
import { type Return, update, withOrganization } from "./update"

const organizationId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000001")
const syncConnectionId = Schema.decodeSync(SyncConnectionId)("00000000-0000-4000-8000-000000000002")
const channel = (id: string, name: string) => ({
	id: ExternalChannelId.make(id),
	name,
	isPrivate: false,
	isMember: true,
})
const general = channel("C1", "general")
const design = channel("C2", "design")
const devops = channel("C3", "dev-ops")
const slackWorkspace = { id: "T1", name: "Acme", owner: false }
const returnTo = "/acme/settings/chat-sync"

const fresh = (org: OrganizationId | null = organizationId): Model =>
	init({ id: "test", organizationId: org, returnTo })

/** Runs messages in order, keeping the last step's commands and outcome. */
const run = (model: Model, ...messages: ReadonlyArray<Message>): Return =>
	messages.reduce<Return>((step, message) => update(step.model, message), { model })

const pickingSlackChannels = (): Model =>
	run(
		fresh(),
		Message.ClickedProvider({ provider: "slack" }),
		Message.SucceededListWorkspaces({ organizationId, provider: "slack", workspaces: [slackWorkspace] }),
		Message.SucceededPrepare({
			organizationId,
			workspaceId: "T1",
			syncConnectionId,
			channels: [design, devops, general],
		}),
	).model

describe("chat migration wizard", () => {
	test("an unconnected provider asks for OAuth that comes back to the page", () => {
		const loading = update(fresh(), Message.ClickedProvider({ provider: "slack" }))
		expect(loading.commands?.map((command) => command.args)).toEqual([
			ListChatMigrationWorkspaces({ organizationId, provider: "slack" }).args,
		])
		const needs = update(
			loading.model,
			Message.FailedListWorkspaces({ organizationId, provider: "slack", reason: "NotConnected" }),
		)
		expect(needs.model.phase._tag).toBe("NeedsAuthorization")
		const authorizing = update(needs.model, Message.ClickedAuthorize())
		expect(authorizing.commands?.map((command) => command.args)).toEqual([
			GetChatMigrationOAuthUrl({ organizationId, provider: "slack", returnTo }).args,
		])
		// A second press while it opens does nothing.
		expect(update(authorizing.model, Message.ClickedAuthorize()).commands ?? []).toEqual([])
	})

	test("a Discord bot in no server needs authorizing; several servers are picked from", () => {
		const loading = update(fresh(), Message.ClickedProvider({ provider: "discord" })).model
		expect(
			update(
				loading,
				Message.SucceededListWorkspaces({ organizationId, provider: "discord", workspaces: [] }),
			).model.phase._tag,
		).toBe("NeedsAuthorization")
		const servers = [
			{ id: "1", name: "One", owner: true },
			{ id: "2", name: "Two", owner: false },
		]
		const picking = update(
			loading,
			Message.SucceededListWorkspaces({ organizationId, provider: "discord", workspaces: servers }),
		)
		expect(picking.model.phase._tag).toBe("PickingWorkspace")
		const preparing = update(picking.model, Message.ClickedWorkspace({ workspace: servers[1]! }))
		expect(preparing.commands?.map((command) => command.args)).toEqual([
			PrepareChatMigrationWorkspace({ organizationId, provider: "discord", workspace: servers[1]! })
				.args,
		])
	})

	test("Slack's one workspace is prepared at once, and every channel starts selected", () => {
		const model = pickingSlackChannels()
		expect(model.phase._tag).toBe("PickingChannels")
		const phase = model.phase as Extract<Phase, { _tag: "PickingChannels" }>
		expect(phase.selected).toEqual(["C2", "C3", "C1"])
		expect(phase.history).toBe("30d")
	})

	test("select all follows the search, and nothing selected cannot be migrated", () => {
		const cleared = run(pickingSlackChannels(), Message.ToggledAll({ isSelected: false }))
		expect(update(cleared.model, Message.ClickedMigrate()).commands ?? []).toEqual([])

		const matching = run(
			cleared.model,
			Message.ChangedChannelSearch({ value: "DE" }),
			Message.ToggledAll({ isSelected: true }),
		).model
		expect((matching.phase as Extract<Phase, { _tag: "PickingChannels" }>).selected).toEqual(["C2", "C3"])
	})

	test("Go migrates the picks with the chosen range, then finishes", () => {
		const going = run(
			pickingSlackChannels(),
			Message.ToggledChannel({ channelId: ExternalChannelId.make("C3"), isSelected: false }),
			Message.ClickedHistory({ history: "7d" }),
			Message.ClickedHistory({ history: "forever" }),
			Message.ClickedMigrate(),
		)
		expect(going.commands?.map((command) => command.args)).toEqual([
			RunChatMigration({
				organizationId,
				syncConnectionId,
				channels: [
					{ externalChannelId: ExternalChannelId.make("C2"), externalChannelName: "design" },
					{ externalChannelId: ExternalChannelId.make("C1"), externalChannelName: "general" },
				],
				history: "7d",
			}).args,
		])
		// No double submit.
		expect(update(going.model, Message.ClickedMigrate()).commands ?? []).toEqual([])

		const done = update(
			going.model,
			Message.SucceededMigrate({ organizationId, linked: 2, created: 1, skipped: 0 }),
		)
		expect(done.model.phase).toMatchObject({ _tag: "Done", linked: 2, created: 1, history: "7d" })
		expect(done.outcome?._tag).toBe("Toast")
		expect(update(done.model, Message.ClickedFinish()).outcome).toEqual({ _tag: "Finished" })
	})

	test("a failed migration keeps the picks to try again", () => {
		const going = run(pickingSlackChannels(), Message.ClickedMigrate())
		const failed = update(
			going.model,
			Message.FailedMigrate({
				organizationId,
				problem: { title: "Nope", description: "", canRetry: true },
			}),
		)
		expect(failed.model.phase).toMatchObject({ _tag: "PickingChannels", isSubmitting: false })
		expect(failed.outcome?._tag).toBe("Toast")
	})

	test("back from OAuth before the organization is known resumes once it is", () => {
		const waiting = update(fresh(null), Message.ReturnedFromProvider({ provider: "slack" }))
		expect(waiting.model.phase._tag).toBe("ChoosingProvider")
		expect(waiting.commands ?? []).toEqual([])
		const resumed = withOrganization(waiting.model, organizationId, returnTo)
		expect(resumed.model.phase._tag).toBe("Loading")
		expect(resumed.model.resumeProvider).toBeNull()
		expect(resumed.commands?.map((command) => command.name)).toEqual(["ListChatMigrationWorkspaces"])
	})

	test("skipping is only for an idle wizard", () => {
		expect(update(fresh(), Message.ClickedSkip()).outcome).toEqual({ _tag: "Skipped" })
		const loading = update(fresh(), Message.ClickedProvider({ provider: "slack" })).model
		expect(update(loading, Message.ClickedSkip()).outcome).toBeUndefined()
	})

	test("more than 500 channels cannot be migrated at once", () => {
		const many = Array.from({ length: 501 }, (_, index) => channel(`X${index}`, `c-${index}`))
		const picking = run(
			fresh(),
			Message.ClickedProvider({ provider: "slack" }),
			Message.SucceededListWorkspaces({
				organizationId,
				provider: "slack",
				workspaces: [slackWorkspace],
			}),
			Message.SucceededPrepare({ organizationId, workspaceId: "T1", syncConnectionId, channels: many }),
		).model
		expect(update(picking, Message.ClickedMigrate()).commands ?? []).toEqual([])
		const fewer = run(picking, Message.ToggledChannel({ channelId: many[0]!.id, isSelected: false }))
		expect(
			update(fewer.model, Message.ClickedMigrate()).commands?.map((command) => command.name),
		).toEqual(["RunChatMigration"])
	})

	test("switching organization starts over and drops the earlier organization's replies", () => {
		const other = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000009")
		const switched = withOrganization(pickingSlackChannels(), other, returnTo).model
		expect(switched.phase._tag).toBe("ChoosingProvider")
		const loading = update(switched, Message.ClickedProvider({ provider: "slack" })).model
		// The first organization's late answer is not this one's.
		const stale = update(
			loading,
			Message.SucceededListWorkspaces({
				organizationId,
				provider: "slack",
				workspaces: [slackWorkspace],
			}),
		)
		expect(stale.model.phase._tag).toBe("Loading")
	})

	test("an earlier organization's consent URL is never followed", () => {
		const other = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000009")
		const needs = run(
			withOrganization(fresh(), other, returnTo).model,
			Message.ClickedProvider({ provider: "slack" }),
			Message.FailedListWorkspaces({
				organizationId: other,
				provider: "slack",
				reason: "NotConnected",
			}),
			Message.ClickedAuthorize(),
		).model
		const stale = update(
			needs,
			Message.SucceededGetOAuthUrl({ organizationId, authorizationUrl: "https://slack.com/a" }),
		)
		expect(stale.commands ?? []).toEqual([])
		const own = update(
			needs,
			Message.SucceededGetOAuthUrl({ organizationId: other, authorizationUrl: "https://slack.com/b" }),
		)
		expect(own.commands?.map((command) => command.name)).toEqual(["RedirectChatMigrationToProvider"])
	})

	test("a migration that linked nothing says so instead of promising an import", () => {
		const done = update(
			run(pickingSlackChannels(), Message.ClickedMigrate()).model,
			Message.SucceededMigrate({ organizationId, linked: 0, created: 0, skipped: 3 }),
		)
		expect(done.model.phase).toMatchObject({ _tag: "Done", linked: 0, skipped: 3 })
		expect(done.outcome).toMatchObject({ _tag: "Toast", toast: { title: "Those channels already sync" } })
	})

	test("Back from a single workspace's channels returns to the start, and the picks come back", () => {
		const picking = run(
			pickingSlackChannels(),
			Message.ToggledChannel({ channelId: ExternalChannelId.make("C1"), isSelected: false }),
			Message.ClickedHistory({ history: "90d" }),
		).model
		const back = update(picking, Message.ClickedBack()).model
		expect(back.phase._tag).toBe("ChoosingProvider")
		const again = run(
			back,
			Message.ClickedProvider({ provider: "slack" }),
			Message.SucceededListWorkspaces({
				organizationId,
				provider: "slack",
				workspaces: [slackWorkspace],
			}),
			Message.SucceededPrepare({
				organizationId,
				workspaceId: "T1",
				syncConnectionId,
				channels: [design, devops, general],
			}),
		).model
		expect(again.phase).toMatchObject({ _tag: "PickingChannels", selected: ["C2", "C3"], history: "90d" })
	})

	test("Back from a server picked from several returns to that list, without reloading it", () => {
		const servers = [
			{ id: "1", name: "One", owner: true },
			{ id: "2", name: "Two", owner: false },
		]
		const picking = run(
			fresh(),
			Message.ClickedProvider({ provider: "discord" }),
			Message.SucceededListWorkspaces({ organizationId, provider: "discord", workspaces: servers }),
			Message.ClickedWorkspace({ workspace: servers[1]! }),
			Message.SucceededPrepare({
				organizationId,
				workspaceId: "2",
				syncConnectionId,
				channels: [general],
			}),
		).model
		const back = update(picking, Message.ClickedBack())
		expect(back.model.phase).toMatchObject({ _tag: "PickingWorkspace", workspaces: servers })
		expect(back.commands ?? []).toEqual([])
	})

	test("a refused OAuth says why, on the step that retries it", () => {
		const refused = update(
			fresh(),
			Message.ProviderRefused({ provider: "slack", errorCode: "token_exchange_failed" }),
		)
		expect(refused.model.phase).toMatchObject({ _tag: "NeedsAuthorization", provider: "slack" })
		expect(refused.outcome).toMatchObject({ _tag: "Toast", toast: { title: "Couldn't connect Slack" } })
	})
})
