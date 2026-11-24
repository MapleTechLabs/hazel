import { Submodel } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusBadgeIntent, getStatusLabel } from "~/utils/status"
import { IconEdit, IconEnvelope } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import { buttonClassName } from "../../ui/button"
import { inputGroup } from "../../ui/input"
import { emptyState } from "../../ui/empty-state"
import { loadingState } from "../../ui/loader"
import { pageHeader, pageLayout } from "../../ui/page-header"
import { presenceDot } from "../../ui/presence-dot"
import { sectionLabelRoot } from "../../ui/section-label"
import { type StatusTone, statusDot } from "../../ui/status-dot"
import { textField } from "../../ui/text-field"
import type { PageViewInputs } from "../contract"
import type { Message } from "./message"
import { type Model, ProfileLookup, type ProfileUser } from "./model"

/** Port of `routes/_app/$orgSlug/profile/$userId.tsx`. */

const notFound = (h: HtmlBuilder<Message>) => emptyState(h, { title: "User not found", className: "p-8" })

const loading = (h: HtmlBuilder<Message>) => loadingState(h, { className: "p-8" })

const STATUS_TONE = {
	success: "success",
	warning: "warning",
	danger: "danger",
	secondary: "neutral",
} as const satisfies Readonly<Record<ReturnType<typeof getStatusBadgeIntent>, StatusTone>>

const profile = (
	h: HtmlBuilder<Message>,
	user: ProfileUser,
	options: { readonly isOwnProfile: boolean; readonly orgSlug: string | null; readonly nowMs: number },
) => {
	const fullName = `${user.firstName} ${user.lastName}`
	const effectiveStatus = getEffectivePresenceStatus(
		user.presenceLastSeenMs === null ? null : { status: user.presenceStatus },
	)
	const statusIntent = getStatusBadgeIntent(effectiveStatus)
	return pageLayout(h, { className: "py-6" }, [
		pageHeader(h, {
			title: "Profile",
			subtitle: options.isOwnProfile
				? "View your profile information."
				: `View ${user.firstName}'s profile information.`,
			actions:
				options.isOwnProfile && options.orgSlug !== null
					? [
							h.a(
								[
									h.Class(buttonClassName({ intent: "secondary" })),
									h.Href(hrefOf(AppRoute.MySettingsProfile({ orgSlug: options.orgSlug }))),
								],
								[IconEdit(h), "Edit Profile"],
							),
						]
					: undefined,
		}),
		h.div(
			[h.Class("max-w-xl space-y-6")],
			[
				h.div(
					[h.Class("flex items-center gap-4")],
					[
						avatar(h, {
							size: "xl",
							alt: fullName,
							src: user.avatarUrl,
							seed: fullName,
							fallbackIcon: true,
							badge: presenceDot(h, effectiveStatus, "sm"),
						}),
						h.div(
							[h.Class("flex flex-col gap-1")],
							[
								h.span([h.Class("font-semibold text-fg text-lg")], [fullName]),
								badge(h, { intent: statusIntent, isPill: true, className: "w-fit" }, [
									statusDot(h, { tone: STATUS_TONE[statusIntent] }),
									getStatusLabel(effectiveStatus),
								]),
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
	])
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	ProfileLookup.match(model.user, {
		Loading: () => loading(h),
		NotFound: () => notFound(h),
		Found: ({ user }) =>
			profile(h, user, {
				isOwnProfile: shared.currentUser?.id === model.userId,
				orgSlug: shared.orgSlug,
				nowMs: shared.nowMs,
			}),
	}),
)
