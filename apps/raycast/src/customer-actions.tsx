import { Action, ActionPanel, Icon, Keyboard, PopToRootType, showHUD } from "@raycast/api"
import { getFavicon } from "@raycast/utils"
import type { ReactNode } from "react"
import { signOut } from "./lib/auth"
import { appUrl } from "./lib/config"
import { SOURCE, safeSourceUrl } from "./lib/format"
import type { Account, AccountDetail, ChannelLink, ExternalRef, Organization } from "./lib/models"

const PROVIDER_SHORTCUT = {
	clerk: "c",
	stripe: "s",
	autumn: "a",
	maple: "m",
} as const satisfies Record<ExternalRef["provider"], Keyboard.KeyEquivalent>

/** The account's own record in each provider it came from (contacts' records are left out). */
export const providerLinks = (detail: AccountDetail | undefined) =>
	(detail?.refs ?? []).flatMap((ref) => {
		const url = ref.entityType === "account" ? safeSourceUrl(ref.provider, ref.externalUrl) : null
		return url === null ? [] : [{ provider: ref.provider, externalId: ref.externalId, url }]
	})

export const channelUrl = (organization: Organization, link: ChannelLink) =>
	organization.slug === null ? null : `${appUrl()}/${organization.slug}/chat/${link.channelId}`

const customerUrl = (organization: Organization, account: Account) =>
	organization.slug === null ? null : `${appUrl()}/${organization.slug}/customers/${account.id}`

/**
 * What a customer offers: its details (from the list), its linked channel, its page in Hazel, its
 * record in Clerk, Stripe, Autumn or Maple (once `detail` has loaded), and copying.
 */
export function CustomerActions(props: {
	readonly organization: Organization
	readonly account: Account
	readonly links: ReadonlyArray<ChannelLink>
	readonly detail: AccountDetail | undefined
	/** The details view, pushed by the primary action (the list's); absent on the details view. */
	readonly details?: ReactNode
	/** The detail view's: reloads the customer. */
	readonly onRefresh?: () => void
	/** The list's: syncs every organization now. */
	readonly syncAction?: ReactNode
}) {
	const { organization, account, links, detail } = props
	const channels = links.flatMap((link) => {
		const url = channelUrl(organization, link)
		return url === null ? [] : [url]
	})
	const onlyChannel = channels.length === 1 ? channels[0] : undefined
	const page = customerUrl(organization, account)
	return (
		<ActionPanel title={account.name}>
			<ActionPanel.Section>
				{props.details !== undefined && (
					<Action.Push title="Show Details" icon={Icon.Sidebar} target={props.details} />
				)}
				{onlyChannel !== undefined && (
					<Action.OpenInBrowser
						title="Open Customer Channel"
						icon={Icon.Bubble}
						url={onlyChannel}
						shortcut={{ modifiers: ["cmd"], key: "o" }}
					/>
				)}
				{channels.length > 1 && (
					<ActionPanel.Submenu
						title="Open Customer Channel"
						icon={Icon.Bubble}
						shortcut={{ modifiers: ["cmd"], key: "o" }}
					>
						{channels.map((url, index) => (
							<Action.OpenInBrowser key={url} title={`Channel ${index + 1}`} url={url} />
						))}
					</ActionPanel.Submenu>
				)}
				{page !== null && (
					<Action.OpenInBrowser
						title="Open in Hazel"
						icon={{ source: "extension-icon.png" }}
						url={page}
						shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
					/>
				)}
			</ActionPanel.Section>
			<ActionPanel.Section title="Sources">
				{providerLinks(detail).map((link) => (
					<Action.OpenInBrowser
						key={`${link.provider}:${link.externalId}`}
						title={`Open in ${SOURCE[link.provider].label}`}
						icon={getFavicon(`https://${SOURCE[link.provider].domain}`)}
						url={link.url}
						shortcut={{ modifiers: ["cmd", "opt"], key: PROVIDER_SHORTCUT[link.provider] }}
					/>
				))}
			</ActionPanel.Section>
			<ActionPanel.Section>
				<Action.CopyToClipboard
					title="Copy Name"
					content={account.name}
					shortcut={Keyboard.Shortcut.Common.Copy}
				/>
				{account.domains[0] !== undefined && (
					<Action.CopyToClipboard title="Copy Domain" content={account.domains[0]} />
				)}
				{page !== null && (
					<Action.CopyToClipboard
						title="Copy Hazel Link"
						content={page}
						shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
					/>
				)}
				{props.syncAction}
				{props.onRefresh !== undefined && (
					<Action
						title="Refresh"
						icon={Icon.ArrowClockwise}
						onAction={props.onRefresh}
						shortcut={Keyboard.Shortcut.Common.Refresh}
					/>
				)}
			</ActionPanel.Section>
			<ActionPanel.Section>
				<SignOutAction />
			</ActionPanel.Section>
		</ActionPanel>
	)
}

/** Signs out and forgets everything saved from Hazel, then closes the command. */
export function SignOutAction() {
	return (
		<Action
			title="Sign Out of Hazel"
			icon={Icon.Logout}
			style={Action.Style.Destructive}
			onAction={async () => {
				await signOut()
				await showHUD("Signed out of Hazel", { popToRootType: PopToRootType.Immediate })
			}}
		/>
	)
}
