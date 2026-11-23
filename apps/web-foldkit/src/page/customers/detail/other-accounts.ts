import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatRelative } from "../../../customers/format"
import { stageBadge } from "../../../customers/ui/badges"
import { companyLogo } from "../../../customers/ui/identity"
import { customerRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import * as Popover from "../../../ui/popover"
import { Message } from "./message"
import type { Model } from "./model"
import type { Context } from "./parts"

/** A user's other customers: always visible on their row, the details one press away. */

const MAX_LOGOS = 3

const nameOf = (account: Customers.ContactOtherAccount) =>
	account.environment === null ? account.name : `${account.name} · ${account.environment}`

const triggerContent = (
	h: HtmlBuilder<Message>,
	accounts: ReadonlyArray<Customers.ContactOtherAccount>,
): ReadonlyArray<Html | string> => {
	const [first] = accounts
	return [
		h.span(
			[h.Class("flex shrink-0 -space-x-1")],
			accounts.slice(0, MAX_LOGOS).map((account, index) =>
				companyLogo(h, {
					name: account.name,
					logoUrl: account.logoUrl,
					size: "2xs",
					// A phone gives the customer's name the width.
					className: twMerge("ring-1 ring-bg", index > 0 && "max-sm:hidden"),
				}),
			),
		),
		h.span(
			[h.Class("min-w-0 truncate font-normal text-muted-fg")],
			[
				h.span([h.Class("max-sm:hidden")], ["Also in "]),
				h.span([h.Class("font-medium text-fg")], [nameOf(first)]),
			],
		),
		...(accounts.length > 1
			? [h.span([h.Class("shrink-0 text-muted-fg tabular-nums")], [`+${accounts.length - 1}`])]
			: []),
	]
}

const accountLink = (
	h: HtmlBuilder<Message>,
	account: Customers.ContactOtherAccount,
	context: Context,
): Html => {
	const seen =
		account.lastSeenAt === null
			? "Never seen"
			: `Seen ${formatRelative(account.lastSeenAt, new Date(context.nowMs))}`
	return h.a(
		[
			h.Key(account.accountId),
			h.Href(hrefOf(customerRoute(context.orgSlug, account.accountId, "users"))),
			h.OnClick(Message.PressedOtherAccount()),
			h.Class(
				"flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-secondary focus-visible:bg-secondary",
			),
		],
		[
			companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
			h.span(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span([h.Class("truncate font-medium text-fg text-sm")], [nameOf(account)]),
					h.span(
						[h.Class("truncate text-muted-fg text-xs")],
						[account.role === null ? seen : `${account.role} · ${seen}`],
					),
				],
			),
			stageBadge(h, account.lifecycleStage),
		],
	)
}

export const otherAccounts = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	row: Customers.ContactRow,
): Html | null => {
	const accounts = row.otherAccounts
	if (accounts.length === 0) return null
	const label = `${row.contact.name ?? row.contact.email ?? "This user"} is also in ${accounts.length} other ${accounts.length === 1 ? "customer" : "customers"}`
	const className = "h-6 w-fit max-w-full justify-start gap-1.5 px-1.5 text-xs"
	// Beside the name; a row too narrow for both wraps it underneath, so the name stays readable.
	const besideName = (control: Html) => h.div([h.Class("min-w-0 max-w-full")], [control])
	if (model.otherAccountsContactId !== row.contact.id)
		return besideName(
			button(
				h,
				{
					intent: "outline",
					size: "xs",
					className,
					attributes: [h.AriaLabel(label)],
					onPress: Message.PressedOtherAccounts({ contactId: row.contact.id }),
				},
				[...triggerContent(h, accounts)],
			),
		)
	return besideName(
		h.submodel({
			slotId: model.otherAccountsPopover.id,
			model: model.otherAccountsPopover,
			view: Popover.view,
			viewInputs: {
				toTrigger: (attributes) =>
					button(
						h,
						{
							intent: "outline",
							size: "xs",
							className,
							attributes: [...attributes, h.AriaLabel(label)],
						},
						[...triggerContent(h, accounts)],
					),
				toContent: () => [
					h.div(
						[h.Class("flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 p-2")],
						[
							h.p(
								[h.Class("px-2 py-1 font-medium text-muted-fg text-xs")],
								[
									`Also in ${accounts.length} other ${accounts.length === 1 ? "customer" : "customers"}`,
								],
							),
							h.div(
								[h.Class("flex max-h-72 flex-col overflow-y-auto")],
								accounts.map((account) => accountLink(h, account, context)),
							),
						],
					),
				],
				placement: "bottom start",
			},
			toParentMessage: (message) => Message.GotOtherAccountsPopoverMessage({ message }),
		}),
	)
}
