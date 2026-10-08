import type { AttachmentId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import type * as Draft from "../../composer/draft"
import { draftView, type DraftViewInputs, type ReplyPreview } from "../../composer/draft-view"
import { identityOf, toDeriveContext } from "./derive"
import type { AttachmentInfo } from "./lookups"
import type { Model } from "./channel/model"

/** The channel's composer area (`$id/index.tsx` > `SlateMessageComposer`) and its reply preview. */

let lastReply: ReplyPreview | null = null

/** The reply a draft is composing, reusing the previous object while it shows the same text. */
export const replyPreviewOf = (model: Model, draft: Draft.Model): ReplyPreview | null => {
	const replyTo = draft.replyToMessageId
	const message =
		replyTo === null
			? undefined
			: (model.messages.find((candidate) => candidate.id === replyTo) ??
				model.threadMessages.find((candidate) => candidate.id === replyTo))
	if (message === undefined) return (lastReply = null)
	const author = identityOf(toDeriveContext(model.lookups, model.currentUserId ?? undefined), message.authorId)
	const next = { authorName: author?.displayName ?? "", firstLine: message.content.split("\n")[0] ?? "" }
	if (lastReply !== null && lastReply.authorName === next.authorName && lastReply.firstLine === next.firstLine)
		return lastReply
	return (lastReply = next)
}

/** `useLiveQuery(attachmentCollection, inArray(id, attachmentIds))`, from the channel's attachments. */
export const attachmentInfoFrom =
	(attachments: ReadonlyArray<AttachmentInfo>) =>
	(id: AttachmentId): { readonly fileName: string; readonly fileSize: number } | null =>
		attachments.find((attachment) => attachment.id === id) ?? null

/** The padded composer area: the typing indicator above the draft's composer. */
export const composerAreaView = <M>(h: HtmlBuilder<M>, typing: Html, draft: Draft.Model, inputs: DraftViewInputs<M>): Html =>
	h.div([h.Class("relative shrink-0 px-4 pb-4 pt-2.5")], [typing, draftView(h, draft, inputs)])
