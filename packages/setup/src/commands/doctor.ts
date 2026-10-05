import { Command } from "effect/cli"
import { Console, Effect } from "effect"
import pc from "picocolors"
import { Doctor, type CheckResult } from "../services/doctor.ts"

const formatResult = (result: CheckResult) => {
	const icon =
		result.status === "ok"
			? pc.green("\u2713")
			: result.status === "warn"
				? pc.yellow("\u26A0")
				: pc.red("\u2717")

	const msg =
		result.status === "fail"
			? pc.red(result.message)
			: result.status === "warn"
				? pc.yellow(result.message)
				: result.message

	return `  ${icon} ${pc.bold(result.name)}: ${msg}`
}

export const doctorCommand = Command.make("doctor", {}, () =>
	Effect.gen(function* () {
		yield* Console.log(`\n${pc.bold("Hazel Environment Check")}\n`)

		const doctor = yield* Doctor
		const { environment, services } = yield* doctor.runAllChecks()

		// Environment section
		yield* Console.log(pc.cyan("─── Environment ───"))
		let hasFailure = false
		for (const result of environment) {
			yield* Console.log(formatResult(result))
			if (result.status === "fail") hasFailure = true
		}

		// Services section
		yield* Console.log(pc.cyan("\n─── Services ───"))
		for (const result of services) {
			yield* Console.log(formatResult(result))
			if (result.status === "fail") hasFailure = true
		}

		yield* Console.log("")

		if (hasFailure) {
			yield* Console.log(pc.red("Some checks failed. Please fix the issues above before continuing.\n"))
		} else {
			yield* Console.log(pc.green("All checks passed! You're ready to run setup.\n"))
		}

		return !hasFailure
	}),
)
