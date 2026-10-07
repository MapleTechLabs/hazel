// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Option, Schema } from "effect"
import {
	click,
	Command,
	expect as expectView,
	expectOutMessage,
	given,
	placeholder,
	role,
	scene,
	submit,
	Subscription,
	text,
	type as typeInto,
} from "foldkit/scene"
import * as Story from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, successToast } from "../shared/exit-toast"
import { AcknowledgeOAuthCallback, ConnectApiKey, Disconnect } from "./command"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"
import { sharedDefaults } from "../../../test-shared"

const orgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000001")
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
}

const config = {
	update: (model: Model, next: Message) => update(model, next, shared),
	view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared }, h),
}
/** The route, with the OAuth callback redirect's `?connection_status=&error_code=` when given. */
const pageFor = (integrationId: string, callback?: { status: string; errorCode?: string }) =>
	init({
		_tag: "SettingsIntegration",
		orgSlug: "hazel",
		integrationId,
		connectionStatus: Option.fromNullishOr(callback?.status),
		errorCode: Option.fromNullishOr(callback?.errorCode),
	})

describe("integration detail page", () => {
	test("a failed OAuth callback toasts the mapped error, then clears the search params", () => {
		const page = pageFor("linear", { status: "error", errorCode: "token_exchange_failed" })
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: errorToast(
					"Failed to connect to Linear",
					"Could not authenticate with the provider. Please try again.",
				),
			}),
		)
		expect(page.commands?.map((command) => command.name)).toEqual([AcknowledgeOAuthCallback.name])
		Story.story(
			config.update,
			Story.given(page.model),
			Story.message(Message.AcknowledgedOAuthCallback()),
			Story.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					href: "/hazel/settings/integrations/linear",
					replace: true,
				}),
			),
		)
	})

	test("a successful callback verifies until the connection syncs in", () => {
		scene(
			config,
			given(pageFor("linear", { status: "success" }).model),
			expectView(text("Verifying connection...")).toExist(),
			Subscription.emit(
				Message.UpdatedConnection({
					connection: {
						provider: "linear",
						isActive: true,
						externalAccountName: "Hazel Labs",
						hasInstallationId: false,
					},
				}),
			),
			expectView(text("Hazel Labs")).toExist(),
			click(role("button", { name: "Disconnect" })),
			Command.expectExact(Disconnect({ orgId, provider: "linear" })),
			expectView(role("button", { name: "Disconnecting..." })).toBeDisabled(),
			Command.resolve(Disconnect, Message.CompletedDisconnect({ toast: null })),
			expectView(role("button", { name: "Disconnect" })).toBeEnabled(),
		)
	})

	test("the API key form submits the trimmed credentials", () => {
		scene(
			config,
			given(pageFor("craft").model),
			expectView(role("button", { name: "Connect" })).toBeDisabled(),
			typeInto(placeholder("Enter your API token"), " secret "),
			typeInto(placeholder("https://connect.craft.do/links/{linkId}/api/v1"), "https://craft.test/api"),
			submit("form"),
			Command.expectExact(
				ConnectApiKey({
					orgId,
					provider: "craft",
					token: "secret",
					baseUrl: "https://craft.test/api",
				}),
			),
			Command.resolve(ConnectApiKey, Message.SucceededConnectApiKey({ externalAccountName: "Docs" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: successToast("Connected to Craft", "Connected as Docs."),
				}),
			),
		)
	})

	test("a successful callback toasts the connection and verifies it", () => {
		const page = pageFor("linear", { status: "success" })
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: successToast("Connected to Linear", "Your account has been successfully connected."),
			}),
		)
		expect(page.model.pendingVerification).toBe(true)
	})

	test("no callback params, or an unknown status, show nothing", () => {
		expect(pageFor("linear").commands ?? []).toEqual([])
		expect(pageFor("linear", { status: "pending" }).outMessage).toBeUndefined()
	})

	test("the back link returns to the integrations list", () => {
		scene(
			config,
			given(pageFor("linear").model),
			click(role("button", { name: "Back to integrations" })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/integrations", replace: false }),
			),
		)
	})
})
