import { Command, Prompt } from "effect/cli"
import { Console, Effect } from "effect"
import pc from "picocolors"
import { CertManager } from "../services/cert-manager.ts"

/** Shared certs setup logic, callable from both the certs subcommand and the main setup command. */
export const certsSetupEffect = Effect.gen(function* () {
	yield* Console.log(`\n${pc.bold("HTTPS Certificate Setup")}\n`)

	const certs = yield* CertManager

	// Check if certs already exist
	const exists = yield* certs.certsExist()
	if (exists) {
		yield* Console.log(pc.green("\u2713") + " Certificates already exist at:")
		yield* Console.log(pc.dim(`  ${certs.certPath}`))
		yield* Console.log(pc.dim(`  ${certs.keyPath}`))

		const regenerate = yield* Prompt.Confirm({
			message: "Regenerate certificates?",
			initial: false,
		})
		if (!regenerate) return
	}

	// Check mkcert installation
	yield* Console.log(pc.cyan("\u2500\u2500\u2500 Checking mkcert \u2500\u2500\u2500"))
	const hasMkcert = yield* certs.checkMkcert()

	if (!hasMkcert) {
		yield* Console.log(pc.yellow("mkcert not found."))
		const install = yield* Prompt.Confirm({
			message: "Install mkcert via Homebrew?",
			initial: true,
		})
		if (!install) {
			yield* Console.log(pc.dim("Install manually: brew install mkcert"))
			return
		}
		yield* certs.installMkcert()
		yield* Console.log(pc.green("\u2713") + " mkcert installed")
	} else {
		yield* Console.log(pc.green("\u2713") + " mkcert found")
	}

	// Install CA
	yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Installing Local CA \u2500\u2500\u2500"))
	yield* Console.log(pc.dim("This may require your password..."))
	yield* certs.installCA()
	yield* Console.log(pc.green("\u2713") + " Local CA installed")

	// Generate certificates
	yield* Console.log(pc.cyan("\n\u2500\u2500\u2500 Generating Certificates \u2500\u2500\u2500"))
	yield* certs.generateCerts()
	yield* Console.log(pc.green("\u2713") + " Certificates generated")

	yield* Console.log(pc.green("\n\u2705 HTTPS setup complete!"))
	yield* Console.log(pc.bold("\nCertificates at:"))
	yield* Console.log(pc.dim(`  ${certs.certPath}`))
	yield* Console.log(pc.dim(`  ${certs.keyPath}`))
	yield* Console.log(pc.dim("\nRestart dev servers to use HTTPS."))
})

export const certsCommand = Command.make("certs", {}, () => certsSetupEffect)
