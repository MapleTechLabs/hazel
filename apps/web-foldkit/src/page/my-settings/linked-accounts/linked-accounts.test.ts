// @vitest-environment jsdom
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import { ShowLinkResult } from "./command"
import { init, routeChanged } from "./update"

/** The Discord link callback comes in through the route's typed search params. */

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
			PageOutMessage.RequestedToast({
				toast: { intent: "success", title: "Discord account linked", description: null },
			}),
		)
		expect(page.commands?.map((command) => command.name)).toEqual([ShowLinkResult.name])
	})

	test("a failed link shows the error code", () => {
		const page = init(routeWith({ status: "error", provider: "discord", errorCode: "db_error" }))
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: { intent: "error", title: "Failed to link Discord account", description: "db_error" },
			}),
		)
	})

	test("other providers and the cleaned URL show nothing", () => {
		const page = init(routeWith({ status: "success", provider: "github" }))
		expect(page.outMessage).toBeUndefined()
		expect(routeChanged(page.model, routeWith({})).outMessage).toBeUndefined()
	})
})
