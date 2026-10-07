import { useState } from "react"
import { IconGear } from "~/components/icons/icon-gear"
import { IconHashtag } from "~/components/icons/icon-hashtag"
import { IconMoon } from "~/components/icons/icon-moon"
import { IconPlus } from "~/components/icons/icon-plus"
import { Button } from "~/components/ui/button"
import {
	CommandMenu,
	CommandMenuDescription,
	CommandMenuItem,
	CommandMenuLabel,
	CommandMenuList,
	CommandMenuSearch,
	CommandMenuSection,
	CommandMenuShortcut,
} from "~/components/ui/command-menu"
import { GallerySection } from "../frame"

export const title = "Command menu"

export function Gallery() {
	const [isOpen, setIsOpen] = useState(false)
	return (
		<GallerySection title="Command menu">
			<Button intent="outline" onPress={() => setIsOpen(true)}>
				Open command menu
			</Button>
			<CommandMenu isOpen={isOpen} onOpenChange={setIsOpen}>
				<CommandMenuSearch placeholder="Where would you like to go?" />
				<CommandMenuList>
					<CommandMenuSection label="Recent">
						<CommandMenuItem textValue="general">
							<IconHashtag />
							<CommandMenuLabel>general</CommandMenuLabel>
						</CommandMenuItem>
						<CommandMenuItem textValue="design">
							<IconHashtag />
							<CommandMenuLabel>design</CommandMenuLabel>
							<CommandMenuDescription>12 members</CommandMenuDescription>
						</CommandMenuItem>
					</CommandMenuSection>
					<CommandMenuSection label="Quick Actions">
						<CommandMenuItem textValue="create channel">
							<IconPlus />
							<CommandMenuLabel>Create channel</CommandMenuLabel>
							<CommandMenuShortcut>⌘N</CommandMenuShortcut>
						</CommandMenuItem>
						<CommandMenuItem textValue="appearance theme">
							<IconMoon />
							<CommandMenuLabel>Change appearance</CommandMenuLabel>
						</CommandMenuItem>
						<CommandMenuItem textValue="settings">
							<IconGear />
							<CommandMenuLabel>Settings</CommandMenuLabel>
						</CommandMenuItem>
					</CommandMenuSection>
				</CommandMenuList>
			</CommandMenu>
		</GallerySection>
	)
}
