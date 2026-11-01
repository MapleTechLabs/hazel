import type { T3CodeSharingMode } from "@hazel/domain/http"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Integration } from "~/lib/integrations/__data"
import { IconWarning } from "../../../../icons"
import { avatar } from "../../../../ui/avatar"
import { button } from "../../../../ui/button"
import { checkbox } from "../../../../ui/checkbox"
import { input, inputGroup } from "../../../../ui/input"
import { radioGroup } from "../../../../ui/radio"
import { confirmDialog } from "../../chat-sync/confirm-dialog"
import type * as ConfirmAction from "../../../shared/confirm-action"
import { CHECK, spinner, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model, T3CodeLink, T3CodeMember } from "./model"
import { apiField, centered, LINK_ICON, panel, verifyingState } from "./view-connection"

/**
 * T3 Code's connection and sharing panels. Unlike the other integrations the link is the member's own:
 * each member links their machine's environment, and chooses who else may drive it.
 */

type H = HtmlBuilder<Message>

const DAY_MS = 24 * 60 * 60 * 1000

/** T3 sign-ins last 30 days with no refresh: warn this close to the end. */
export const EXPIRY_WARNING_MS = 3 * DAY_MS

const formatDate = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

/** The link's status as of `nowMs`: an active link whose credential has lapsed reads as expired. */
export const effectiveStatus = (link: T3CodeLink, nowMs: number): T3CodeLink["status"] =>
	link.status === "active" && link.expiresAtMs !== null && link.expiresAtMs <= nowMs
		? "expired"
		: link.status

export const isExpiringSoon = (link: T3CodeLink, nowMs: number) =>
	effectiveStatus(link, nowMs) === "active" &&
	link.expiresAtMs !== null &&
	link.expiresAtMs - nowMs < EXPIRY_WARNING_MS

const REVOKE_NOTE = "You can also revoke Hazel's access in T3 Code under Settings → Sharing & access."

const callout = (h: H, tone: "warning" | "danger", title: string, body: ReadonlyArray<Html | string>) =>
	h.div(
		[
			h.Role("status"),
			h.Class(
				`flex gap-3 rounded-lg border p-3 ${
					tone === "warning"
						? "border-warning/20 bg-warning-subtle text-warning-subtle-fg"
						: "border-danger/15 bg-danger/5 text-danger"
				}`,
			),
		],
		[
			IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }),
			h.div(
				[h.Class("flex flex-col gap-0.5 text-sm")],
				[h.p([h.Class("font-medium")], [title]), h.p([h.Class("opacity-90")], [...body])],
			),
		],
	)

const notLinked = (h: H, integration: Integration, model: Model): Html => {
	const isConnecting = model.activity._tag === "Connecting"
	return h.form(
		[h.Class("flex flex-col gap-5 py-1"), h.OnSubmit(Message.SubmittedEnvironmentForm())],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.p([h.Class("font-medium text-fg text-sm")], ["Link your T3 Code environment"]),
					h.p(
						[h.Class("text-muted-fg text-sm leading-relaxed")],
						[
							"Drive T3 Code threads on your machine from Hazel with /t3. Paste your environment's T3 Connect address or its MCP URL from T3 Code → Settings → Environments → Copy MCP URL.",
						],
					),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						["The link is yours alone: each member links their own machine."],
					),
				],
			),
			apiField(h, {
				id: "t3code-environment-url",
				label: "Environment address",
				type: "url",
				placeholder: "https://my-machine.t3.chat/mcp",
				field: model.environmentUrl,
				onInput: (value) => Message.ChangedEnvironmentUrl({ value }),
				hint: ["You'll sign in to T3 Code next to approve Hazel."],
			}),
			button(
				h,
				{
					intent: "primary",
					size: "md",
					className: "self-start",
					isDisabled: isConnecting,
					attributes: [h.Type("submit")],
				},
				isConnecting ? [spinner(h, "size-4 animate-spin"), "Connecting..."] : ["Connect"],
			),
		],
	)
}

const environmentSummary = (h: H, link: T3CodeLink, isActive: boolean): Html =>
	h.div(
		[h.Class("flex min-w-0 items-center gap-3")],
		[
			h.div(
				[
					h.Class(
						`flex size-10 shrink-0 items-center justify-center rounded-xl ${
							isActive ? "bg-success-subtle" : "bg-bg-muted"
						}`,
					),
				],
				[
					isActive
						? strokeIcon(h, {
								className: "size-5 text-success-subtle-fg",
								strokeWidth: "2",
								d: CHECK,
							})
						: strokeIcon(h, {
								className: "size-5 text-muted-fg",
								strokeWidth: "1.5",
								d: LINK_ICON,
							}),
				],
			),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					h.p([h.Class("truncate font-medium text-fg text-sm")], [link.environmentLabel]),
					h.p([h.Class("truncate font-mono text-muted-fg text-xs")], [link.environmentUrl]),
				],
			),
		],
	)

