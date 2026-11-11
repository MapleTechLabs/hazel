// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { NotValidated } from "foldkit/fieldValidation"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, organizationId, storyUpdate, uuid } from "../../../../test/pages-fixtures"
import {
	ConnectApiKey,
	Disconnect,
	GetOAuthUrl,
	GetT3CodeLink,
	StartT3CodeConnect,
	UpdateT3CodeSharing,
} from "./command"
import { Message } from "./message"
import { Activity, type Model, type T3CodeLink, T3CodeState } from "./model"
import { init, update } from "./update"

/** The integration detail update: organization gating, config toggles and request guards. */

const shared = makeShared()
const run = storyUpdate(update, shared)
const pageFor = (integrationId: string) =>
	init({
		_tag: "SettingsIntegration",
		orgSlug: "hazel",
		integrationId,
		connectionStatus: Option.none(),
		errorCode: Option.none(),
	}).model
const linear = pageFor("linear")

describe("integration detail update", () => {
	test("nothing is requested while the organization is unknown, or for an unknown provider", () => {
		const signedOut = storyUpdate(update, makeShared({ organization: null }))
		story(
			signedOut,
			given(linear),
			message(Message.ClickedConnect()),
			message(Message.ClickedDisconnect()),
			Command.expectNone(),
		)
		story(run, given(pageFor("figma-nope")), message(Message.ClickedConnect()), Command.expectNone())
	})

	test("config toggles add and remove their option", () => {
		story(
			run,
			given(linear),
			message(Message.ToggledConfigOption({ optionId: "auto-link", isSelected: true })),
			message(Message.ToggledConfigOption({ optionId: "notifications", isSelected: true })),
			message(Message.ToggledConfigOption({ optionId: "auto-link", isSelected: false })),
			model((current) => expect(current.enabledOptionIds).toEqual(["notifications"])),
		)
	})

	test("submitting an untouched API key form sends nothing and shows why", () => {
		story(
			run,
			given(pageFor("craft")),
			message(Message.SubmittedApiKeyForm()),
			Command.expectNone(),
			model((current) => {
				expect(current.activity).toEqual(Activity.Idle())
				expect(current.apiToken).toEqual({
					_tag: "Invalid",
					value: "",
					errors: ["Bearer token is required"],
				})
				expect(current.apiBaseUrl).toEqual({
					_tag: "Invalid",
					value: "",
					errors: ["Base URL is required"],
				})
			}),
		)
	})

	test("a blank token or a base URL that is not a URL sends nothing", () => {
		story(
			run,
			given({
				...pageFor("craft"),
				apiToken: NotValidated({ value: "secret" }),
				apiBaseUrl: NotValidated({ value: "   " }),
			}),
			message(Message.SubmittedApiKeyForm()),
			Command.expectNone(),
			message(Message.ChangedApiBaseUrl({ value: "craft.test/api" })),
			message(Message.SubmittedApiKeyForm()),
			Command.expectNone(),
			model((current) =>
				expect(current.apiBaseUrl).toEqual({
					_tag: "Invalid",
					value: "craft.test/api",
					errors: ["Enter a full URL starting with https://"],
				}),
			),
			message(Message.ChangedApiToken({ value: "  " })),
			model((current) => expect(current.apiToken._tag).toBe("Invalid")),
		)
	})

	test("a second Connect while connecting sends nothing", () => {
		story(
			run,
			given(linear),
			message(Message.ClickedConnect()),
			Command.resolve(GetOAuthUrl, Message.FailedGetOAuthUrl({ reason: "Offline" })),
		)
		expect(
			update({ ...linear, activity: Activity.Connecting() }, Message.ClickedConnect(), shared)
				.commands ?? [],
		).toHaveLength(0)
	})

	test("a second Disconnect while disconnecting sends nothing", () => {
		story(
			run,
			given(linear),
			message(Message.ClickedDisconnect()),
			Command.resolve(Disconnect, Message.SucceededDisconnect()),
		)
		expect(
			update({ ...linear, activity: Activity.Disconnecting() }, Message.ClickedDisconnect(), shared)
				.commands ?? [],
		).toHaveLength(0)
	})

	test("a second API key submit while connecting sends nothing", () => {
		const filled = {
			...pageFor("craft"),
			apiToken: NotValidated({ value: "secret" }),
			apiBaseUrl: NotValidated({ value: " https://craft.test/api " }),
		}
		story(
			run,
			given(filled),
			message(Message.SubmittedApiKeyForm()),
			Command.expectExact(
				ConnectApiKey({
					orgId: organizationId,
					provider: "craft",
					token: "secret",
					baseUrl: "https://craft.test/api",
				}),
			),
			Command.resolve(ConnectApiKey, Message.SucceededConnectApiKey({ externalAccountName: null })),
		)
		expect(
			update({ ...filled, activity: Activity.Connecting() }, Message.SubmittedApiKeyForm(), shared)
				.commands ?? [],
		).toHaveLength(0)
	})
})

