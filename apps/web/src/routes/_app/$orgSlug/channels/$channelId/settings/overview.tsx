import { useAtomSet } from "@effect/atom-react"
import type { ChannelIcon as ChannelIconType, ChannelId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { type } from "arktype"
import { useState } from "react"
import { updateChannelMutation } from "~/atoms/channel-atoms"
import { ChannelIcon } from "~/components/channel-icon"
import { EmojiPickerDialog } from "~/components/emoji-picker/emoji-picker-dialog"
import IconClose from "~/components/icons/icon-close"
import { Button } from "~/components/ui/button"
import { FieldError, Label } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { SectionHeader } from "~/components/ui/section-header"
import { TextField } from "~/components/ui/text-field"
import { channelCollection } from "~/db/collections"
import { useAppForm } from "~/hooks/use-app-form"
import { exitToast } from "~/lib/toast-exit"

export const Route = createFileRoute("/_app/$orgSlug/channels/$channelId/settings/overview")({
	component: OverviewPage,
})

const channelSchema = type({
	name: "1<string<101",
})

type ChannelFormData = typeof channelSchema.infer

// Extracted form component - uses key prop in parent to reset when channel changes
function ChannelSettingsForm({
	channelId,
	initialName,
	initialIcon,
}: {
	channelId: ChannelId
	initialName: string
	initialIcon: ChannelIconType | null
}) {
	const [icon, setIcon] = useState<ChannelIconType | null>(initialIcon)
	const [iconDirty, setIconDirty] = useState(false)

	const updateChannel = useAtomSet(updateChannelMutation, {
		mode: "promiseExit",
	})

	const form = useAppForm({
		defaultValues: {
			name: initialName,
		} as ChannelFormData,
		validators: {
			onChange: channelSchema,
		},
		onSubmit: async ({ value }) => {
			const exit = await updateChannel({
				payload: {
					id: channelId,
					name: value.name,
					icon,
				},
			})

			exitToast(exit)
				.onSuccess(() => setIconDirty(false))
				.successMessage("Channel updated successfully")
				.onErrorTag("ChannelNotFoundError", () => ({
					title: "Channel not found",
					description: "This channel may have been deleted.",
					isRetryable: false,
				}))
				.run()
		},
	})

	const handleIconChange = (emoji: string | null) => {
		setIcon(emoji as ChannelIconType | null)
		setIconDirty(emoji !== initialIcon)
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				form.handleSubmit()
			}}
			className="flex flex-col gap-6"
		>
			<div className="flex flex-col gap-2">
				<Label>Channel Icon</Label>
				<div className="flex items-center gap-2">
					<EmojiPickerDialog onEmojiSelect={(emoji) => handleIconChange(emoji.emoji)}>
						<Button intent="outline" size="sq-md" type="button" className="text-xl">
							<ChannelIcon icon={icon} />
						</Button>
					</EmojiPickerDialog>
					{icon && (
						<Button
							intent="plain"
							size="sq-sm"
							type="button"
							onPress={() => handleIconChange(null)}
							className="text-muted-fg hover:text-fg"
						>
							<IconClose className="size-4" />
						</Button>
					)}
					<span className="text-muted-fg text-sm">
						{icon ? "Click to change icon" : "Click to add an emoji icon"}
					</span>
				</div>
			</div>

			<form.AppField
				name="name"
				children={(field) => (
					<TextField>
						<Label>Channel name</Label>
						<Input
							placeholder="Channel name"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							aria-invalid={!!field.state.meta.errors?.length}
						/>
						{field.state.meta.errors?.[0] && (
							<FieldError>{field.state.meta.errors[0].message}</FieldError>
						)}
					</TextField>
				)}
			/>

			<div>
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.isDirty]}>
					{([canSubmit, isSubmitting, isDirty]) => (
						<Button
							intent="primary"
							type="submit"
							isDisabled={!canSubmit || isSubmitting || (!isDirty && !iconDirty)}
						>
							{isSubmitting ? "Saving..." : "Save changes"}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	)
}

function OverviewPage() {
	const { channelId } = Route.useParams()

	const { data: channelResult } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId as ChannelId))
				.findOne()
				.select(({ channel }) => ({ channel })),
		queryKey: [channelId],
	})
	const channel = channelResult?.channel

	return (
		<div className="flex flex-col gap-6 px-4 lg:px-8">
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="flex flex-1 flex-col justify-center gap-1">
						<SectionHeader.Heading>Overview</SectionHeader.Heading>
						<SectionHeader.Subheading>
							General information about this channel.
						</SectionHeader.Subheading>
					</div>
				</SectionHeader.Group>
			</SectionHeader.Root>

			{/* Key prop resets form when channel changes - no useEffect needed */}
			{channel && (
				<ChannelSettingsForm
					key={channel.id}
					channelId={channel.id}
					initialName={channel.name}
					initialIcon={channel.icon}
				/>
			)}
		</div>
	)
}
