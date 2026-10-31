// @vitest-environment jsdom
import { routeOfPath } from "../../../../route"
import { OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import {
	click,
	Command,
	expect as expectView,
	expectOutMessage,
	given,
	label,
	placeholder,
	role,
	scene,
	submit,
	Subscription,
	text,
	Mount,
	selector,
	type as typeInto,
	within,
} from "foldkit/scene"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, reasonToast, successToast } from "../../../../data/actions"
import {
	ConnectApiKey,
	Disconnect,
	DisconnectT3Code,
	GetOAuthUrl,
	GetT3CodeLink,
	RedirectToProvider,
	StartT3CodeConnect,
	UpdateT3CodeSharing,
} from "./command"
import { Message } from "./message"
import { Activity, type Model, type T3CodeLink, T3CodeState } from "./model"
import { init, update } from "./update"
import { view } from "./view"
import { sharedDefaults } from "../../../test-shared"
import * as Modal from "../../../../ui/modal"
import {
	makeShared,
	organizationId,
	pageScene,
	portalModalMounted,
	uuid,
} from "../../../../test/pages-fixtures"

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
	test("a failed OAuth callback toasts the mapped error with the navigation that clears the search params", () => {
		const page = pageFor("linear", { status: "error", errorCode: "token_exchange_failed" })
		expect(page.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/settings/integrations/linear"),
				replace: true,
				toast: errorToast(
					"Failed to connect to Linear",
					"Could not authenticate with the provider. Please try again.",
				),
			}),
		)
		expect(page.commands ?? []).toEqual([])
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
			Command.resolve(Disconnect, Message.SucceededDisconnect()),
			expectView(role("button", { name: "Disconnect" })).toBeEnabled(),
			Subscription.emit(
				Message.UpdatedConnection({
					connection: {
						provider: "linear",
						isActive: false,
						externalAccountName: "Hazel Labs",
						hasInstallationId: false,
					},
				}),
			),
			// The verification ended when the connection went active; it does not come back.
			expectView(text("Verifying connection...")).toBeAbsent(),
		)
	})

	test("the API key form submits the trimmed credentials", () => {
		scene(
			config,
			given(pageFor("craft").model),
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
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/settings/integrations/linear"),
				replace: true,
				toast: successToast("Connected to Linear", "Your account has been successfully connected."),
			}),
		)
		expect(page.model.activity).toEqual(Activity.Verifying())
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
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/integrations"),
					replace: false,
				}),
			),
		)
	})
})

