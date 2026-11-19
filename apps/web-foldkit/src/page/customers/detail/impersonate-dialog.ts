import type { Html, HtmlBuilder } from "foldkit/html"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { buttonClassName } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { loader } from "../../../ui/loader"
import * as Modal from "../../../ui/modal"
import { Message } from "./message"
import type { ImpersonationFailure, Model } from "./model"

/**
 * "Sign in as": the one-time link `customers.impersonation.start` answered, as a real link the user
 * follows (a popup opened after an await is blocked), or why there is none.
 */

const failureCopy = (failure: ImpersonationFailure, name: string): UserErrorMessage =>
	typeof failure === "object"
		? { title: `Couldn't sign in as ${name}`, description: failure.message }
		: failureMessage(failure, {
				NotAllowed: {
					title: "You're not allowed to impersonate",
					description: "An admin can let you in the Clerk data source's settings.",
				},
				NotFound: { title: "This user is gone", description: "They were removed from the customer." },
			})

const toModalMessage = (message: Modal.Message) => Message.GotImpersonateModalMessage({ message })

export const impersonateDialog = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.impersonateModal,
		toParentMessage: toModalMessage,
		size: "sm",
		toContent: (closeAttributes) => {
			const impersonation = model.impersonation
			const failure =
				impersonation?.failure == null ? null : failureCopy(impersonation.failure, impersonation.name)
			return [
				dialogHeader(h, {
					title: {
						id: Modal.titleId(model.impersonateModal.id),
						text: `Sign in as ${impersonation?.name ?? "this user"}`,
					},
					description:
						"The link works once, for one minute; you are signed out of their app in this browser first.",
				}),
				dialogBody(h, [
					failure !== null
						? h.div(
								[
									h.Role("alert"),
									h.Class(
										"flex flex-col gap-1 rounded-lg bg-danger-subtle px-3 py-2 text-danger-subtle-fg text-sm",
									),
								],
								[
									h.p([h.Class("font-medium")], [failure.title]),
									...(failure.description === undefined
										? []
										: [h.p([h.Class("opacity-90")], [failure.description])]),
								],
							)
						: impersonation?.url == null
							? h.p(
									[
										h.Role("status"),
										h.Class("flex items-center gap-2 text-muted-fg text-sm"),
									],
									[
										loader(h, { ariaLabel: "Asking Clerk", className: "size-4" }),
										"Asking Clerk for a sign-in link…",
									],
								)
							: h.p(
									[h.Class("text-muted-fg text-sm")],
									["Each sign-in is logged for your admins."],
								),
				]),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Close"]),
					...(impersonation?.url == null
						? []
						: [
								h.a(
									[
										h.Href(impersonation.url),
										h.Target("_blank"),
										h.Rel("noopener noreferrer"),
										h.Class(buttonClassName({ intent: "primary" })),
									],
									["Open their app"],
								),
							]),
				]),
			]
		},
	})
