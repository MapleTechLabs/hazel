/**
 * Bots that come with an integration: they are installed, shown and removed on that integration's
 * page, so Installed Apps and the Marketplace leave them out.
 */

/**
 * Maple's bot in production Hazel. One bot serves every Maple region: each install's events go to
 * the region that redeemed it (`bot_installations.region`). The second id is the EU region's own
 * bot from before regions; it stays listed until its installs have moved over.
 */
export const MAPLE_BOT_IDS: ReadonlyArray<string> = [
	"ca08852a-fb2e-4df9-8602-519e7ec3b9bf",
	"de89c591-fcf9-4ff7-a13e-0118180bfc99",
]

export const isIntegrationBot = (botId: string): boolean => MAPLE_BOT_IDS.includes(botId)
