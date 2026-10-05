import { useAtomSet } from "@effect/atom-react"
import { CustomEmojiDeletedExistsError } from "@hazel/domain/rpc"
import { eq, isNull, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { formatDistanceToNow } from "date-fns"
import { toDate } from "~/lib/utils"
import { Cause, Exit } from "effect"
import { useCallback, useEffect, useState } from "react"
import { type DropItem, DropZone, FileTrigger, Button as AriaButton } from "react-aria-components"
import { toast } from "sonner"
import { IconArrowPath } from "~/components/icons/icon-arrow-path"
import IconEmoji1 from "~/components/icons/icon-emoji-1"
import IconEmojiAdd from "~/components/icons/icon-emoji-add"
import IconTrash from "~/components/icons/icon-trash"
import { IconWarning } from "~/components/icons/icon-warning"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardHeader } from "~/components/ui/card"
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog"
import { EmptyState } from "~/components/ui/empty-state"
import { Description, FieldError, Label } from "~/components/ui/field"
import { Input, InputGroup } from "~/components/ui/input"
import { Modal, ModalContent } from "~/components/ui/modal"
import { TextField } from "~/components/ui/text-field"
import { createCustomEmojiAction, deleteCustomEmojiAction, restoreCustomEmojiAction } from "~/db/actions"
import { customEmojiCollection, userCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { usePermission } from "~/hooks/use-permission"
import { ALLOWED_EMOJI_TYPES, MAX_EMOJI_SIZE, useUpload } from "~/hooks/use-upload"
import { useAuth } from "~/lib/auth"
import { cx } from "~/utils/cx"
import type { CustomEmojiId } from "@hazel/schema"

export const Route = createFileRoute("/_app/$orgSlug/settings/custom-emojis")({
	component: CustomEmojisSettings,
})

const NAME_PATTERN = /^[a-z0-9_-]+$/

function generateEmojiName(filename: string): string {
	return filename
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64)
}

function validateEmojiName(name: string): string | null {
	if (!name) return "Name is required"
	if (name.length > 64) return "Name must be 64 characters or less"
	if (!NAME_PATTERN.test(name)) return "Only lowercase letters, numbers, hyphens, and underscores"
	return null
}

