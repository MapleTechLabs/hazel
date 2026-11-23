/**
 * Point-in-time recovery of an install's data (`docs/self-hosting.md`, "Backups and restore"):
 * one Durable Object through the api's operator endpoints, or the directory D1 database through
 * `wrangler d1 time-travel`. Argument handling and requests: `packages/setup/src/operator/restore.ts`.
 *
 *   OPERATOR_TOKEN=... bun run operator:restore --api https://api.chat.acme.com --kind org --id <id> --at 2026-11-20T09:00:00Z --dry-run
 *   OPERATOR_TOKEN=... bun run operator:restore --api https://api.chat.acme.com --kind org --id <id> --at 2026-11-20T09:00:00Z
 *   bun run operator:restore --kind directory --customer acme --at 2026-11-20T09:00:00Z
 */
import { createInterface } from "node:readline/promises"
import {
	confirmationWord,
	directoryCommand,
	objectRequest,
	parseRestoreArgs,
	type RestorePlan,
	usage,
} from "../packages/setup/src/operator/restore"

const fail = (message: string): never => {
	console.error(`${message}\n\n${usage}`)
	process.exit(1)
}

const confirm = async (plan: RestorePlan) => {
	if (plan.yes) return
	if (!process.stdin.isTTY) fail("Refusing to restore without a terminal to confirm on; pass --yes")
	const word = confirmationWord(plan)
	const what =
		plan._tag === "Object"
			? `the ${plan.kind} object ${plan.id} on ${plan.api}`
			: `the directory database ${plan.database}`
	console.log(`This restores ${what} to ${plan.at}. Everything written since is rolled back.`)
	const prompt = createInterface({ input: process.stdin, output: process.stdout })
	const answer = await prompt.question(`Type ${word} to continue: `)
	prompt.close()
	if (answer.trim() !== word) fail("Not confirmed; nothing was changed")
}

const parsed = parseRestoreArgs(process.argv.slice(2))
if (parsed._tag === "Help") {
	console.log(usage)
	process.exit(0)
}
if (parsed._tag === "Invalid") fail(parsed.message)
const plan = (parsed as Extract<typeof parsed, { _tag: "Plan" }>).plan

if (plan._tag === "Object") {
	const token = process.env.OPERATOR_TOKEN?.trim() || fail("OPERATOR_TOKEN is not set in the env")
	if (!plan.dryRun) await confirm(plan)
	const request = objectRequest(plan, token)
	const response = await fetch(request.url, request.init)
	const text = await response.text()
	if (response.status === 404)
		fail("The api answered 404: OPERATOR_TOKEN is wrong, or not set on the install (endpoints disabled)")
	if (!response.ok) fail(`The api answered ${response.status}: ${text}`)
	console.log(text)
	if (!plan.dryRun) {
		console.log(
			"The object restarts with its storage as of the bookmark. To undo, restore again to the time just before this run.",
		)
	}
} else {
	if (!plan.dryRun) await confirm(plan)
	const command = directoryCommand(plan)
	console.log(`$ ${command.join(" ")}`)
	const child = Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"] })
	process.exit(await child.exited)
}
