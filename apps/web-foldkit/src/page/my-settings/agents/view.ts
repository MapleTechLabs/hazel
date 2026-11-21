import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { formatDistanceStrict } from "~/lib/format-distance"
import { commonMessage } from "~/lib/error-messages"
import { IconCopy } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { loader } from "../../../ui/loader"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs } from "../../contract"
import { divider, pageHeader, settingsRow } from "../shared"
import { Message } from "./message"
import { canCreateToken, type CreatedToken, type Grant, Grants, type Model, type TokenAccess } from "./model"

const ago = (ms: number, nowMs: number) => formatDistanceStrict(ms, Math.max(ms, nowMs))

const copyButton = (h: HtmlBuilder<Message>, target: "McpUrl" | "Token", text: string, label: string): Html =>
	button(h, { intent: "outline", size: "sm", onPress: Message.ClickedCopy({ target, text }) }, [
		IconCopy(h, { className: "size-4" }),
		label,
	])

const codeBox = (h: HtmlBuilder<Message>, text: string): Html =>
	h.code(
		[
			h.Class(
				"min-w-0 flex-1 truncate rounded-md border border-border bg-secondary/50 px-3 py-1.5 font-mono text-fg text-xs",
			),
		],
		[text],
	)

const connectSection = (h: HtmlBuilder<Message>, mcpUrl: string): Html =>
	settingsRow(
		h,
		{
			title: "Connect an agent",
			description: "Let an AI agent read your messages and answer people for you.",
		},
		h.div(
			[h.Class("flex max-w-xl flex-col gap-3")],
			[
				h.div(
					[h.Class("flex items-center gap-2")],
					[codeBox(h, mcpUrl), copyButton(h, "McpUrl", mcpUrl, "Copy")],
				),
				h.p(
					[h.Class("text-muted-fg text-xs")],
					[
						"Add Hazel as a remote MCP server in Claude, ChatGPT, Cursor or another agent using this URL, and sign in when asked. For clients that take a header instead, create a personal token below and send ",
						h.code([h.Class("font-mono text-fg")], ["Authorization: Bearer <token>"]),
						".",
					],
				),
				h.p(
					[h.Class("text-muted-fg text-xs")],
					[
						`Messages an agent sends show "via <agent>" next to your name for people in your organization.`,
					],
				),
			],
		),
	)

const createdTokenBanner = (h: HtmlBuilder<Message>, created: CreatedToken): Html =>
	h.div(
		[h.Class("flex max-w-xl flex-col gap-3 rounded-xl border border-border bg-bg p-4"), h.Role("status")],
		[
			h.p([h.Class("font-medium text-fg text-sm")], [`Token "${created.name}" created`]),
			h.p([h.Class("text-muted-fg text-xs")], ["Copy it now. You won't be able to see it again."]),
			h.div(
				[h.Class("flex items-center gap-2")],
				[codeBox(h, created.token), copyButton(h, "Token", created.token, "Copy")],
			),
			h.div(
				[],
				[
					button(h, { intent: "plain", size: "sm", onPress: Message.ClickedDismissToken() }, [
						"Done",
					]),
				],
			),
		],
	)

const ACCESS_OPTIONS: ReadonlyArray<{
	readonly access: TokenAccess
	readonly label: string
	readonly hint: string
}> = [
	{ access: "write", label: "Read & write", hint: "Read, send, share files, react, edit, set status" },
	{ access: "read", label: "Read only", hint: "Read channels and messages" },
	{
		access: "read_customers",
		label: "Read + customers",
		hint: "Read only, plus your organizations' customers",
	},
]

const accessOption = (
	h: HtmlBuilder<Message>,
	model: Model,
	option: (typeof ACCESS_OPTIONS)[number],
): Html => {
	const isSelected = model.tokenAccess === option.access
	return h.keyed("button")(
		option.access,
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			h.OnClick(Message.SelectedTokenAccess({ access: option.access })),
			h.Class(
				`flex flex-1 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
					isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
				}`,
			),
		],
		[
			h.span([h.Class("font-medium text-fg text-sm")], [option.label]),
			h.span([h.Class("text-muted-fg text-xs")], [option.hint]),
		],
	)
}

