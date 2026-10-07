import { Submodel } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusBadgeColor, getStatusDotColor, getStatusLabel } from "~/utils/status"
import { IconEdit, IconEnvelope } from "../../icons"
import { avatar } from "../../ui/avatar"
import { buttonClassName } from "../../ui/button"
import { inputGroup } from "../../ui/input"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import { sectionLabelRoot } from "../../ui/section-label"
import { textField } from "../../ui/text-field"
import type { PageViewInputs } from "../contract"
import type { Message } from "./message"
import type { Model, ProfileUser } from "./model"

/** Port of `routes/_app/$orgSlug/profile/$userId.tsx`. */

const notFound = (h: HtmlBuilder<Message>) =>
	h.div(
		[h.Class("flex flex-col items-center justify-center gap-4 p-8")],
		[h.p([h.Class("text-muted-fg")], ["User not found"])],
	)

const profile = (
	h: HtmlBuilder<Message>,
	user: ProfileUser,
	options: { readonly isOwnProfile: boolean; readonly orgSlug: string; readonly nowMs: number },
) => {
	const fullName = `${user.firstName} ${user.lastName}`
	const effectiveStatus = getEffectivePresenceStatus(
		user.presenceLastSeenMs === null
			? null
			: { status: user.presenceStatus, lastSeenAt: new Date(user.presenceLastSeenMs) },
		options.nowMs,
	)
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 py-6 lg:px-8")],
		[
			sectionHeaderRoot(h, { className: "border-none pb-0" }, [
				sectionHeaderGroup(h, {}, [
					h.div(
						[h.Class("flex flex-1 flex-col justify-center gap-0.5 self-stretch")],
						[
							sectionHeaderHeading(h, { size: "xl" }, ["Profile"]),
							sectionHeaderSubheading(h, {}, [
								options.isOwnProfile
									? "View your profile information."
									: `View ${user.firstName}'s profile information.`,
							]),
						],
					),
					options.isOwnProfile
						? h.a(
								[
									h.Class(buttonClassName({ intent: "secondary" })),
									h.Href(`/${options.orgSlug}/my-settings/profile`),
								],
								[IconEdit(h), "Edit Profile"],
							)
						: h.empty,
				]),
			]),
			h.div(
				[h.Class("max-w-xl space-y-6")],
				[
					h.div(
						[h.Class("flex items-center gap-4")],
						[
							h.div(
								[h.Class("relative")],
								[
									avatar(h, {
										size: "xl",
										alt: fullName,
										src: user.avatarUrl,
										fallbackIcon: true,
									}),
									h.span(
										[
											h.Class(
												cn(
													"absolute right-0 bottom-0 size-3 rounded-full border-2 border-bg",
													getStatusDotColor(effectiveStatus),
												),
											),
										],
										[],
									),
								],
							),
							h.div(
								[h.Class("flex flex-col gap-1")],
								[
									h.span([h.Class("font-semibold text-fg text-lg")], [fullName]),
									h.span(
										[
											h.Class(
												cn(
													"inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
													getStatusBadgeColor(effectiveStatus),
												),
											),
										],
										[
											h.span([h.Class("size-1.5 rounded-full bg-current")], []),
											getStatusLabel(effectiveStatus),
										],
									),
								],
							),
						],
					),
					h.div(
						[h.Class("space-y-2")],
						[
							sectionLabelRoot(h, { size: "sm", title: "Email address" }),
							textField(
								h,
								{ id: "profile-email", value: user.email, isDisabled: true },
								(parts) => [
									inputGroup(h, { isDisabled: true, role: "presentation" }, [
										IconEnvelope(h, { attributes: { "data-slot": "icon" } }),
										parts.input({ attributes: [h.Type("email")] }),
									]),
								],
							),
						],
					),
				],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	model.user === null
		? notFound(h)
		: profile(h, model.user, {
				isOwnProfile: shared.currentUser?.id === model.userId,
				orgSlug: shared.orgSlug ?? "",
				nowMs: shared.nowMs,
			}),
)
