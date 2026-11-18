import type * as Customers from "@hazel/domain/customers"
import * as AsyncData from "foldkit/asyncData"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { failureMessage } from "~/lib/error-messages"
import { formatDateTime } from "../../../customers/format"
import { safeSourceUrl } from "../../../customers/providers"
import { msOf } from "../../../customers/queries"
import { sourceMark } from "../../../customers/ui/identity"
import { IconArrowUp, IconExternalLink } from "../../../icons"
import { ariaButton, buttonClassName } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import * as Modal from "../../../ui/modal"
import { Message } from "./message"
import type { EmailEventData, Model } from "./model"

/**
 * Imported emails (Gmail): the timeline's row for an `email.received` / `email.sent` event, and the
 * dialog that opens the whole email (`customers.email.get`).
 */

type H = HtmlBuilder<Message>
type Participant = EmailEventData["from"]

const nameOf = (participant: Participant): string => participant.name ?? participant.email

/** `Ada Lovelace`, `ada@acme.com <Ada Lovelace>` in a header: the name, then the address. */
const addressOf = (participant: Participant): string =>
	participant.name === null ? participant.email : `${participant.name} <${participant.email}>`

/** `Ada → Grace +2`: the sender and the first recipient, with how many more. */
const routeOf = (data: EmailEventData): string => {
	const recipients = [...data.to, ...data.cc]
	const first = recipients[0]
	return first === undefined
		? nameOf(data.from)
		: `${nameOf(data.from)} → ${nameOf(first)}${recipients.length > 1 ? ` +${recipients.length - 1}` : ""}`
}

const directionLabel = (h: H, direction: Customers.EmailDirection): Html =>
	h.span(
		[h.Class("inline-flex shrink-0 items-center gap-1")],
		[
			IconArrowUp(h, {
				className: direction === "outbound" ? "size-3 rotate-45" : "size-3 rotate-[225deg]",
			}),
			direction === "outbound" ? "Sent" : "Received",
		],
	)

/** A timeline row: direction, subject, who wrote to whom, the snippet; pressing it opens the email. */
export const emailRow = (h: H, event: Customers.Event, data: EmailEventData, time: string): Html =>
	h.li(
		[h.Key(event.id), h.Class("py-1")],
		[
			ariaButton(
				h,
				{
					className:
						"-mx-2 flex w-[calc(100%+1rem)] cursor-pointer gap-3 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring/70",
					onPress: Message.PressedEmail({ emailId: data.emailId }),
				},
				[
					sourceMark(h, event.provider, { className: "size-7" }),
					h.span(
						[h.Class("flex min-w-0 flex-1 flex-col gap-1")],
						[
							h.span(
								[h.Class("flex items-start justify-between gap-4")],
								[
									h.span(
										[h.Class("flex min-w-0 flex-col")],
										[
											h.span(
												[h.Class("truncate font-medium text-fg text-sm")],
												[event.title === "" ? "(no subject)" : event.title],
											),
											h.span(
												[
													h.Class(
														"flex min-w-0 items-center gap-1.5 text-muted-fg text-xs",
													),
												],
												[
													directionLabel(h, data.direction),
													h.span([h.AriaHidden(true)], ["·"]),
													h.span([h.Class("truncate")], [routeOf(data)]),
												],
											),
										],
									),
									h.span([h.Class("shrink-0 text-muted-fg text-xs tabular-nums")], [time]),
								],
							),
							...(data.snippet === ""
								? []
								: [h.span([h.Class("line-clamp-2 text-fg-2 text-sm")], [data.snippet])]),
						],
					),
				],
			),
		],
	)

const header = (h: H, label: string, participants: ReadonlyArray<Participant>): ReadonlyArray<Html> =>
	participants.length === 0
		? []
		: [
				h.dt([h.Class("text-muted-fg")], [label]),
				h.dd([h.Class("min-w-0 break-words text-fg")], [participants.map(addressOf).join(", ")]),
			]

const emailContent = (
	h: H,
	model: Model,
	email: Customers.Email,
	url: string,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const gmailUrl = safeSourceUrl(email.provider, url)
	return [
		dialogHeader(h, {
			title: {
				id: Modal.titleId(model.emailModal.id),
				text: email.subject === "" ? "(no subject)" : email.subject,
			},
		}),
		dialogBody(h, [
			h.div(
				[h.Class("flex flex-col gap-4")],
				[
					h.dl(
						[h.Class("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm")],
						[
							...header(h, "From", [email.fromAddress]),
							...header(h, "To", email.toAddresses),
							...header(h, "Cc", email.ccAddresses),
							h.dt([h.Class("text-muted-fg")], ["Date"]),
							h.dd([h.Class("text-fg")], [formatDateTime(new Date(msOf(email.occurredAt)))]),
						],
					),
					h.div(
						[
							h.Class(
								"max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words border-border border-t pt-4 text-fg text-sm",
							),
						],
						[email.bodyText === "" ? email.snippet : email.bodyText],
					),
				],
			),
		]),
		dialogFooter(h, [
			...(gmailUrl === null
				? []
				: [
						h.a(
							[
								h.Href(gmailUrl),
								h.Target("_blank"),
								h.Rel("noreferrer"),
								h.Class(buttonClassName({ intent: "outline" }, "mr-auto no-underline")),
							],
							[IconExternalLink(h, { attributes: { "data-slot": "icon" } }), "Open in Gmail"],
						),
					]),
			dialogClose(h, closeAttributes, ["Close"]),
		]),
	]
}

/** The whole email: its headers, its plain-text body, and its thread in Gmail. */
export const emailDialog = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.emailModal,
		toParentMessage: (message) => Message.GotEmailModalMessage({ message }),
		size: "lg",
		toContent: (closeAttributes) => {
			const close = dialogFooter(h, [dialogClose(h, closeAttributes, ["Close"])])
			return AsyncData.matchData(model.email, {
				onEmpty: () => [
					dialogHeader(h, { title: { id: Modal.titleId(model.emailModal.id), text: "Email" } }),
					dialogBody(h, [h.p([h.AriaBusy(true), h.Class("text-muted-fg text-sm")], ["Loading…"])]),
					close,
				],
				onFailure: (reason) => {
					const message = failureMessage(reason, {
						NotFound: {
							title: "This email is gone",
							description: "It was removed after the timeline loaded.",
						},
					})
					return [
						dialogHeader(h, {
							title: { id: Modal.titleId(model.emailModal.id), text: message.title },
							description: message.description,
						}),
						close,
					]
				},
				onData: ({ email, url }) => emailContent(h, model, email, url, closeAttributes),
			})
		},
	})
