import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { appLoader } from "../../shell/layouts"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { type ClerkMountMessage, clerkComponent } from "../auth/clerk-mount"
import type { PageViewInputs } from "../contract"
import { createOrganizationProps } from "../onboarding/setup-organization"
import { Message } from "./message"
import type { Model, UserOrganization } from "./model"

const toClerkMessage = (message: ClerkMountMessage): Message => Message.GotClerkMountMessage({ message })

const initialsOf = (name: string) =>
	name
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase())
		.slice(0, 2)
		.join("")

const capitalize = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

/** No organizations: Clerk's `<CreateOrganization>` (previously a redirect to `/onboarding`, which looped). */
const createWorkspace = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex min-h-screen items-center justify-center bg-bg p-4")],
		[
			h.div(
				[h.Class("flex w-full max-w-lg flex-col items-center gap-6")],
				[
					h.div(
						[h.Class("text-center")],
						[
							h.h1([h.Class("font-semibold text-2xl")], ["Create your workspace"]),
							h.p(
								[h.Class("mt-2 text-muted-fg text-sm")],
								["Get started by creating or joining an organization."],
							),
						],
					),
					clerkComponent(h, "CreateOrganization", createOrganizationProps, toClerkMessage),
				],
			),
		],
	)

const organizationButton = (h: HtmlBuilder<Message>, organization: UserOrganization): Html =>
	h.button(
		[
			h.Type("button"),
			h.OnClick(Message.ClickedOrganization({ organization })),
			h.Class(
				"flex w-full items-center gap-4 rounded-xl border border-border bg-bg p-4 text-left transition-all hover:border-primary hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
			),
		],
		[
			avatar(h, {
				src: organization.logoUrl,
				initials: initialsOf(organization.name),
				className: "size-12",
			}),
			h.div(
				[h.Class("flex flex-1 flex-col")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [organization.name]),
					...(organization.slug
						? [h.span([h.Class("text-muted-fg text-xs")], ["@", organization.slug])]
						: []),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.span(
						[
							h.Class(
								"rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs",
							),
						],
						[capitalize(organization.role)],
					),
					h.svg(
						[
							h.Class("size-5 text-muted-fg"),
							h.Attribute("fill", "none"),
							h.Attribute("stroke", "currentColor"),
							h.Attribute("stroke-width", "2"),
							h.Attribute("viewBox", "0 0 24 24"),
						],
						[
							h.path([
								h.Attribute("d", "M9 5l7 7-7 7"),
								h.Attribute("stroke-linecap", "round"),
								h.Attribute("stroke-linejoin", "round"),
							]),
						],
					),
				],
			),
		],
	)

const picker = (h: HtmlBuilder<Message>, organizations: ReadonlyArray<UserOrganization>): Html =>
	h.div(
		[h.Class("flex min-h-screen items-center justify-center bg-bg px-4")],
		[
			h.div(
				[h.Class("w-full max-w-md")],
				[
					h.div(
						[h.Class("mb-8 text-center")],
						[
							h.h1(
								[h.Class("mb-2 font-semibold text-2xl text-fg")],
								["Select an organization"],
							),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								["Choose which organization you'd like to access"],
							),
						],
					),
					h.div(
						[h.Class("flex flex-col gap-3")],
						organizations.map((organization) => organizationButton(h, organization)),
					),
					h.div(
						[h.Class("mt-6 text-center")],
						[
							h.p(
								[h.Class("text-muted-fg text-xs")],
								[
									"Don't see your organization? ",
									button(
										h,
										{
											intent: "plain",
											size: "sm",
											className: "text-xs",
											onPress: Message.ClickedCreateNew(),
										},
										["Create a new one"],
									),
								],
							),
						],
					),
				],
			),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const organizations = model.organizations
	// A single organization redirects, so it shows the loader like `<Navigate>` does.
	if (shared.currentUser === null || organizations === null || organizations.length === 1)
		return appLoader(h)
	return organizations.length === 0 ? createWorkspace(h) : picker(h, organizations)
})
