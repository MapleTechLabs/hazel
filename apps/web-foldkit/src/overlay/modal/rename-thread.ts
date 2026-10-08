import { ChannelId } from "@hazel/schema"
import * as Requests from "./requests"
import { defineModal } from "./contract"
import { Message, Model, renameModalSpec } from "./rename-channel"

/** `components/modals/rename-thread-modal.tsx`: the rename-channel modal with thread copy. */

const spec = renameModalSpec({
	id: "rename-thread-modal",
	title: "Rename Thread",
	description: "Enter a new name for this thread",
	label: "Thread Name",
	placeholder: "Thread name",
	successMessage: "Thread renamed successfully",
	notFound: {
		title: "Thread not found",
		description: "This thread may have been deleted.",
		isRetryable: false,
	},
})

export const modal = defineModal(
	"RenameThread",
	{ request: Requests.RenameThread, Model, Message },
	{ ...spec, init: ({ threadId }) => spec.init(threadId) },
)