const dates = (h: H, link: T3CodeLink, nowMs: number): Html =>
	h.dl(
		[h.Class("grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm")],
		[
			h.dt([h.Class("text-muted-fg")], ["Connected"]),
			h.dd([h.Class("text-fg")], [formatDate(link.connectedAtMs)]),
			...(link.expiresAtMs === null
				? []
				: [
						h.dt([h.Class("text-muted-fg")], [link.expiresAtMs <= nowMs ? "Expired" : "Expires"]),
						h.dd([h.Class("text-fg")], [formatDate(link.expiresAtMs)]),
					]),
		],
	)

const disconnectButton = (h: H, isDisconnecting: boolean): Html =>
	button(
		h,
		{
			intent: "danger",
			size: "sm",
			className: "shrink-0",
			onPress: Message.ClickedDisconnectT3Code(),
			isDisabled: isDisconnecting,
		},
		[isDisconnecting ? "Disconnecting..." : "Disconnect"],
	)

const reconnectButton = (h: H, isConnecting: boolean, intent: "primary" | "secondary"): Html =>
	button(
		h,
		{
			intent,
			size: "sm",
			className: "shrink-0",
			onPress: Message.ClickedReconnectT3Code(),
			isDisabled: isConnecting,
		},
		isConnecting ? [spinner(h, "size-4 animate-spin"), "Redirecting..."] : ["Reconnect"],
	)

const STATUS_COPY: Record<Exclude<T3CodeLink["status"], "active">, { title: string; body: string }> = {
	expired: {
		title: "Your T3 Code sign-in expired",
		body: "Hazel can't reach this environment until you sign in again. Reconnect to keep using /t3.",
	},
	revoked: {
		title: "Access was revoked in T3 Code",
		body: "Hazel can't reach this environment until you approve it again. Reconnect to keep using /t3.",
	},
	error: {
		title: "Hazel can't reach this environment",
		body: "Reconnect to sign in to T3 Code again.",
	},
	suspended: {
		title: "This link is suspended",
		body: "Reconnect to sign in to T3 Code again.",
	},
}

const linked = (h: H, link: T3CodeLink, model: Model, nowMs: number): Html => {
	const status = effectiveStatus(link, nowMs)
	const isConnecting = model.activity._tag === "Connecting"
	const isDisconnecting = model.disconnectConfirm.state._tag === "Running"
	const isActive = status === "active"
	return h.div(
		[h.Class("flex flex-col gap-4")],
		[
			h.div(
				[h.Class("flex items-center justify-between gap-4")],
				[
					environmentSummary(h, link, isActive),
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							...(isActive && !isExpiringSoon(link, nowMs)
								? []
								: [reconnectButton(h, isConnecting, isActive ? "secondary" : "primary")]),
							disconnectButton(h, isDisconnecting),
						],
					),
				],
			),
			...(status === "active"
				? isExpiringSoon(link, nowMs) && link.expiresAtMs !== null
					? [
							callout(h, "warning", "Your T3 Code sign-in expires soon", [
								"T3 sign-ins last 30 days and can't be renewed in the background. It expires on ",
								formatDate(link.expiresAtMs),
								"; reconnect before then to keep using /t3.",
							]),
						]
					: []
				: [callout(h, "danger", STATUS_COPY[status].title, [STATUS_COPY[status].body])]),
			dates(h, link, nowMs),
			h.p([h.Class("text-muted-fg text-xs")], [REVOKE_NOTE]),
		],
	)
}

const SHARING_OPTIONS: ReadonlyArray<{ mode: T3CodeSharingMode; label: string; description: string }> = [
	{ mode: "private", label: "Only me", description: "Only you can drive this environment from Hazel." },
	{
		mode: "organization",
		label: "Everyone in this organization",
		description: "Any member can start and steer threads on your machine.",
	},
	{ mode: "members", label: "Specific members", description: "Only the members you pick below." },
]

const saveStatus = (h: H, model: Model): Html =>
	h.span(
		[h.AriaLive("polite"), h.Class("flex items-center gap-1.5 text-muted-fg text-xs")],
		model.sharingSave === "Saving"
			? [spinner(h, "size-3 animate-spin"), "Saving..."]
			: model.sharingSave === "Saved"
				? [strokeIcon(h, { className: "size-3", strokeWidth: "3", d: CHECK }), "Saved"]
				: [],
	)

const memberRow = (h: H, member: T3CodeMember, isSelected: boolean): Html =>
	h.keyed("li")(
		member.userId,
		[h.Class("px-3 py-2")],
		[
			checkbox(
				h,
				{
					id: `t3code-member-${member.userId}`,
					isSelected,
					ariaLabel: member.name,
					onChange: (selected) =>
						Message.ToggledSharingMember({ userId: member.userId, isSelected: selected }),
					className: "w-full",
				},
				[
					h.div(
						[h.Class("ml-1 flex min-w-0 items-center gap-2.5")],
						[
							avatar(h, { size: "xs", src: member.avatarUrl, seed: member.name }),
							h.span([h.Class("truncate text-fg text-sm")], [member.name]),
							h.span([h.Class("truncate text-muted-fg text-xs")], [member.email]),
						],
					),
				],
			),
		],
	)

