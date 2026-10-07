import { IconCopy } from "~/components/icons/icon-copy"
import { IconReply } from "~/components/icons/icon-reply"
import { IconTrash } from "~/components/icons/icon-trash"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { GallerySection } from "../frame"

export const title = "Context menu"

export function Gallery() {
	return (
		<GallerySection title="Context menu">
			<ContextMenu>
				<ContextMenuTrigger className="flex h-32 w-80 items-center justify-center rounded-lg border border-dashed text-muted-fg text-sm">
					Right-click this message
				</ContextMenuTrigger>
				<ContextMenuContent className="min-w-56">
					<ContextMenuItem>
						<IconReply className="size-4" />
						<ContextMenuLabel>Reply</ContextMenuLabel>
					</ContextMenuItem>
					<ContextMenuItem>
						<IconCopy className="size-4" />
						<ContextMenuLabel>Copy text</ContextMenuLabel>
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem intent="danger">
						<IconTrash className="size-4" />
						<ContextMenuLabel>Delete message</ContextMenuLabel>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</GallerySection>
	)
}
