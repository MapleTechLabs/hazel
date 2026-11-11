// @vitest-environment jsdom
import { routeOfPath } from "../../../route"
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import { init, routeChanged } from "./update"

/** The Discord and Slack link callback comes in through the route's typed search params. */

const routeWith = (search: { status?: string; provider?: string; errorCode?: string }) => ({
	_tag: "MySettingsLinkedAccounts" as const,
	orgSlug: "hazel",
	connectionStatus: Option.fromNullishOr(search.status),
	provider: Option.fromNullishOr(search.provider),
	errorCode: Option.fromNullishOr(search.errorCode),
})

describe("linked accounts callback", () => {
	test("a successful Discord link toasts, then cleans the URL", () => {
		const page = init(routeWith({ status: "success", provider: "discord" }))
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/my-settings/linked-accounts"),
				replace: true,
				toast: { intent: "success", title: "Discord account linked", description: null },
			}),
		)
		expect(page.commands).toBeUndefined()
	})

	test("a failed link explains a known error code in words", () => {
		const page = init(routeWith({ status: "error", provider: "discord", errorCode: "db_error" }))
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/my-settings/linked-accounts"),
				replace: true,
				toast: {
					intent: "error",
					title: "Failed to link Discord account",
					description: "A database error occurred. Please try again.",
				},
			}),
		)
	})

	test("an unknown error code never reaches the toast", () => {
		const page = init(routeWith({ status: "error", provider: "discord", errorCode: "<script>" }))
		expect(page.outMessage).toMatchObject({
			toast: {
				intent: "error",
				title: "Failed to link Discord account",
				description: "Please try again.",
			},
		})
	})

	test("a Slack callback names Slack", () => {
		const page = init(
			routeWith({ status: "error", provider: "slack", errorCode: "token_exchange_failed" }),
		)
		expect(page.outMessage).toMatchObject({
			toast: {
				intent: "error",
				title: "Failed to link Slack account",
				description: "Could not authenticate with Slack. Please try again.",
			},
		})
		expect(init(routeWith({ status: "success", provider: "slack" })).outMessage).toMatchObject({
			toast: { intent: "success", title: "Slack account linked" },
		})
	})

	test("other providers and the cleaned URL show nothing", () => {
		const page = init(routeWith({ status: "success", provider: "github" }))
		expect(page.outMessage).toBeUndefined()
		expect(routeChanged(page.model, routeWith({})).outMessage).toBeUndefined()
	})
})