function CustomEmojisSettings() {
	const { organizationId, organization } = useOrganization()
	const { user } = useAuth()
	const { isAdmin, isLoading: isPermissionsLoading } = usePermission()

	const [deleteTarget, setDeleteTarget] = useState<{ id: CustomEmojiId; name: string } | null>(null)
	const [restoreTarget, setRestoreTarget] = useState<{
		id: CustomEmojiId
		name: string
		imageUrl: string
		newImageUrl: string
	} | null>(null)

	// Upload zone state
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [previewUrl, setPreviewUrl] = useState<string | null>(null)
	const [emojiName, setEmojiName] = useState("")
	const [nameError, setNameError] = useState<string | null>(null)
	const [isSaving, setIsSaving] = useState(false)

	const { upload, isUploading } = useUpload()

	const createCustomEmoji = useAtomSet(createCustomEmojiAction, { mode: "promiseExit" })
	const deleteCustomEmoji = useAtomSet(deleteCustomEmojiAction, { mode: "promiseExit" })
	const restoreCustomEmoji = useAtomSet(restoreCustomEmojiAction, { mode: "promiseExit" })

	// Cleanup preview URL on unmount
	useEffect(() => {
		return () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl)
		}
	}, [previewUrl])

	// Get custom emojis for this org with creator info
	const { data: customEmojis, isLoading: isLoadingEmojis } = useLiveQuery({
		query: (q) =>
			q
				.from({ emoji: customEmojiCollection })
				.where(({ emoji }) => eq(emoji.organizationId, organizationId))
				.where(({ emoji }) => isNull(emoji.deletedAt))
				.innerJoin({ creator: userCollection }, ({ emoji, creator }) =>
					eq(emoji.createdBy, creator.id),
				)
				.orderBy(({ emoji }) => emoji.createdAt, "desc")
				.select(({ emoji, creator }) => ({
					...emoji,
					creatorFirstName: creator.firstName,
					creatorLastName: creator.lastName,
				})),
		queryKey: [organizationId],
	})

	// File selection handler (shared by FileTrigger and DropZone)
	const processFile = useCallback((file: File) => {
		if (!ALLOWED_EMOJI_TYPES.includes(file.type)) {
			toast.error("Invalid file type", { description: "Please select a PNG, GIF, or WebP image" })
			return
		}

		if (file.size > MAX_EMOJI_SIZE) {
			toast.error("File too large", { description: "Emoji images must be under 256KB" })
			return
		}

		const url = URL.createObjectURL(file)
		setSelectedFile(file)
		setPreviewUrl(url)
		const name = generateEmojiName(file.name)
		setEmojiName(name)
		setNameError(name ? null : "Name is required")
	}, [])

	const handleFileSelect = useCallback(
		(files: FileList | null) => {
			const file = files?.[0]
			if (file) processFile(file)
		},
		[processFile],
	)

	const handleDrop = useCallback(
		async (e: { items: DropItem[] }) => {
			const fileItem = e.items.find(
				(item): item is DropItem & { kind: "file"; getFile: () => Promise<File> } =>
					item.kind === "file",
			)
			if (!fileItem) return
			const file = await fileItem.getFile()
			processFile(file)
		},
		[processFile],
	)

	const handleCancel = useCallback(() => {
		if (previewUrl) URL.revokeObjectURL(previewUrl)
		setSelectedFile(null)
		setPreviewUrl(null)
		setEmojiName("")
		setNameError(null)
	}, [previewUrl])

	const handleNameChange = useCallback((value: string) => {
		const lower = value.toLowerCase()
		setEmojiName(lower)
		setNameError(validateEmojiName(lower))
	}, [])

	const handleSave = async () => {
		const error = validateEmojiName(emojiName)
		if (error) {
			setNameError(error)
			return
		}
		if (!selectedFile || !organizationId || !user) return

		setIsSaving(true)
		const r2PublicUrl = import.meta.env.VITE_R2_PUBLIC_URL
		try {
			const result = await upload({
				type: "custom-emoji",
				organizationId,
				file: selectedFile,
			})

			if (!result) return

			if (!r2PublicUrl) {
				toast.error("Configuration error", {
					description: "Image upload is not configured. Please contact support.",
				})
				return
			}
			const publicUrl = `${r2PublicUrl}/${result.key}`

			const createResult = await createCustomEmoji({
				organizationId,
				name: emojiName,
				imageUrl: publicUrl,
				createdBy: user.id,
			})

			if (Exit.isSuccess(createResult)) {
				toast.success(`Emoji :${emojiName}: created`)
				handleCancel()
			} else {
				const deletedExistsError = createResult.cause.reasons
					.filter(Cause.isFailReason)
					.map((reason) => reason.error)
					.find(
						(error): error is CustomEmojiDeletedExistsError =>
							error instanceof CustomEmojiDeletedExistsError,
					)

				if (deletedExistsError) {
					setRestoreTarget({
						id: deletedExistsError.customEmojiId,
						name: deletedExistsError.name,
						imageUrl: deletedExistsError.imageUrl,
						newImageUrl: publicUrl,
					})
					return
				}
				toast.error("Failed to create emoji", {
					description: "The name may already be taken. Please try another.",
				})
			}
		} catch (error) {
			setIsSaving(false)
			throw error
		}
		setIsSaving(false)
	}

	const handleRestore = async () => {
		if (!restoreTarget || !user || !organizationId) return

		setIsSaving(true)
		setRestoreTarget(null)
		try {
			const result = await restoreCustomEmoji({
				emojiId: restoreTarget.id,
				organizationId,
				name: restoreTarget.name,
				imageUrl: restoreTarget.newImageUrl,
				createdBy: user.id,
			})

			if (Exit.isSuccess(result)) {
				toast.success(`Emoji :${restoreTarget.name}: restored`)
				handleCancel()
			} else {
				toast.error("Failed to restore emoji")
			}
		} catch (error) {
			setIsSaving(false)
			throw error
		}
		setIsSaving(false)
	}

	const handleDelete = async (emojiId: CustomEmojiId, emojiName: string) => {
		setDeleteTarget(null)
		const result = await deleteCustomEmoji({ emojiId })
		if (Exit.isSuccess(result)) {
			toast.success(`Emoji :${emojiName}: deleted`)
		} else {
			toast.error("Failed to delete emoji")
		}
	}

	if (!organizationId) return null

	const busy = isUploading || isSaving

	const imagesAreDifferent = restoreTarget && restoreTarget.imageUrl !== restoreTarget.newImageUrl

	return (
		<>
			<div className="flex flex-col gap-6 px-4 lg:px-8">
				<Card>
					<CardHeader>
						<div className="flex flex-col gap-0.5">
							<div className="flex items-center gap-2">
								<IconEmoji1 className="size-5 text-muted-fg" />
								<h2 className="font-semibold text-fg text-lg">Custom Emojis</h2>
								<Badge intent="secondary">
									{customEmojis?.length ?? 0} emoji
									{(customEmojis?.length ?? 0) !== 1 ? "s" : ""}
								</Badge>
							</div>
							<p className="text-muted-fg text-sm">
								Upload and manage custom emojis for your workspace.
							</p>
						</div>
					</CardHeader>

					{/* Upload Zone — admin only */}
					{(isAdmin || isPermissionsLoading) && (
						<div className="border-border border-b px-4 py-4 md:px-6">
							{!selectedFile ? (
								<DropZone
									getDropOperation={(types) =>
										types.has("image/png") ||
										types.has("image/gif") ||
										types.has("image/webp")
											? "copy"
											: "cancel"
									}
									onDrop={handleDrop}
									isDisabled={isPermissionsLoading || !isAdmin}
									className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
								>
									{({ isDropTarget }) => (
										<FileTrigger
											acceptedFileTypes={ALLOWED_EMOJI_TYPES}
											onSelect={handleFileSelect}
										>
											<AriaButton
												type="button"
												className={cx(
													"flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors",
													isDropTarget
														? "border-primary bg-primary/5"
														: "border-border bg-secondary/20 hover:border-muted-fg/40 hover:bg-secondary/40",
													(isPermissionsLoading || !isAdmin) &&
														"pointer-events-none opacity-50",
												)}
											>
												<IconEmojiAdd className="size-8 text-muted-fg" />
												<div className="text-center">
													<p className="font-medium text-fg text-sm">
														Drop an image or click to browse
													</p>
													<p className="mt-0.5 text-muted-fg text-xs">
														PNG, GIF, or WebP &middot; Max 256KB
													</p>
												</div>
											</AriaButton>
										</FileTrigger>
									)}
								</DropZone>
							) : (
								<div className="rounded-lg border border-border bg-bg p-4">
									<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
										{/* Preview */}
										<div className="flex size-24 shrink-0 items-center justify-center self-center overflow-hidden rounded-lg bg-secondary sm:self-start">
											{previewUrl && (
												<img
													src={previewUrl}
													alt="Emoji preview"
													className="size-24 object-contain"
												/>
											)}
										</div>

										{/* Form */}
										<div className="flex min-w-0 flex-1 flex-col gap-3">
											<TextField
												value={emojiName}
												onChange={handleNameChange}
												isInvalid={!!nameError}
												isDisabled={busy}
												maxLength={64}
												autoFocus
											>
												<Label>Name</Label>
												<InputGroup>
													<span data-slot="text" className="text-muted-fg">
														:
													</span>
													<Input placeholder="emoji_name" />
													<span data-slot="text" className="text-muted-fg">
														:
													</span>
												</InputGroup>
												<div className="mt-1 flex items-center justify-between gap-2">
													{nameError ? (
														<FieldError>{nameError}</FieldError>
													) : (
														<Description>
															Lowercase letters, numbers, hyphens, and
															underscores
														</Description>
													)}
													<span className="shrink-0 text-muted-fg text-xs tabular-nums">
														{emojiName.length}/64
													</span>
												</div>
											</TextField>

											<div className="flex items-center gap-2 sm:justify-end">
												<Button
													intent="secondary"
													size="sm"
													onPress={handleCancel}
													isDisabled={busy}
												>
													Cancel
												</Button>
												<Button
													intent="primary"
													size="sm"
													onPress={handleSave}
													isDisabled={busy || !!nameError || !emojiName}
												>
													{busy ? "Saving..." : "Save Emoji"}
												</Button>
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Emoji Table */}
					{isLoadingEmojis ? (
						<div className="overflow-x-auto">
							<table className="w-full min-w-full">
								<thead className="border-border border-b bg-bg">
									<tr>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Emoji
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Shortcode
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Added by
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Added
										</th>
										<th className="px-4 py-3 text-right font-medium text-muted-fg text-xs">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{Array.from({ length: 5 }).map((_, i) => (
										<tr key={i}>
											<td className="px-4 py-4">
												<div className="size-8 animate-pulse rounded-sm bg-secondary" />
											</td>
											<td className="px-4 py-4">
												<div className="h-4 w-24 animate-pulse rounded-sm bg-secondary" />
											</td>
											<td className="px-4 py-4">
												<div className="h-4 w-28 animate-pulse rounded-sm bg-secondary" />
											</td>
											<td className="px-4 py-4">
												<div className="h-4 w-20 animate-pulse rounded-sm bg-secondary" />
											</td>
											<td className="px-4 py-4 text-right">
												<div className="size-8 animate-pulse rounded-sm bg-secondary" />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : !customEmojis?.length ? (
						<EmptyState
							icon={IconEmoji1}
							title="No custom emojis yet"
							description="Upload custom emojis to use in messages across your workspace."
							action={
								isAdmin ? (
									<FileTrigger
										acceptedFileTypes={ALLOWED_EMOJI_TYPES}
										onSelect={handleFileSelect}
									>
										<Button intent="primary" size="sm">
											Upload emoji
										</Button>
									</FileTrigger>
								) : undefined
							}
						/>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-full">
								<thead className="border-border border-b bg-bg">
									<tr>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Emoji
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Shortcode
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Added by
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Added
										</th>
										<th className="px-4 py-3 text-right font-medium text-muted-fg text-xs">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{customEmojis.map((emoji) => (
										<tr key={emoji.id} className="hover:bg-secondary/50">
											<td className="px-4 py-4">
												<img
													src={emoji.imageUrl}
													alt={emoji.name}
													className="size-8 rounded object-contain"
												/>
											</td>
											<td className="px-4 py-4">
												<span className="font-medium text-fg text-sm">
													:{emoji.name}:
												</span>
											</td>
											<td className="px-4 py-4">
												<span className="text-muted-fg text-sm">
													{emoji.creatorFirstName} {emoji.creatorLastName}
												</span>
											</td>
											<td className="px-4 py-4">
												<span className="text-muted-fg text-sm">
													{emoji.createdAt
														? formatDistanceToNow(toDate(emoji.createdAt), {
																addSuffix: true,
															})
														: "—"}
												</span>
											</td>
											<td className="px-4 py-4">
												{isAdmin && (
													<div className="flex justify-end">
														<Button
															intent="danger"
															size="sq-sm"
															onPress={() =>
																setDeleteTarget({
																	id: emoji.id as CustomEmojiId,
																	name: emoji.name,
																})
															}
														>
															<IconTrash data-slot="icon" />
														</Button>
													</div>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</div>

			{/* Delete Confirmation Modal */}
			<Modal>
				<ModalContent
					isOpen={!!deleteTarget}
					onOpenChange={(open) => !open && setDeleteTarget(null)}
					size="md"
				>
					<Dialog>
						<DialogHeader>
							<div className="flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5">
								<IconWarning className="size-6 text-danger" />
							</div>
							<DialogTitle>Delete custom emoji</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete <strong>:{deleteTarget?.name}:</strong>?
								Messages that use this emoji will show the text code instead.
							</DialogDescription>
						</DialogHeader>

						<DialogFooter>
							<DialogClose intent="secondary">Cancel</DialogClose>
							<Button
								intent="danger"
								onPress={() =>
									deleteTarget && handleDelete(deleteTarget.id, deleteTarget.name)
								}
							>
								Delete emoji
							</Button>
						</DialogFooter>
					</Dialog>
				</ModalContent>
			</Modal>

			{/* Restore Confirmation Modal */}
			<Modal>
				<ModalContent
					isOpen={!!restoreTarget}
					onOpenChange={(open) => !open && setRestoreTarget(null)}
					size="md"
				>
					<Dialog>
						<DialogHeader>
							<div className="flex size-12 items-center justify-center rounded-lg border border-primary/10 bg-primary/5">
								<IconArrowPath className="size-6 text-primary" />
							</div>
							<DialogTitle>Restore deleted emoji</DialogTitle>
							<DialogDescription>
								An emoji named <strong>:{restoreTarget?.name}:</strong> was previously
								deleted. Would you like to restore it with your new image?
							</DialogDescription>
						</DialogHeader>

						{imagesAreDifferent && (
							<div className="flex items-center justify-center gap-6 py-2">
								<div className="flex flex-col items-center gap-1.5">
									<div className="flex size-16 items-center justify-center overflow-hidden rounded-lg bg-secondary">
										<img
											src={restoreTarget.imageUrl}
											alt="Previous"
											className="size-16 object-contain"
										/>
									</div>
									<span className="text-muted-fg text-xs">Previous</span>
								</div>
								<span className="text-muted-fg">&rarr;</span>
								<div className="flex flex-col items-center gap-1.5">
									<div className="flex size-16 items-center justify-center overflow-hidden rounded-lg bg-secondary">
										<img
											src={restoreTarget.newImageUrl}
											alt="New"
											className="size-16 object-contain"
										/>
									</div>
									<span className="text-muted-fg text-xs">New</span>
								</div>
							</div>
						)}

						<DialogFooter>
							<DialogClose intent="secondary">Cancel</DialogClose>
							<Button intent="primary" onPress={handleRestore}>
								Restore with new image
							</Button>
						</DialogFooter>
					</Dialog>
				</ModalContent>
			</Modal>
		</>
	)
}
