import type { UserId } from "@hazel/schema"
import type { Html } from "foldkit/html"
import { formatDate, formatRelative } from "../../../../customers/format"
import type { MemberRow } from "../../../../customers/queries"
import { personAvatar } from "../../../../customers/ui/identity"
import { IconPlus } from "../../../../icons"
import { button } from "../../../../ui/button"
import { heading } from "../../../../ui/heading"
import * as Menu from "../../../../ui/menu"
import { menuLabel, view as menuView } from "../../../../ui/menu-view"
import { Message } from "./message"
import { grantableMembers, type Model } from "./model"
import { card, cardHeader, type H } from "./parts"

/** Clerk's impersonation section (admins): who may sign in as customers' users, and who did. */

const EXPLANATION =
	"Members added here can sign in as a customer's users from its Users tab; each sign-in is logged. Turn it on in the Clerk dashboard (Settings → User impersonation). Clerk allows 5 impersonations a month without the Administration add-on."

const toMenuMessage = (message: Menu.Message) => Message.GotImpersonatorMenuMessage({ message })

const addMemberMenu = (h: H, model: Model, members: ReadonlyArray<MemberRow>): Html =>
	h.submodel({
		slotId: model.impersonatorMenu.id,
		model: model.impersonatorMenu,
		view: menuView,
		viewInputs: {
			entries: members.map((member) => Menu.item(member.id, { textValue: member.name })),
			toTrigger: (attributes, overlay) =>
				button(h, { intent: "outline", size: "sm", attributes }, [
					IconPlus(h, { attributes: { "data-slot": "icon" } }),
					"Add member",
					overlay,
				]),
			content: (key) => {
				const member = members.find((entry) => entry.id === key) ?? null
				return [
					h.span(
						[h.DataAttribute("slot", "icon"), h.Class("inline-flex")],
						[personAvatar(h, member)],
					),
					menuLabel(h, model.impersonatorMenu.id, key, member?.name ?? key),
				]
			},
			className: "min-w-56",
		},
		toParentMessage: toMenuMessage,
	})

const nameOf = (model: Model, userId: UserId): string =>
	model.members.find((member) => member.id === userId)?.name ?? "A former member"

export const impersonationCard = (h: H, model: Model, nowMs: number): Html => {
	const now = new Date(nowMs)
	const grantable = grantableMembers(model)
	return card(h, [
		cardHeader(
			h,
			"Impersonation",
			EXPLANATION,
			grantable.length === 0 ? undefined : addMemberMenu(h, model, grantable),
		),
		model.impersonators.length === 0
			? h.p([h.Class("text-muted-fg text-sm")], ["No one can impersonate yet."])
			: h.ul(
					[
						h.AriaLabel("Members who can impersonate"),
						h.Class("flex flex-col divide-y divide-border"),
					],
					model.impersonators.map((row) => {
						const member = model.members.find((entry) => entry.id === row.userId) ?? null
						const name = member?.name ?? "A former member"
						return h.li(
							[h.Key(row.id), h.Class("flex items-center gap-3 py-2 first:pt-0 last:pb-0")],
							[
								personAvatar(h, member ?? { name }, { size: "md" }),
								h.div(
									[h.Class("flex min-w-0 flex-1 flex-col")],
									[
										h.span([h.Class("truncate font-medium text-fg text-sm")], [name]),
										h.span(
											[h.Class("truncate text-muted-fg text-xs")],
											[
												`Granted by ${nameOf(model, row.grantedBy)} · ${formatDate(new Date(row.grantedAtMs), { now })}`,
											],
										),
									],
								),
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										isDisabled: model.pendingGrants.includes(row.userId),
										attributes: [h.AriaLabel(`Remove ${name}`)],
										onPress: Message.PressedRevokeImpersonator({ userId: row.userId }),
									},
									["Remove"],
								),
							],
						)
					}),
				),
		h.div(
			[h.Class("flex flex-col gap-2 border-border border-t pt-4")],
			[
				heading(h, { variant: "subsection" }, ["Recent impersonations"]),
				model.impersonations.length === 0
					? h.p([h.Class("text-muted-fg text-sm")], ["None in the last 30 days."])
					: h.ul(
							[h.AriaLabel("Recent impersonations"), h.Class("flex flex-col gap-1.5")],
							model.impersonations.map((row) =>
								h.li(
									[
										h.Key(row.id),
										h.Class("flex items-baseline justify-between gap-3 text-sm"),
									],
									[
										h.span(
											[h.Class("min-w-0 truncate text-fg-2")],
											[
												h.span(
													[h.Class("font-medium text-fg")],
													[nameOf(model, row.userId)],
												),
												" as ",
												h.span(
													[h.Class("font-medium text-fg")],
													[row.contactLabel ?? "a user"],
												),
												` at ${row.accountName ?? "Deleted customer"}`,
											],
										),
										h.span(
											[h.Class("shrink-0 whitespace-nowrap text-muted-fg text-xs")],
											[formatRelative(new Date(row.createdAtMs), now)],
										),
									],
								),
							),
						),
			],
		),
	])
}
