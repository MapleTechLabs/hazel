import { IconGear } from "~/components/icons/icon-gear"
import { IconUsers } from "~/components/icons/icon-users"
import { Tab, TabList, TabPanel, Tabs } from "~/components/ui/tabs"
import { GallerySection } from "../frame"

export const title = "Tabs"

export function Gallery() {
	return (
		<>
			<GallerySection title="Horizontal">
				<Tabs aria-label="Workspace">
					<TabList aria-label="Workspace sections">
						<Tab id="overview">Overview</Tab>
						<Tab id="members">Members</Tab>
						<Tab id="billing" isDisabled>
							Billing
						</Tab>
						<Tab id="integrations">Integrations</Tab>
					</TabList>
					<TabPanel id="overview">Overview panel</TabPanel>
					<TabPanel id="members">Members panel</TabPanel>
					<TabPanel id="billing">Billing panel</TabPanel>
					<TabPanel id="integrations">Integrations panel</TabPanel>
				</Tabs>
			</GallerySection>
			<GallerySection title="Vertical">
				<Tabs orientation="vertical" aria-label="Account">
					<TabList aria-label="Account sections">
						<Tab id="profile">Profile</Tab>
						<Tab id="security">Security</Tab>
						<Tab id="sessions" isDisabled>
							Sessions
						</Tab>
						<Tab id="notifications">Notifications</Tab>
					</TabList>
					<TabPanel id="profile">Profile panel</TabPanel>
					<TabPanel id="security">Security panel</TabPanel>
					<TabPanel id="sessions">Sessions panel</TabPanel>
					<TabPanel id="notifications">Notifications panel</TabPanel>
				</Tabs>
			</GallerySection>
			<GallerySection title="Icons, preselected">
				<Tabs aria-label="Team" defaultSelectedKey="settings">
					<TabList aria-label="Team sections">
						<Tab id="people">
							<IconUsers />
							People
						</Tab>
						<Tab id="settings">
							<IconGear />
							Preferences
						</Tab>
					</TabList>
					<TabPanel id="people">People panel</TabPanel>
					<TabPanel id="settings">Preferences panel</TabPanel>
				</Tabs>
			</GallerySection>
			<GallerySection title="Long labels">
				<Tabs aria-label="Long">
					<TabList aria-label="Long sections">
						<Tab id="first">Notification delivery preferences and schedules</Tab>
						<Tab id="second">Connected third-party integrations</Tab>
					</TabList>
					<TabPanel id="first">First long panel</TabPanel>
					<TabPanel id="second">Second long panel</TabPanel>
				</Tabs>
			</GallerySection>
		</>
	)
}