describe("integration detail flows", () => {
	const linear = {
		provider: "linear",
		isActive: true,
		externalAccountName: "Hazel Labs",
		hasInstallationId: false,
	}

	test("Connect fetches the OAuth URL, then redirects to the provider", () => {
		scene(
			config,
			given(pageFor("linear").model),
			click(role("button", { name: /Connect with Linear$/ })),
			Command.expectExact(GetOAuthUrl({ orgId, provider: "linear" })),
			expectView(role("button", { name: /Connecting\.\.\.$/ })).toBeDisabled(),
			Command.resolve(
				GetOAuthUrl,
				Message.SucceededGetOAuthUrl({ authorizationUrl: "https://linear.app/oauth" }),
			),
			Command.expectExact(RedirectToProvider({ authorizationUrl: "https://linear.app/oauth" })),
			Command.resolve(RedirectToProvider, Message.CompletedRedirectToProvider()),
		)
	})

	test("a failed OAuth URL toasts and re-enables Connect", () => {
		scene(
			config,
			given(pageFor("linear").model),
			click(role("button", { name: /Connect with Linear$/ })),
			Command.resolve(GetOAuthUrl, Message.FailedGetOAuthUrl({ reason: "Offline" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
			expectView(role("button", { name: /Connect with Linear$/ })).toBeEnabled(),
		)
	})

	test("a failed disconnect toasts and keeps the connection", () => {
		const failure = errorToast("Integration not connected", "This integration is already disconnected.")
		scene(
			config,
			given({ ...pageFor("linear").model, connection: linear }),
			click(role("button", { name: "Disconnect" })),
			Command.resolve(Disconnect, Message.FailedDisconnect({ reason: "NotConnected" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failure })),
			expectView(text("Hazel Labs")).toExist(),
			expectView(role("button", { name: "Disconnect" })).toBeEnabled(),
		)
	})

	test("submitting an empty API key form shows each field's error and sends nothing", () => {
		scene(
			config,
			given(pageFor("craft").model),
			submit("form"),
			Command.expectNone(),
			expectView(text("Bearer token is required")).toExist(),
			expectView(text("Base URL is required")).toExist(),
			expectView(role("button", { name: /Connect$/ })).toBeDisabled(),
		)
	})

	test("invalid fields show their error and block Connect until fixed; a failure re-enables it", () => {
		const failure = errorToast(
			"Invalid credentials",
			"Check the bearer token and base URL, then try again.",
		)
		scene(
			config,
			given(pageFor("craft").model),
			typeInto(label("Bearer Token"), "   "),
			expectView(text("Bearer token is required")).toExist(),
			typeInto(label("Base URL"), "craft.test/api"),
			expectView(text("Enter a full URL starting with https://")).toExist(),
			expectView(role("button", { name: /Connect$/ })).toBeDisabled(),
			typeInto(label("Bearer Token"), "secret"),
			typeInto(label("Base URL"), "https://craft.test/api"),
			expectView(text("Enter a full URL starting with https://")).toBeAbsent(),
			expectView(role("button", { name: /Connect$/ })).toBeEnabled(),
			click(role("button", { name: /Connect$/ })),
			Command.expectHas(ConnectApiKey),
			expectView(role("button", { name: /Connecting\.\.\.$/ })).toBeDisabled(),
			Command.resolve(ConnectApiKey, Message.FailedConnectApiKey({ reason: "InvalidApiKey" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failure })),
			expectView(role("button", { name: /Connect$/ })).toBeEnabled(),
		)
	})
})

describe("T3 Code", () => {
	const nowMs = Date.UTC(2026, 9, 31, 12)
	const DAY = 24 * 60 * 60 * 1000
	const t3Shared = makeShared({ nowMs })
	const t3 = pageScene(update, view, t3Shared)
	const graceId = Schema.decodeSync(UserId)(uuid(21))
	const linusId = Schema.decodeSync(UserId)(uuid(22))
	const members = [
		{ userId: graceId, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
		{ userId: linusId, name: "Linus Torvalds", email: "linus@hazel.test", avatarUrl: null },
	]
	const link: T3CodeLink = {
		environmentLabel: "ada-macbook",
		environmentUrl: "https://ada-macbook.t3.chat",
		status: "active",
		connectedAtMs: nowMs - 2 * DAY,
		expiresAtMs: nowMs + 28 * DAY,
		sharing: { mode: "private", userIds: [] },
	}
	const page = pageFor("t3code").model
	const loaded = (shown: T3CodeLink | null) => ({
		...page,
		t3Code: T3CodeState.Loaded({ link: shown }),
		t3CodeMembers: members,
	})
	const formatted = (ms: number) =>
		new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
	const dialog = role("dialog")
	const sharingRadio = (mode: string) => selector(`#t3code-sharing-${mode}`)

	test("the link loads when its row syncs; with none, the form explains the per-member link", () => {
		scene(
			t3,
			given(page),
			expectView(text("Loading your link...")).toExist(),
			Subscription.emit(Message.ChangedT3CodeRow()),
			Command.expectExact(GetT3CodeLink({ orgId: organizationId })),
			Command.resolve(GetT3CodeLink, Message.SucceededGetT3CodeLink({ link: null })),
			expectView(text("Link your T3 Code environment")).toExist(),
			expectView(text(/Copy MCP URL/)).toExist(),
			expectView(text("The link is yours alone: each member links their own machine.")).toExist(),
			expectView(text("Not connected")).toExist(),
		)
	})

	test("Connect sends the trimmed address and redirects to T3's sign-in", () => {
		scene(
			t3,
			given(loaded(null)),
			typeInto(label("Environment address"), "  https://ada-macbook.t3.chat/mcp "),
			click(role("button", { name: /Connect$/ })),
			Command.expectExact(
				StartT3CodeConnect({
					orgId: organizationId,
					environmentUrl: "https://ada-macbook.t3.chat/mcp",
				}),
			),
			expectView(role("button", { name: /Connecting\.\.\.$/ })).toBeDisabled(),
			Command.resolve(
				StartT3CodeConnect,
				Message.SucceededGetOAuthUrl({
					authorizationUrl: "https://ada-macbook.t3.chat/oauth/authorize",
				}),
			),
			Command.expectExact(
				RedirectToProvider({ authorizationUrl: "https://ada-macbook.t3.chat/oauth/authorize" }),
			),
			Command.resolve(RedirectToProvider, Message.CompletedRedirectToProvider()),
		)
	})

	test("an address that is not a T3 Code environment shows the server's reason under the input", () => {
		scene(
			t3,
			given(loaded(null)),
			submit("form"),
			Command.expectNone(),
			expectView(text("Environment address is required")).toExist(),
			typeInto(label("Environment address"), "http://localhost:3773"),
			click(role("button", { name: /Connect$/ })),
			Command.resolve(
				StartT3CodeConnect,
				Message.RejectedT3CodeEnvironment({ message: "The environment address must use https." }),
			),
			expectView(text("The environment address must use https.")).toExist(),
			expectView(label("Environment address")).toHaveAttr("aria-invalid", "true"),
			expectView(role("button", { name: /Connect$/ })).toBeEnabled(),
			// Editing clears the server's message.
			typeInto(label("Environment address"), "https://ada-macbook.t3.chat"),
			expectView(text("The environment address must use https.")).toBeAbsent(),
		)
	})

	test("a linked environment shows its label, address and dates, with no warning", () => {
		scene(
			t3,
			given(loaded(link)),
			expectView(text("ada-macbook")).toExist(),
			expectView(text("https://ada-macbook.t3.chat")).toExist(),
			expectView(text(formatted(link.connectedAtMs))).toExist(),
			expectView(text(formatted(nowMs + 28 * DAY))).toExist(),
			expectView(text("Connected")).toExist(),
			expectView(text("Your T3 Code sign-in expires soon")).toBeAbsent(),
			expectView(role("button", { name: "Reconnect" })).toBeAbsent(),
			expectView(text(/Settings → Sharing & access/)).toExist(),
		)
	})

	test("a sign-in that expires within 3 days warns and offers Reconnect with the same address", () => {
		scene(
			t3,
			given(loaded({ ...link, expiresAtMs: nowMs + 2 * DAY })),
			expectView(text("Your T3 Code sign-in expires soon")).toExist(),
			click(role("button", { name: "Reconnect" })),
			Command.expectExact(
				StartT3CodeConnect({ orgId: organizationId, environmentUrl: "https://ada-macbook.t3.chat" }),
			),
			expectView(role("button", { name: /Redirecting\.\.\.$/ })).toBeDisabled(),
			Command.resolve(StartT3CodeConnect, Message.FailedStartT3CodeConnect({ reason: "Offline" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
		)
	})

	test("an expired link warns and reconnects; a lapsed active link reads as expired too", () => {
		scene(
			t3,
			given(loaded({ ...link, status: "expired" })),
			expectView(text("Your T3 Code sign-in expired")).toExist(),
			expectView(text("Not connected")).toExist(),
			click(role("button", { name: "Reconnect" })),
			Command.expectExact(
				StartT3CodeConnect({ orgId: organizationId, environmentUrl: "https://ada-macbook.t3.chat" }),
			),
			Command.resolve(
				StartT3CodeConnect,
				Message.RejectedT3CodeEnvironment({ message: "The environment did not answer." }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Could not reach your T3 Code environment",
						"The environment did not answer.",
					),
				}),
			),
		)
		scene(
			t3,
			given(loaded({ ...link, expiresAtMs: nowMs - DAY })),
			expectView(text("Your T3 Code sign-in expired")).toExist(),
		)
		scene(
			t3,
			given(loaded({ ...link, status: "revoked" })),
			expectView(text("Access was revoked in T3 Code")).toExist(),
			expectView(role("button", { name: "Reconnect" })).toExist(),
		)
	})

	test("Disconnect asks first, then unlinks", () => {
		scene(
			t3,
			given(loaded(link)),
			click(role("button", { name: "Disconnect" })),
			portalModalMounted,
			expectView(within(dialog, text("ada-macbook"))).toExist(),
			click(within(dialog, role("button", { name: "Disconnect" }))),
			Command.expectExact(DisconnectT3Code({ orgId: organizationId })),
			Command.resolve(DisconnectT3Code, Message.SucceededDisconnectT3Code()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("T3 Code unlinked") })),
			expectView(text("Link your T3 Code environment")).toExist(),
			Mount.expectEnded(Modal.AcquireResources),
		)
	})

	test("sharing with the organization saves at once and shows the save", () => {
		scene(
			t3,
			given(loaded(link)),
			expectView(sharingRadio("private")).toBeChecked(),
			expectView(text(/runs agents on your machine/)).toExist(),
			click(text("Everyone in this organization")),
			Command.expectExact(
				UpdateT3CodeSharing({
					orgId: organizationId,
					requestId: 1,
					sharing: { mode: "organization", userIds: [] },
				}),
			),
			expectView(sharingRadio("organization")).toBeChecked(),
			expectView(text("Saving...")).toExist(),
			Command.resolve(
				UpdateT3CodeSharing,
				Message.SucceededUpdateSharing({
					requestId: 1,
					link: { ...link, sharing: { mode: "organization", userIds: [] } },
				}),
			),
			expectView(text("Saved")).toExist(),
		)
	})

	test("specific members: the picker lists the other members, filters, and saves each pick", () => {
		scene(
			t3,
			given(loaded(link)),
			expectView(text("Grace Hopper")).toBeAbsent(),
			click(text("Specific members")),
			Command.resolve(
				UpdateT3CodeSharing,
				Message.SucceededUpdateSharing({
					requestId: 1,
					link: { ...link, sharing: { mode: "members", userIds: [] } },
				}),
			),
			expectView(text("No one else yet: pick the members who may drive it.")).toExist(),
			expectView(text("Grace Hopper")).toExist(),
			expectView(text("Linus Torvalds")).toExist(),
			click(text("Grace Hopper")),
			Command.expectExact(
				UpdateT3CodeSharing({
					orgId: organizationId,
					requestId: 2,
					sharing: { mode: "members", userIds: [graceId] },
				}),
			),
			expectView(role("checkbox", { name: /Grace Hopper/ })).toBeChecked(),
			expectView(text("1 member may drive it.")).toExist(),
			Command.resolve(
				UpdateT3CodeSharing,
				Message.SucceededUpdateSharing({
					requestId: 2,
					link: { ...link, sharing: { mode: "members", userIds: [graceId] } },
				}),
			),
			typeInto(placeholder("Search members..."), "linus"),
			expectView(text("Grace Hopper")).toBeAbsent(),
			expectView(text("Linus Torvalds")).toExist(),
		)
	})

	test("a failed sharing save toasts and reloads the saved sharing", () => {
		scene(
			t3,
			given(loaded(link)),
			click(text("Everyone in this organization")),
			Command.resolve(
				UpdateT3CodeSharing,
				Message.FailedUpdateSharing({ requestId: 1, reason: "Offline" }),
			),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
			Command.expectExact(GetT3CodeLink({ orgId: organizationId })),
			Command.resolve(GetT3CodeLink, Message.SucceededGetT3CodeLink({ link })),
			expectView(sharingRadio("private")).toBeChecked(),
		)
	})

	test("the sign-in callback toasts its result; a denied sign-in says so", () => {
		expect(pageFor("t3code", { status: "error", errorCode: "denied" }).outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/settings/integrations/t3code"),
				replace: true,
				toast: errorToast(
					"Failed to connect to T3 Code",
					"The sign-in was cancelled. Please try again.",
				),
			}),
		)
		scene(
			t3,
			given({ ...pageFor("t3code", { status: "success" }).model, t3CodeMembers: members }),
			Subscription.emit(Message.ChangedT3CodeRow()),
			Command.resolve(GetT3CodeLink, Message.SucceededGetT3CodeLink({ link })),
			expectView(text("Verifying connection...")).toBeAbsent(),
			expectView(text("ada-macbook")).toExist(),
		)
	})
})
