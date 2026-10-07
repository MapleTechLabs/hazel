import { toast } from "sonner"
import { Button } from "~/components/ui/button"
import { GallerySection } from "../frame"

export const title = "Toast"

// The app's global Toaster renders these. Infinite durations keep captures independent of timing.
const persistent = { duration: Number.POSITIVE_INFINITY }

const kinds = [
	{ label: "Default", show: () => toast("Message copied", persistent) },
	{ label: "Success", show: () => toast.success("Channel created", persistent) },
	{ label: "Error", show: () => toast.error("Couldn't send message", persistent) },
	{ label: "Info", show: () => toast.info("You're offline", persistent) },
	{ label: "Warning", show: () => toast.warning("Storage almost full", persistent) },
]

const content = [
	{
		label: "With description",
		show: () =>
			toast.success("Invitation sent", {
				...persistent,
				description: "ada@hazel.sh will get an email with a link to join.",
			}),
	},
	{
		label: "With action",
		show: () =>
			toast("Message deleted", { ...persistent, action: { label: "Undo", onClick: () => undefined } }),
	},
]

const async = [
	{ label: "Loading", show: () => toast.loading("Uploading attachment…", persistent) },
	{
		label: "Promise",
		show: () =>
			toast.promise(Promise.resolve(), {
				...persistent,
				loading: "Saving changes…",
				success: "Changes saved",
			}),
	},
]

const buttons = (items: ReadonlyArray<{ label: string; show: () => unknown }>) =>
	items.map((item) => (
		<Button key={item.label} intent="outline" onPress={() => item.show()}>
			{item.label}
		</Button>
	))

export function Gallery() {
	return (
		<>
			<GallerySection title="Kinds">{buttons(kinds)}</GallerySection>
			<GallerySection title="Content">{buttons(content)}</GallerySection>
			<GallerySection title="Async">{buttons(async)}</GallerySection>
		</>
	)
}
