import { Atom } from "effect/reactivity"
import type { AttachmentId, ChannelId, MessageId } from "@hazel/schema"

/**
 * Per-channel reply state using Atom.family
 * Each channel gets its own isolated reply state
 */
export const replyToMessageAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<MessageId | null>(null).pipe(Atom.keepAlive),
)

/**
 * Per-channel edit mode state
 * Stores the MessageId being edited, or null if not editing
 */
export const editingMessageAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<MessageId | null>(null).pipe(Atom.keepAlive),
)

/**
 * Global active thread channel ID
 * Threads are app-wide, not per-channel
 */
export const activeThreadChannelIdAtom = Atom.make<ChannelId | null>(null).pipe(Atom.keepAlive)

/**
 * Global active thread message ID
 * Tracks which message the thread is for
 */
export const activeThreadMessageIdAtom = Atom.make<MessageId | null>(null).pipe(Atom.keepAlive)

/**
 * Per-channel scroll state tracking
 * Tracks whether the user is currently at the bottom of the scroll container
 * Managed by the useScrollToBottom hook via IntersectionObserver
 */
export const isAtBottomAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<boolean>(true).pipe(Atom.keepAlive),
)

/**
 * Per-channel uploaded attachments ready to be sent
 * Stores AttachmentIds of files that have been uploaded and are ready to attach to a message
 */
export const uploadedAttachmentsAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<AttachmentId[]>([]).pipe(Atom.keepAlive),
)

/**
 * Per-channel upload state
 * Tracks whether files are currently being uploaded to prevent message sending
 */
export const isUploadingAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<boolean>(false).pipe(Atom.keepAlive),
)

/**
 * Per-channel uploading files
 * Tracks files currently being uploaded with their metadata for display in composer
 */
export interface UploadingFile {
	fileId: string
	fileName: string
	fileSize: number
	progress: number
}

export const uploadingFilesAtomFamily = Atom.family((_channelId: ChannelId) =>
	Atom.make<UploadingFile[]>([]).pipe(Atom.keepAlive),
)