const memberPicker = (h: H, model: Model, selected: ReadonlyArray<string>): Html => {
	const query = model.memberSearch.trim().toLowerCase()
	const members = model.t3CodeMembers.filter(
		(member) =>
			query === "" ||
			member.name.toLowerCase().includes(query) ||
			member.email.toLowerCase().includes(query),
	)
	return h.div(
		[h.Class("flex flex-col gap-2 pl-7")],
		[
			inputGroup(h, {}, [
				input(h, {
					placeholder: "Search members...",
					className: "text-sm",
					attributes: [
						h.Type("search"),
						h.AriaLabel("Search members"),
						h.Value(model.memberSearch),
						h.OnInput((value) => Message.ChangedMemberSearch({ value })),
					],
				}),
			]),
			members.length === 0
				? h.p(
						[h.Class("px-1 py-2 text-muted-fg text-sm")],
						[model.t3CodeMembers.length === 0 ? "No other members yet." : "No members match."],
					)
				: h.ul(
						[
							h.AriaLabel("Members who may drive your environment"),
							h.Class(
								"max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border",
							),
						],
						members.map((member) => memberRow(h, member, selected.includes(member.userId))),
					),
			h.p(
				[h.Class("text-muted-fg text-xs")],
				[
					selected.length === 0
						? "No one else yet: pick the members who may drive it."
						: `${selected.length} ${selected.length === 1 ? "member" : "members"} may drive it.`,
				],
			),
		],
	)
}

const sharing = (h: H, link: T3CodeLink, model: Model): Html =>
	h.div(
		[h.Class("flex flex-col gap-4")],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-4")],
				[
					h.p(
						[h.Class("text-muted-fg text-sm leading-relaxed")],
						[
							"Whoever can drive it runs agents on your machine with the access you granted T3 Code when you signed in. Every action is posted in the Hazel thread.",
						],
					),
					saveStatus(h, model),
				],
			),
			radioGroup(
				h,
				{
					id: "t3code-sharing",
					value: link.sharing.mode,
					onChange: (mode) =>
						Message.ChangedSharingMode({
							mode: SHARING_OPTIONS.find((option) => option.mode === mode)?.mode ?? "private",
						}),
				},
				(parts) => [
					parts.label(["Who can drive your environment"], { className: "sr-only" }),
					...SHARING_OPTIONS.map((option) =>
						parts.radio(option.mode, [
							h.div(
								[h.Class("flex flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], [option.label]),
									h.span([h.Class("text-muted-fg text-xs")], [option.description]),
								],
							),
						]),
					),
				],
			),
			...(link.sharing.mode === "members" ? [memberPicker(h, model, link.sharing.userIds)] : []),
		],
	)

const toDisconnectConfirmMessage = (message: ConfirmAction.Message) =>
	Message.GotDisconnectConfirmMessage({ message })

const disconnectDialog = (h: H, model: Model): Html =>
	confirmDialog(h, {
		slotId: "t3code-disconnect",
		confirm: model.disconnectConfirm,
		icon: IconWarning(h, { className: "size-6 text-danger" }),
		title: "Disconnect T3 Code",
		description: (label) => [
			"Hazel will stop driving",
			label,
			`. Threads already posted stay in Hazel. ${REVOKE_NOTE}`,
		],
		confirmLabel: "Disconnect",
		pendingLabel: "Disconnecting...",
		onConfirm: Message.ClickedConfirmDisconnectT3Code(),
		toParentMessage: toDisconnectConfirmMessage,
	})

const connectionBody = (h: H, integration: Integration, model: Model, nowMs: number): Html => {
	switch (model.t3Code._tag) {
		case "Loading":
			return centered(
				h,
				spinner(h, "size-6 animate-spin text-muted-fg"),
				"Loading your link...",
				[],
				[],
			)
		case "Failed":
			return centered(
				h,
				strokeIcon(h, { className: "size-6 text-muted-fg", strokeWidth: "1.5", d: LINK_ICON }),
				"Couldn't load your T3 Code link",
				["Check your connection and try again."],
				[
					button(
						h,
						{ intent: "secondary", size: "sm", onPress: Message.ClickedRetryT3CodeLink() },
						["Try again"],
					),
				],
			)
		case "Loaded": {
			const link = model.t3Code.link
			if (model.activity._tag === "Verifying" && link?.status !== "active")
				return verifyingState(h, integration)
			return link === null ? notLinked(h, integration, model) : linked(h, link, model, nowMs)
		}
	}
}

/** The detail page's main column for T3 Code. */
export const t3CodeColumn = (h: H, integration: Integration, model: Model, nowMs: number): Array<Html> => {
	const link = model.t3Code._tag === "Loaded" ? model.t3Code.link : null
	return [
		panel(h, "Your environment", [connectionBody(h, integration, model, nowMs)]),
		...(link === null ? [] : [panel(h, "Sharing", [sharing(h, link, model)])]),
		disconnectDialog(h, model),
	]
}

/** Whether the header reads "Connected": the member's link is active. */
export const isT3CodeConnected = (model: Model, nowMs: number) =>
	model.t3Code._tag === "Loaded" &&
	model.t3Code.link !== null &&
	effectiveStatus(model.t3Code.link, nowMs) === "active"
