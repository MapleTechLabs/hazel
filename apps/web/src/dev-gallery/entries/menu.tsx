import { IconDots } from "~/components/icons/icon-dots"
import { IconFolder } from "~/components/icons/icon-folder"
import { IconFolderPlus } from "~/components/icons/icon-folder-plus"
import { IconLeave } from "~/components/icons/icon-leave"
import { IconStar } from "~/components/icons/icon-star"
import { IconVolumeMute } from "~/components/icons/icon-volume-mute"
import { Button } from "~/components/ui/button"
import {
	Menu,
	MenuContent,
	MenuDescription,
	MenuItem,
	MenuLabel,
	MenuSection,
	MenuSeparator,
	MenuShortcut,
	MenuSubMenu,
	MenuTrigger,
} from "~/components/ui/menu"
import { GallerySection } from "../frame"

export const title = "Menu"

export function Gallery() {
	return (
		<>
			<GallerySection title="Actions">
				<Menu>
					<Button intent="outline">Actions</Button>
					<MenuContent className="w-56">
						<MenuSection label="Channel">
							<MenuItem>
								<IconVolumeMute className="size-4" />
								<MenuLabel>Mute</MenuLabel>
								<MenuShortcut>⌘M</MenuShortcut>
							</MenuItem>
							<MenuItem>
								<IconStar className="size-4 text-muted-fg" />
								<MenuLabel>Favorite</MenuLabel>
							</MenuItem>
							<MenuSubMenu>
								<MenuItem>
									<IconFolderPlus className="size-4" />
									<MenuLabel>Move to section</MenuLabel>
								</MenuItem>
								<MenuContent>
									<MenuItem>
										<MenuLabel>Channels (Default)</MenuLabel>
									</MenuItem>
									<MenuItem>
										<MenuLabel>Projects</MenuLabel>
									</MenuItem>
								</MenuContent>
							</MenuSubMenu>
						</MenuSection>
						<MenuSeparator />
						<MenuItem isDisabled>
							<IconFolder className="size-4" />
							<MenuLabel>Archive</MenuLabel>
						</MenuItem>
						<MenuSeparator />
						<MenuItem intent="danger" textValue="Leave">
							<IconLeave className="size-4" />
							<MenuLabel>Leave</MenuLabel>
						</MenuItem>
					</MenuContent>
				</Menu>
			</GallerySection>
			<GallerySection title="Selection">
				<Menu>
					<Button intent="outline">Density</Button>
					<MenuContent selectionMode="single" defaultSelectedKeys={["comfortable"]}>
						<MenuItem id="compact">
							<MenuLabel>Compact</MenuLabel>
						</MenuItem>
						<MenuItem id="comfortable">
							<MenuLabel>Comfortable</MenuLabel>
							<MenuDescription>Roomier rows</MenuDescription>
						</MenuItem>
					</MenuContent>
				</Menu>
			</GallerySection>
			<GallerySection title="Trigger">
				<Menu>
					<MenuTrigger aria-label="More">
						<IconDots className="size-4" />
					</MenuTrigger>
					<MenuContent placement="right top">
						<MenuItem>
							<MenuLabel>Copy link</MenuLabel>
						</MenuItem>
						<MenuItem>
							<MenuLabel>Edit</MenuLabel>
						</MenuItem>
					</MenuContent>
				</Menu>
			</GallerySection>
		</>
	)
}
