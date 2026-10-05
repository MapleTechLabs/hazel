import { useAtomSet } from "@effect/atom-react"
import type { User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { type } from "arktype"
import { useCallback, useMemo, useState } from "react"
import { createDmChannelMutation } from "~/atoms/channel-atoms"
import IconCheck from "~/components/icons/icon-check"
import IconEnvelope from "~/components/icons/icon-envelope"
import IconMsgs from "~/components/icons/icon-msgs"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Description } from "~/components/ui/field"
import { Input, InputGroup } from "~/components/ui/input"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "~/components/ui/modal"
import { organizationMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { useAppForm } from "~/hooks/use-app-form"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { findExistingDmChannel } from "~/lib/channels"
import { exitToastAsync } from "~/lib/toast-exit"

const dmFormSchema = type({
	userIds: "string[]",
})

type DmFormData = typeof dmFormSchema.infer

interface CreateDmModalProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
}

export function CreateDmModal({ isOpen, onOpenChange }: CreateDmModalProps) {
	const [searchQuery, setSearchQuery] = useState("")

	const navigate = useNavigate()
	const { organizationId, slug } = useOrganization()
	const { user } = useAuth()

	const createDmChannel = useAtomSet(createDmChannelMutation, {
		mode: "promiseExit",
	})

	// Query organization users with presence status
	const { data: organizationUsers } = useLiveQuery({
		query: (q) =>
			q
				.from({ member: organizationMemberCollection })
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.leftJoin({ presence: userPresenceStatusCollection }, ({ user, presence }) =>
					eq(user.id, presence.userId),
				)
				.where(({ member }) => eq(member.organizationId, organizationId || ""))
				.where(({ user }) => eq(user.userType, "user"))
				.select(({ user, presence }) => ({
					...user,
					presence,
				})),
		queryKey: [organizationId],
	})

	const form = useAppForm({
		defaultValues: {
			userIds: [],
		} as DmFormData,
		validators: {
			onChange: dmFormSchema,
		},
		onSubmit: async ({ value }) => {
			if (!value.userIds || value.userIds.length === 0 || !user?.id || !organizationId || !slug) return

			// Determine if it's a single DM or group
			const type = value.userIds.length === 1 ? "single" : "direct"

			// Get selected users for group name
			const selectedUserNames =
				value.userIds.length > 1
					? organizationUsers
							?.filter((u) => value.userIds.includes(u?.id || ""))
							?.map((u) => u?.firstName || "")
							?.slice(0, 3)
							?.join(", ")
					: undefined

			const targetUser = organizationUsers?.find((u) => u?.id === value.userIds[0])

			// Check if channel already exists locally (within the current organization)
			const existingChannel = findExistingDmChannel(user.id, value.userIds as UserId[], organizationId)

			// If channel already exists, navigate directly to it
			if (existingChannel) {
				navigate({
					to: "/$orgSlug/chat/$id",
					params: { orgSlug: slug, id: existingChannel.id },
				})
				return handleClose()
			}
			await exitToastAsync(
				createDmChannel({
					payload: {
						organizationId,
						participantIds: value.userIds as UserId[],
						type,
						name: type === "direct" ? selectedUserNames : undefined,
					},
				}),
			)
				.loading("Creating conversation...")
				.onSuccess((result) => {
					navigate({
						to: "/$orgSlug/chat/$id",
						params: { orgSlug: slug, id: result.data.id },
					})
					handleClose()
				})
				.successMessage(() =>
					type === "single"
						? `Started conversation with ${targetUser?.firstName}`
						: `Created group conversation with ${value.userIds.length} people`,
				)
				.run()
		},
	})

	// Filter users by search query
	const filteredUsers = useMemo(() => {
		const users = organizationUsers || []
		// Filter out current user
		const otherUsers = users.filter((u) => u?.id !== user?.id)

		if (!searchQuery.trim()) return otherUsers

		const query = searchQuery.toLowerCase()
		return otherUsers.filter((user) => {
			if (!user) return false
			const firstName = user.firstName || ""
			const lastName = user.lastName || ""
			const fullName = `${firstName} ${lastName}`.trim()
			return (
				firstName.toLowerCase().includes(query) ||
				lastName.toLowerCase().includes(query) ||
				fullName.toLowerCase().includes(query)
			)
		})
	}, [organizationUsers, searchQuery, user?.id])

	// Derive selected users from form state - single source of truth
	const selectedUserIds = form.state.values.userIds
	const selectedUsers = useMemo(
		() =>
			organizationUsers?.filter(
				(u): u is NonNullable<typeof u> => u != null && selectedUserIds.includes(u.id),
			) ?? [],
		[organizationUsers, selectedUserIds],
	)

	const handleClose = () => {
		onOpenChange(false)
		// Reset form and state when closing
		form.reset()
		setSearchQuery("")
	}

	// Stable callback for toggling user selection - only updates form state
	const toggleUserSelection = useCallback(
		(targetUser: User.Type) => {
			const currentIds = form.state.values.userIds
			const isSelected = currentIds.includes(targetUser.id)
			const newIds = isSelected
				? currentIds.filter((id) => id !== targetUser.id)
				: [...currentIds, targetUser.id]
			form.setFieldValue("userIds", newIds)
		},
		[form],
	)

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent size="lg">
				<ModalHeader>
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-lg bg-primary-subtle">
							<IconMsgs className="size-5 text-primary" />
						</div>
						<div className="flex flex-col">
							<ModalTitle>Start a conversation</ModalTitle>
							<Description>Select one or more team members to start a conversation</Description>
						</div>
					</div>
				</ModalHeader>

				<ModalBody className="flex flex-col gap-4">
					{/* Search Input */}
					<div className="flex flex-col gap-2">
						<InputGroup>
							<IconEnvelope data-slot="icon" className="text-muted-fg" />
							<Input
								placeholder="Search team members..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								autoFocus
							/>
						</InputGroup>
						{selectedUsers.length > 0 && (
							<div className="flex items-center gap-2">
								<span className="text-muted-fg text-sm">{selectedUsers.length} selected</span>
								<div className="flex -space-x-2">
									{selectedUsers.slice(0, 3).map((user) => (
										<Avatar
											key={user.id}
											size="xs"
											src={user.avatarUrl || undefined}
											initials={`${user.firstName?.charAt(0) || ""}${user.lastName?.charAt(0) || ""}`}
										/>
									))}
									{selectedUsers.length > 3 && (
										<div className="flex size-6 items-center justify-center rounded-full bg-secondary font-medium text-xs">
											+{selectedUsers.length - 3}
										</div>
									)}
								</div>
							</div>
						)}
					</div>

					{/* Users List */}
					<div className="max-h-96 overflow-y-auto">
						{filteredUsers.length === 0 ? (
							<p className="py-8 text-center text-muted-fg text-sm">
								{searchQuery ? "No users found" : "No team members available"}
							</p>
						) : (
							<div className="flex flex-col gap-1">
								{filteredUsers.map((user) => {
									const isSelected = selectedUserIds.includes(user?.id ?? "")
									return (
										<button
											key={user?.id}
											type="button"
											onClick={() => user && toggleUserSelection(user)}
											className={`flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-secondary ${
												isSelected
													? "bg-secondary ring-2 ring-primary ring-inset"
													: ""
											}`}
										>
											<div className="flex items-center gap-3">
												<Avatar
													size="sm"
													src={user?.avatarUrl || undefined}
													initials={`${user?.firstName?.charAt(0) || ""}${user?.lastName?.charAt(0) || ""}`}
												/>
												<div className="flex flex-col">
													<p className="font-medium text-sm">
														{user?.firstName || ""} {user?.lastName || ""}
													</p>
													{user?.presence?.status === "online" && (
														<span className="text-success text-xs">
															Active now
														</span>
													)}
													{user?.presence?.customMessage && (
														<span className="truncate text-muted-fg text-xs">
															{user.presence.customMessage}
														</span>
													)}
												</div>
											</div>
											{isSelected && <IconCheck className="size-5 text-primary" />}
										</button>
									)
								})}
							</div>
						)}
					</div>
				</ModalBody>

				<ModalFooter>
					<Button intent="outline" onPress={handleClose} isDisabled={form.state.isSubmitting}>
						Cancel
					</Button>
					<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
						{([canSubmit, isSubmitting]) => (
							<Button
								intent="primary"
								onPress={form.handleSubmit}
								isDisabled={!canSubmit || isSubmitting || selectedUsers.length === 0}
							>
								{isSubmitting
									? "Creating..."
									: selectedUsers.length > 1
										? `Start group conversation (${selectedUsers.length})`
										: "Start conversation"}
							</Button>
						)}
					</form.Subscribe>
				</ModalFooter>
			</ModalContent>
		</Modal>
	)
}
