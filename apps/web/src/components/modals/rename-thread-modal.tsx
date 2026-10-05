import { useAtomSet } from "@effect/atom-react"
import type { ChannelId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type } from "arktype"
import { Button } from "~/components/ui/button"
import { Description, FieldError, Label } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "~/components/ui/modal"
import { TextField } from "~/components/ui/text-field"
import { updateChannelAction } from "~/db/actions"
import { channelCollection } from "~/db/collections"
import { useAppForm } from "~/hooks/use-app-form"
import { exitToast } from "~/lib/toast-exit"

const threadNameSchema = type({
	name: "string.trim",
})

type ThreadNameFormData = typeof threadNameSchema.infer

interface RenameThreadModalProps {
	threadId: ChannelId
	isOpen: boolean
	onOpenChange: (open: boolean) => void
}

export function RenameThreadModal({ threadId, isOpen, onOpenChange }: RenameThreadModalProps) {
	const { data: threadData } = useLiveQuery({
		query: (q) => q.from({ channel: channelCollection }).where((q) => eq(q.channel.id, threadId)),
		queryKey: [threadId],
	})

	const thread = threadData?.[0]

	const updateThread = useAtomSet(updateChannelAction, { mode: "promiseExit" })

	const form = useAppForm({
		defaultValues: {
			name: thread?.name || "",
		} as ThreadNameFormData,
		validators: {
			onChange: threadNameSchema,
		},
		onSubmit: async ({ value }) => {
			if (!thread) return

			const trimmedName = value.name.trim()

			if (trimmedName === thread.name) {
				onOpenChange(false)
				return
			}

			const exit = await updateThread({ channelId: thread.id, name: trimmedName })

			exitToast(exit)
				.onSuccess(() => {
					onOpenChange(false)
					form.reset()
				})
				.successMessage("Thread renamed successfully")
				.onErrorTag("ChannelNotFoundError", () => ({
					title: "Thread not found",
					description: "This thread may have been deleted.",
					isRetryable: false,
				}))
				.run()
		},
	})

	const handleClose = () => {
		onOpenChange(false)
		form.reset()
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent size="lg">
				<ModalHeader>
					<ModalTitle>Rename Thread</ModalTitle>
					<Description>Enter a new name for this thread</Description>
				</ModalHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault()
						form.handleSubmit()
					}}
				>
					<ModalBody className="flex flex-col gap-4">
						<form.AppField
							name="name"
							children={(field) => (
								<TextField>
									<Label>Thread Name</Label>
									<Input
										placeholder="Thread name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										aria-invalid={!!field.state.meta.errors?.length}
										autoFocus
									/>
									{field.state.meta.errors?.[0] && (
										<FieldError>{field.state.meta.errors[0].message}</FieldError>
									)}
								</TextField>
							)}
						/>
					</ModalBody>

					<ModalFooter>
						<Button intent="outline" onPress={handleClose} type="button">
							Cancel
						</Button>
						<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
							{([canSubmit, isSubmitting]) => (
								<Button
									intent="primary"
									type="submit"
									isDisabled={!canSubmit || isSubmitting}
								>
									{isSubmitting ? "Saving..." : "Rename"}
								</Button>
							)}
						</form.Subscribe>
					</ModalFooter>
				</form>
			</ModalContent>
		</Modal>
	)
}