const createSection = (h: HtmlBuilder<Message>, model: Model): Html =>
	settingsRow(
		h,
		{ title: "Personal tokens", description: "For agents that take a token instead of signing in." },
		h.div(
			[h.Class("flex max-w-xl flex-col gap-3")],
			[
				...(model.createdToken === null ? [] : [createdTokenBanner(h, model.createdToken)]),
				textField(
					h,
					{
						id: "agent-token-name",
						value: model.tokenName,
						onInput: (value) => Message.ChangedTokenName({ value }),
						isDisabled: model.isCreating || model.createdToken !== null,
					},
					(field) => [
						field.label(["Name"]),
						field.input({ placeholder: "e.g. Claude Code on my laptop" }),
					],
				),
				h.div(
					[h.Class("flex flex-col gap-2 sm:flex-row"), h.Role("radiogroup"), h.AriaLabel("Access")],
					ACCESS_OPTIONS.map((option) => accessOption(h, model, option)),
				),
				h.div(
					[],
					[
						button(
							h,
							{
								intent: "primary",
								size: "sm",
								isDisabled: !canCreateToken(model),
								onPress: Message.ClickedCreateToken(),
							},
							[model.isCreating ? "Creating..." : "Create token"],
						),
					],
				),
			],
		),
	)

const grantRow = (h: HtmlBuilder<Message>, model: Model, grant: Grant, nowMs: number): Html => {
	const isConfirming = model.confirmingRevoke === grant.id
	const isRevoking = model.revoking === grant.id
	const access = [
		grant.scopes.includes("messages:write")
			? "Read & write"
			: grant.scopes.includes("messages:read")
				? "Read only"
				: null,
		grant.scopes.includes("customers:read") ? "Customers (read)" : null,
	]
		.filter((label) => label !== null)
		.join(" · ")
	const used = grant.lastUsedAtMs === null ? "never used" : `last used ${ago(grant.lastUsedAtMs, nowMs)}`
	return h.keyed("li")(
		grant.id,
		[h.Class("flex items-center gap-4 px-4 py-3")],
		[
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.span([h.Class("truncate font-medium text-fg text-sm")], [grant.name]),
							badge(h, { intent: "secondary" }, [
								grant.kind === "oauth" ? "OAuth app" : "Personal token",
							]),
						],
					),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[`${access} · added ${ago(grant.createdAtMs, nowMs)} · ${used}`],
					),
				],
			),
			isConfirming
				? h.div(
						[h.Class("flex items-center gap-2")],
						[
							button(
								h,
								{ intent: "plain", size: "sm", onPress: Message.ClickedCancelRevoke() },
								["Cancel"],
							),
							button(
								h,
								{
									intent: "danger",
									size: "sm",
									onPress: Message.ClickedConfirmRevoke({ grantId: grant.id }),
								},
								["Disconnect"],
							),
						],
					)
				: button(
						h,
						{
							intent: "outline",
							size: "sm",
							isDisabled: model.revoking !== null,
							onPress: Message.ClickedRevoke({ grantId: grant.id }),
						},
						[isRevoking ? "Disconnecting..." : "Revoke"],
					),
		],
	)
}

const grantsSection = (
	h: HtmlBuilder<Message>,
	model: Model,
	grants: ReadonlyArray<Grant>,
	nowMs: number,
): Html =>
	settingsRow(
		h,
		{ title: "Connected agents", description: "Revoking one stops it at once." },
		grants.length === 0
			? h.p([h.Class("text-muted-fg text-sm")], ["No agents yet."])
			: h.ul(
					[
						h.Class(
							"flex max-w-xl flex-col divide-y divide-border rounded-xl border border-border bg-bg",
						),
					],
					grants.map((grant) => grantRow(h, model, grant, nowMs)),
				),
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Agents", "AI agents and apps you let act for you, like Raycast."),
			...Grants.match<ReadonlyArray<Html>>(model.grants, {
				Loading: () => [loader(h, { className: "size-5" })],
				Failed: ({ reason }) => [
					h.p([h.Class("text-danger text-sm"), h.Role("alert")], [commonMessage(reason).title]),
					h.div(
						[],
						[
							button(h, { intent: "outline", size: "sm", onPress: Message.ClickedRetry() }, [
								"Try again",
							]),
						],
					),
				],
				Loaded: ({ grants, mcpUrl }) => [
					connectSection(h, mcpUrl),
					divider(h),
					createSection(h, model),
					divider(h),
					grantsSection(h, model, grants, shared.nowMs),
				],
			}),
		],
	),
)
