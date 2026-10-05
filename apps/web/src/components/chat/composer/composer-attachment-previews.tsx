import { inArray, useLiveQuery } from "@tanstack/react-db"
import { FileIcon } from "@untitledui/file-icons"
import IconClose from "~/components/icons/icon-close"
import { Button } from "~/components/ui/button"
import { Loader } from "~/components/ui/loader"
import { attachmentCollection } from "~/db/collections"
import { cn } from "~/lib/utils"
import { useChatDraft, useChatStable } from "~/providers/chat-provider"
import { formatFileSize, getFileTypeFromName } from "~/utils/file-utils"

interface ComposerAttachmentPreviewsProps {
	className?: string
}

export function ComposerAttachmentPreviews({ className }: ComposerAttachmentPreviewsProps) {
	const { attachmentIds, uploadingFiles, replyToMessageId } = useChatDraft()
	const { removeAttachment } = useChatStable()

	const { data: attachments } = useLiveQuery({
		query: (q) =>
			q
				.from({
					attachments: attachmentCollection,
				})
				.where(({ attachments }) => inArray(attachments.id, attachmentIds)),
		queryKey: [attachmentIds],
	})

	if (attachmentIds.length === 0 && uploadingFiles.length === 0) {
		return null
	}

	return (
		<div
			className={cn(
				"border border-border border-b-0 bg-secondary px-2 py-1",
				uploadingFiles.length > 0 ? "rounded-t-none border-t-0" : "rounded-t-lg",
				replyToMessageId && "border-b-0",
				className,
			)}
		>
			<div className="grid grid-cols-2 gap-1 md:grid-cols-3 lg:grid-cols-4">
				{attachmentIds.map((attachmentId) => {
					const attachment = attachments?.find((a) => a?.id === attachmentId)
					const fileName = attachment?.fileName || "File"
					const fileSize = attachment?.fileSize || 0
					const fileType = getFileTypeFromName(fileName)

					return (
						<div
							key={attachmentId}
							className="group flex items-center gap-2 rounded-lg bg-bg p-2 transition-colors hover:bg-secondary"
						>
							<FileIcon type={fileType} className="size-8 shrink-0 text-muted-fg" />
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-fg text-sm">{fileName}</div>
								<div className="text-muted-fg text-xs">{formatFileSize(fileSize)}</div>
							</div>
							<Button
								intent="plain"
								size="sq-xs"
								onPress={() => removeAttachment(attachmentId)}
							>
								<IconClose data-slot="icon" />
							</Button>
						</div>
					)
				})}

				{uploadingFiles.map((file) => {
					const fileType = getFileTypeFromName(file.fileName)
					const progress = file.progress ?? 0

					return (
						<div
							key={file.fileId}
							className="group relative flex items-center gap-2 overflow-hidden rounded-lg bg-bg p-2 transition-colors hover:bg-secondary"
						>
							<FileIcon type={fileType} className="size-8 shrink-0 text-muted-fg" />
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-fg text-sm">{file.fileName}</div>
								<div className="text-muted-fg text-xs">
									{progress < 100
										? `${progress}% of ${formatFileSize(file.fileSize)}`
										: formatFileSize(file.fileSize)}
								</div>
							</div>
							<Loader className="size-4" />
							{/* Progress bar */}
							<div className="absolute inset-x-0 -bottom-px h-1 bg-muted">
								<div
									className="h-full bg-primary transition-all duration-200"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
