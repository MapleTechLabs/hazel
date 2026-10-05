import { useAtomSet } from "@effect/atom-react"
import type { UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { createDmChannelMutation } from "~/atoms/channel-atoms"
import IconCircleDottedUser from "~/components/icons/icon-circle-dotted-user"
import IconCopy from "~/components/icons/icon-copy"
import IconDots from "~/components/icons/icon-dots"
import IconMsgs from "~/components/icons/icon-msgs"
import IconPhone from "~/components/icons/icon-phone"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { DropdownLabel } from "~/components/ui/dropdown"
import { Loader } from "~/components/ui/loader"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/ui/menu"
import { SearchField, SearchInput } from "~/components/ui/search-field"
import { SectionHeader } from "~/components/ui/section-header"
import { organizationMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { findExistingDmChannel } from "~/lib/channels"
import { exitToastAsync } from "~/lib/toast-exit"
import { cn } from "~/lib/utils"
import { getStatusDotColor } from "~/utils/status"

export const Route = createFileRoute("/_app/$orgSlug/")({
	component: RouteComponent,
})

function RouteComponent() {
	const { orgSlug } = useParams({ from: "/_app/$orgSlug" })
	const { organizationId } = useOrganization()
	const navigate = useNavigate()
	const [searchQuery, setSearchQuery] = useState("")

	const createDmChannel = useAtomSet(createDmChannelMutation, {
		mode: "promiseExit",
	})

	const { data: membersData } = useLiveQuery({
		query: (q) =>
			q
				.from({ member: organizationMemberCollection })
				.where(({ member }) => eq(member.organizationId, organizationId))
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.leftJoin({ presence: userPresenceStatusCollection }, ({ user, presence }) =>
					eq(user.id, presence.userId),
				)
				.where(({ user }) => eq(user.userType, "user"))
				.select(({ member, user, presence }) => ({
					...user,
					role: member.role,
					joinedAt: member.joinedAt,
					presence,
				})),
		queryKey: [organizationId],
	})

	const { user } = useAuth()

	const filteredMembers = useMemo(() => {
		if (!membersData || !searchQuery) return membersData || []

		return membersData.filter((member: any) => {
			const searchLower = searchQuery.toLowerCase()
			const fullName = `${member.firstName} ${member.lastName}`.toLowerCase()
			const email = member.email?.toLowerCase() || ""
			return fullName.includes(searchLower) || email.includes(searchLower)
		})
	}, [membersData, searchQuery])

	const handleOpenChat = async (targetUserId: UserId, targetUserName: string) => {
		if (!targetUserId || !user?.id || !organizationId) return

		// Check if a DM channel already exists in this organization
		const existingChannel = findExistingDmChannel(user.id, [targetUserId], organizationId)

		if (existingChannel) {
			navigate({
				to: "/$orgSlug/chat/$id",
				params: { orgSlug, id: existingChannel.id },
			})
		} else {
			await exitToastAsync(
				createDmChannel({
					payload: {
						organizationId,
						participantIds: [targetUserId as UserId],
						type: "single",
					},
				}),
			)
				.loading(`Starting conversation with ${targetUserName}...`)
				.onSuccess((result) => {
					if (result.data.id) {
						navigate({
							to: "/$orgSlug/chat/$id",
							params: { orgSlug, id: result.data.id },
						})
					}
				})
				.successMessage(`Started conversation with ${targetUserName}`)
				.run()
		}
	}

	const handleCopyEmail = async (email: string) => {
		try {
			await navigator.clipboard.writeText(email)
			toast.success("Email copied", {
				description: `${email} copied to clipboard`,
			})
		} catch (_error) {
			toast.error("Failed to copy email", {
				description: "Please try again",
			})
		}
	}

	return (
		<div className="flex flex-col gap-6 px-4 py-6 lg:px-8">
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="space-y-0.5">
						<SectionHeader.Heading size="xl">Members</SectionHeader.Heading>
						<SectionHeader.Subheading>
							Explore your organization and connect with fellow members.
						</SectionHeader.Subheading>
					</div>
				</SectionHeader.Group>
			</SectionHeader.Root>

			<div className="w-full">
				<SearchField autoFocus className="w-full">
					<SearchInput
						placeholder="Search members..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
				</SearchField>
			</div>

			<div className="w-full space-y-2">
				{!membersData ? (
					<div className="flex items-center justify-center py-8">
						<Loader className="size-8" />
					</div>
				) : filteredMembers.length === 0 ? (
					<div className="py-8 text-center text-muted-fg">
						{searchQuery
							? "No members found matching your search"
							: "No members in this organization"}
					</div>
				) : (
					filteredMembers.map((member) => {
						const fullName = `${member.firstName} ${member.lastName}`.trim()
						const isCurrentUser = user && user.id === member.id
						const getInitials = (name: string) => {
							const [firstName, lastName] = name.split(" ")
							return `${firstName?.charAt(0)}${lastName?.charAt(0)}`
						}
						return (
							<div
								key={member.id}
								className={cn(
									"flex items-center justify-between gap-4 rounded-lg px-3 py-2",
									!isCurrentUser &&
										"group border border-transparent hover:border-border hover:bg-secondary/40",
								)}
							>
								<div className="flex items-center gap-2 sm:gap-2.5">
									<div className="relative">
										<Avatar
											src={member.avatarUrl}
											initials={getInitials(fullName || "User")}
											className="size-9"
										/>
										{/* Presence indicator */}
										{member.presence?.status && (
											<span
												className={cn(
													"absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-bg",
													getStatusDotColor(member.presence.status),
												)}
											/>
										)}
									</div>
									<div>
										<div className="flex items-center font-semibold text-sm/6">
											{fullName || "Unknown User"}
											<span className="mx-2 text-muted-fg">&middot;</span>
											{member.role && (
												<span className="text-muted-fg text-xs capitalize">
													{member.role}{" "}
													{member.role === "admin" && (
														<span className="ml-1">👑</span>
													)}
												</span>
											)}
										</div>
										<p className="text-muted-fg text-xs">{member.email}</p>
									</div>
								</div>

								{!isCurrentUser && (
									<div className="flex items-center gap-2">
										<Button
											intent="secondary"
											size="sm"
											onPress={() => handleOpenChat(member.id, fullName)}
											className="hidden border-transparent pressed:bg-muted group-hover:border-border sm:inline-flex"
										>
											<IconMsgs data-slot="icon" />
										</Button>
										<Menu>
											<MenuTrigger
												aria-label="Member actions"
												className={cn(
													"inline-flex size-8 items-center justify-center rounded-lg border border-transparent hover:border-border hover:bg-secondary",
													"pressed:bg-secondary group-hover:border-border",
												)}
											>
												<IconDots className="size-5 text-muted-fg" />
											</MenuTrigger>
											<MenuContent placement="bottom end">
												<MenuItem
													onAction={() => handleOpenChat(member.id, fullName)}
												>
													<IconMsgs data-slot="icon" />
													<DropdownLabel>Message</DropdownLabel>
												</MenuItem>
												<MenuItem>
													<IconCircleDottedUser data-slot="icon" />
													<DropdownLabel>View profile</DropdownLabel>
												</MenuItem>
												<MenuItem>
													<IconPhone data-slot="icon" />
													<DropdownLabel>Start call</DropdownLabel>
												</MenuItem>
												<MenuItem onAction={() => handleCopyEmail(member.email)}>
													<IconCopy data-slot="icon" />
													<DropdownLabel>Copy email</DropdownLabel>
												</MenuItem>
											</MenuContent>
										</Menu>
									</div>
								)}
							</div>
						)
					})
				)}
			</div>
		</div>
	)
}
