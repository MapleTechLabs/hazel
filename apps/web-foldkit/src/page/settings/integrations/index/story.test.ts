// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { currentUser, makeShared } from "../../../../test/pages-fixtures"
import { Message } from "./message"
import { init, ListOrganizationWebhooks, sharedChanged, update } from "./update"

/** The integrations catalog's webhook query: once per page, after the user's organization is known. */

const route = { _tag: "SettingsIntegrations", orgSlug: "hazel" } as const
const shared = makeShared()
const noOrganization = makeShared({ currentUser: { ...currentUser, organizationId: null } })

describe("webhook providers", () => {
	test("the query waits for the organization, then runs once", () => {
		const waiting = init(route, noOrganization)
		expect(waiting.commands ?? []).toHaveLength(0)
		const ready = sharedChanged(waiting.model, shared)
		expect(ready.commands?.map((command) => command.name)).toEqual([ListOrganizationWebhooks.name])
		expect(sharedChanged(ready.model, shared).commands ?? []).toHaveLength(0)
	})

	test("webhook names become lower-cased, de-duplicated providers", () => {
		story(
			update,
			given(init(route, noOrganization).model),
			message(Message.SucceededListWebhooks({ names: ["Railway", "railway", "OpenStatus"] })),
			Command.expectNone(),
			model((current) => expect(current.webhookProviders).toEqual(["railway", "openstatus"])),
		)
	})

	test("a failed webhook query leaves no providers", () => {
		story(
			update,
			given(init(route, noOrganization).model),
			message(Message.FailedListWebhooks()),
			model((current) => expect(current.webhookProviders).toEqual([])),
		)
	})
})