describe("T3 Code update", () => {
	const graceId = Schema.decodeSync(UserId)(uuid(21))
	const link: T3CodeLink = {
		environmentLabel: "ada-macbook",
		environmentUrl: "https://ada-macbook.t3.chat",
		status: "active",
		connectedAtMs: 0,
		expiresAtMs: null,
		sharing: { mode: "private", userIds: [] },
	}
	const linked = { ...pageFor("t3code"), t3Code: T3CodeState.Loaded({ link }) }
	const organizationWide = { mode: "organization" as const, userIds: [] }
	const members = { mode: "members" as const, userIds: [graceId] }

	test("an older sharing save's result is ignored; the latest one wins", () => {
		// Two saves in flight: the second pick is sent before the first settles.
		const step = (current: Model, next: Message) => update(current, next, shared).model
		const first = step(linked, Message.ChangedSharingMode({ mode: "organization" }))
		const second = update(
			first,
			Message.ToggledSharingMember({ userId: graceId, isSelected: true }),
			shared,
		)
		expect(second.commands?.map((command) => command.args)).toEqual([
			{ orgId: organizationId, requestId: 2, sharing: members },
		])
		const staleSuccess = step(
			second.model,
			Message.SucceededUpdateSharing({ requestId: 1, link: { ...link, sharing: organizationWide } }),
		)
		expect(staleSuccess.sharingSave).toBe("Saving")
		expect(staleSuccess.t3Code).toEqual(T3CodeState.Loaded({ link: { ...link, sharing: members } }))
		expect(
			update(staleSuccess, Message.FailedUpdateSharing({ requestId: 1, reason: "Offline" }), shared),
		).toEqual({ model: staleSuccess })
		const latest = step(
			staleSuccess,
			Message.SucceededUpdateSharing({ requestId: 2, link: { ...link, sharing: members } }),
		)
		expect(latest.sharingSave).toBe("Saved")
	})

	test("a refetch during a save keeps the member's pick on screen", () => {
		const saving = update(linked, Message.ChangedSharingMode({ mode: "organization" }), shared).model
		const refetched = update(saving, Message.SucceededGetT3CodeLink({ link }), shared).model
		expect(refetched.t3Code).toEqual(T3CodeState.Loaded({ link: { ...link, sharing: organizationWide } }))
	})

	test("picking the mode already saved sends nothing", () => {
		story(
			run,
			given(linked),
			message(Message.ChangedSharingMode({ mode: "private" })),
			Command.expectNone(),
		)
	})

	test("unchecking a member saves the rest", () => {
		const withGrace = { ...linked, t3Code: T3CodeState.Loaded({ link: { ...link, sharing: members } }) }
		story(
			run,
			given(withGrace),
			message(Message.ToggledSharingMember({ userId: graceId, isSelected: false })),
			Command.expectExact(
				UpdateT3CodeSharing({
					orgId: organizationId,
					requestId: 1,
					sharing: { mode: "members", userIds: [] },
				}),
			),
			Command.resolve(UpdateT3CodeSharing, Message.SucceededUpdateSharing({ requestId: 1, link })),
		)
	})

	test("nothing is requested while the organization is unknown", () => {
		const signedOut = storyUpdate(update, makeShared({ organization: null }))
		story(
			signedOut,
			given({ ...linked, environmentUrl: NotValidated({ value: "https://ada-macbook.t3.chat" }) }),
			message(Message.ChangedT3CodeRow()),
			message(Message.ClickedReconnectT3Code()),
			message(Message.ChangedSharingMode({ mode: "organization" })),
			Command.expectNone(),
		)
	})

	test("a second Connect while connecting sends nothing", () => {
		const connecting = { ...linked, activity: Activity.Connecting() }
		expect(update(connecting, Message.ClickedReconnectT3Code(), shared).commands ?? []).toHaveLength(0)
		story(
			run,
			given(linked),
			message(Message.ClickedReconnectT3Code()),
			Command.expectExact(
				StartT3CodeConnect({ orgId: organizationId, environmentUrl: "https://ada-macbook.t3.chat" }),
			),
			Command.resolve(StartT3CodeConnect, Message.FailedStartT3CodeConnect({ reason: "Offline" })),
			model((current) => expect(current.activity).toEqual(Activity.Idle())),
		)
	})

	test("a failed first load offers a retry; a failed refresh keeps the link", () => {
		story(
			run,
			given(pageFor("t3code")),
			message(Message.FailedGetT3CodeLink({ reason: "Offline" })),
			model((current) => expect(current.t3Code).toEqual(T3CodeState.Failed())),
			message(Message.ClickedRetryT3CodeLink()),
			Command.expectExact(GetT3CodeLink({ orgId: organizationId })),
			Command.resolve(GetT3CodeLink, Message.SucceededGetT3CodeLink({ link })),
			message(Message.FailedGetT3CodeLink({ reason: "Offline" })),
			model((current) => expect(current.t3Code).toEqual(T3CodeState.Loaded({ link }))),
		)
	})
})
