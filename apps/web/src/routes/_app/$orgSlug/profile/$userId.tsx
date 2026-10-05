import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { UserId } from "@hazel/schema"
import { createFileRoute, Link } from "@tanstack/react-router"
import { userWithPresenceAtomFamily } from "~/atoms/message-atoms"
import { presenceNowSignal } from "~/atoms/presence-atoms"
import IconEdit from "~/components/icons/icon-edit"
import IconEnvelope from "~/components/icons/icon-envelope"
import { Avatar } from "~/components/ui/avatar"
import { buttonStyles } from "~/components/ui/button"
import { Input, InputGroup } from "~/components/ui/input"
import { SectionHeader } from "~/components/ui/section-header"
import { SectionLabel } from "~/components/ui/section-label"
import { TextField } from "~/components/ui/text-field"
import { useAuth } from "~/lib/auth"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusBadgeColor, getStatusDotColor, getStatusLabel } from "~/utils/status"

export const Route = createFileRoute("/_app/$orgSlug/profile/$userId")({
	component: ProfilePage,
})

function ProfilePage() {
	const { userId, orgSlug } = Route.useParams()
	const { user: currentUser } = useAuth()
	const nowMs = useAtomValue(presenceNowSignal)

	const userPresenceResult = useAtomValue(userWithPresenceAtomFamily(userId as UserId))
	const data = AsyncResult.getOrElse(userPresenceResult, () => [])
	const result = data[0]
	const user = result?.user
	const presence = result?.presence
	const effectiveStatus = getEffectivePresenceStatus(presence ?? null, nowMs)

	const isOwnProfile = currentUser?.id === userId

	if (!user) {
		return (
			<div className="flex flex-col items-center justify-center gap-4 p-8">
				<p className="text-muted-fg">User not found</p>
			</div>
		)
	}

	const fullName = `${user.firstName} ${user.lastName}`

	return (
		<div className="flex flex-col gap-6 px-4 py-6 lg:px-8">
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="flex flex-1 flex-col justify-center gap-0.5 self-stretch">
						<SectionHeader.Heading size="xl">Profile</SectionHeader.Heading>
						<SectionHeader.Subheading>
							{isOwnProfile
								? "View your profile information."
								: `View ${user.firstName}'s profile information.`}
						</SectionHeader.Subheading>
					</div>
					{isOwnProfile && (
						<Link
							to="/$orgSlug/my-settings/profile"
							params={{ orgSlug }}
							className={buttonStyles({ intent: "secondary" })}
						>
							<IconEdit />
							Edit Profile
						</Link>
					)}
				</SectionHeader.Group>
			</SectionHeader.Root>

			<div className="max-w-xl space-y-6">
				<div className="flex items-center gap-4">
					<div className="relative">
						<Avatar size="xl" alt={fullName} src={user.avatarUrl} />
						<span
							className={cn(
								"absolute right-0 bottom-0 size-3 rounded-full border-2 border-bg",
								getStatusDotColor(effectiveStatus),
							)}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<span className="font-semibold text-fg text-lg">{fullName}</span>
						<span
							className={cn(
								"inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
								getStatusBadgeColor(effectiveStatus),
							)}
						>
							<span className="size-1.5 rounded-full bg-current" />
							{getStatusLabel(effectiveStatus)}
						</span>
					</div>
				</div>

				<div className="space-y-2">
					<SectionLabel.Root size="sm" title="Email address" />
					<TextField isDisabled>
						<InputGroup>
							<IconEnvelope data-slot="icon" />
							<Input type="email" value={user.email} />
						</InputGroup>
					</TextField>
				</div>
			</div>
		</div>
	)
}
