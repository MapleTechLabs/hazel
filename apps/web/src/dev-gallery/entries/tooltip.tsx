import { IconEdit } from "~/components/icons/icon-edit"
import { Button } from "~/components/ui/button"
import { Tooltip, TooltipContent } from "~/components/ui/tooltip"
import { GallerySection } from "../frame"

export const title = "Tooltip"

export function Gallery() {
	return (
		<>
			<GallerySection title="Placement">
				<Tooltip>
					<Button intent="outline">Top</Button>
					<TooltipContent>Add reaction</TooltipContent>
				</Tooltip>
				<Tooltip>
					<Button intent="outline">Bottom</Button>
					<TooltipContent placement="bottom">Shown below</TooltipContent>
				</Tooltip>
				<Tooltip>
					<Button intent="outline">Right</Button>
					<TooltipContent placement="right">Shown to the right</TooltipContent>
				</Tooltip>
			</GallerySection>
			<GallerySection title="Variants">
				<Tooltip>
					<Button intent="plain" size="sq-sm" aria-label="Rename thread">
						<IconEdit data-slot="icon" className="size-4" />
					</Button>
					<TooltipContent>Rename</TooltipContent>
				</Tooltip>
				<Tooltip>
					<Button intent="outline">Inverse</Button>
					<TooltipContent inverse>Inverse tooltip</TooltipContent>
				</Tooltip>
				<Tooltip>
					<Button intent="outline">No arrow</Button>
					<TooltipContent arrow={false}>Without an arrow</TooltipContent>
				</Tooltip>
			</GallerySection>
		</>
	)
}
