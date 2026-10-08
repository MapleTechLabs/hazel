/**
 * Seeded text generation for the `heavy` dataset. Everything derives from a
 * mulberry32 stream, so two imports produce identical rows.
 */

export type Rng = () => number

/** mulberry32: tiny, fast, good enough for fixture data. */
export const mulberry32 = (seed: number): Rng => {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
export const pick = <A>(rng: Rng, items: ReadonlyArray<A>): A => items[Math.floor(rng() * items.length)]!

const subjects = [
	"the sync worker",
	"the release branch",
	"our onboarding flow",
	"the billing export",
	"the search index",
	"the mobile build",
	"the staging cluster",
	"the notification fan-out",
	"the migration script",
	"the design review",
	"the parser",
	"the cache layer",
	"the audit log",
	"the dashboard",
	"the retry queue",
	"the invite emails",
]

const verbs = [
	"is looking much healthier since",
	"started timing out right after",
	"needs another pass before",
	"should be ready ahead of",
	"got noticeably faster after",
	"still trips over edge cases from",
	"was rolled back because of",
	"looks fine to me except for",
]

const objects = [
	"the Tuesday deploy",
	"yesterday's config change",
	"the schema bump",
	"the new rate limits",
	"the dependency upgrade",
	"the load test",
	"the holiday freeze",
	"the customer call",
	"the last sprint",
	"the backfill",
]

const shortLines = [
	"On it.",
	"Thanks!",
	"Agreed.",
	"Looks good to me.",
	"Can you share the logs?",
	"Merged.",
	"Nice work, ship it.",
	"Give me ten minutes.",
	"Back from lunch, catching up now.",
	"Same here.",
	"Not sure, let me check.",
	"That makes sense.",
	"Rebasing now.",
	"Deploying to staging.",
	"Fixed in the latest commit.",
	"Who owns this one?",
	"Done.",
	"+1",
	"Let's pair on it after standup.",
	"Can we push this to tomorrow?",
]

const codeTokens = [
	"retryBudget",
	"SyncWorker",
	"--force",
	"main",
	"bun run test",
	"maxBatchSize",
	"useChannel",
	"v2.3.1",
]
const boldTokens = ["blocking", "before Friday", "rolled back", "needs review", "high priority", "done"]
const italicTokens = ["probably", "for now", "again", "eventually", "really", "temporarily"]

const decorate = (rng: Rng, sentence: string) => {
	const roll = rng()
	if (roll < 0.1) return `${sentence} See \`${pick(rng, codeTokens)}\`.`
	if (roll < 0.18) return `${sentence} This is **${pick(rng, boldTokens)}**.`
	if (roll < 0.25) return `${sentence.slice(0, -1)}, *${pick(rng, italicTokens)}*.`
	return sentence
}

const sentence = (rng: Rng) => {
	const text = `${pick(rng, subjects)} ${pick(rng, verbs)} ${pick(rng, objects)}.`
	return decorate(rng, text.charAt(0).toUpperCase() + text.slice(1))
}

const sentences = (rng: Rng, count: number) => Array.from({ length: count }, () => sentence(rng)).join(" ")

/** One message body. Mix of lengths so virtualized row heights vary. No URLs or mentions. */
export const messageContent = (rng: Rng): string => {
	const roll = rng()
	if (roll < 0.4) return decorate(rng, pick(rng, shortLines))
	if (roll < 0.62) return sentences(rng, int(rng, 1, 2))
	if (roll < 0.78) return sentences(rng, int(rng, 3, 6))
	if (roll < 0.9) {
		const items = Array.from({ length: int(rng, 2, 5) }, () => `- ${sentence(rng)}`)
		return `${pick(rng, ["Quick update:", "Plan for today:", "Notes from the sync:", "Open items:"])}\n\n${items.join("\n")}`
	}
	return Array.from({ length: int(rng, 2, 4) }, () => sentences(rng, int(rng, 1, 2))).join("\n")
}

const teams = [
	"platform",
	"growth",
	"mobile",
	"web",
	"infra",
	"data",
	"design",
	"support",
	"sales",
	"security",
	"billing",
	"search",
	"sync",
	"api",
	"ops",
	"qa",
	"docs",
	"brand",
	"people",
	"finance",
]
const topics = [
	"general",
	"standup",
	"alerts",
	"releases",
	"incidents",
	"planning",
	"reviews",
	"random",
	"help",
	"announcements",
	"roadmap",
	"experiments",
	"metrics",
	"feedback",
	"hiring",
	"oncall",
	"deploys",
	"bugs",
	"research",
	"retro",
	"offsite",
	"ideas",
	"wins",
	"triage",
	"sandbox",
]
const longSuffixes = [
	"quarterly-planning-and-roadmap-alignment",
	"cross-functional-working-group",
	"customer-escalations-and-follow-ups",
	"incident-retrospectives-archive",
	"vendor-evaluation-and-procurement",
]

/** Unique channel name for index `i` (0..499); every ninth one gets a 40-60 char tail. */
export const channelName = (i: number) => {
	const base = `${teams[i % teams.length]}-${topics[Math.floor(i / teams.length) % topics.length]}`
	return i % 9 === 0 ? `${base}-${longSuffixes[i % longSuffixes.length]}` : base
}

export const firstNames = [
	"Grace",
	"Alan",
	"Margaret",
	"Linus",
	"Barbara",
	"Dennis",
	"Frances",
	"Ken",
	"Radia",
	"Edsger",
	"Hedy",
	"John",
	"Katherine",
	"Tim",
	"Sophie",
	"Niklaus",
	"Shafi",
	"Donald",
	"Annie",
	"Guido",
]
export const lastNames = [
	"Hopper",
	"Turing",
	"Hamilton",
	"Torvalds",
	"Liskov",
	"Ritchie",
	"Allen",
	"Thompson",
	"Perlman",
	"Dijkstra",
	"Lamarr",
	"Backus",
	"Johnson",
	"Berners-Lee",
	"Wilson",
	"Wirth",
	"Goldwasser",
	"Knuth",
]
export const longPeople = [
	{ firstName: "Maximiliana-Theodora", lastName: "Vandenberghe-Okonkwo" },
	{ firstName: "Bartholomew", lastName: "Featherstonehaugh-Ramaswamy" },
	{ firstName: "Anastasiya", lastName: "Wolfeschlegelsteinhausen" },
	{ firstName: "Christopherson", lastName: "Montgomery-Abernathy III" },
	{ firstName: "Guadalupe Esperanza", lastName: "de la Fuente-Castellanos" },
]
