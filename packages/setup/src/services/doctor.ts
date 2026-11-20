import { Context, Effect, Layer } from "effect"

export interface CheckResult {
	name: string
	status: "ok" | "warn" | "fail"
	message: string
}

// Helper to check if a docker container is running
const checkContainer = (containerName: string, displayName: string): Effect.Effect<CheckResult> =>
	Effect.tryPromise(async () => {
		const proc = Bun.spawn(["docker", "inspect", "--format", "{{.State.Status}}", containerName], {
			stdout: "pipe",
			stderr: "ignore",
		})
		const output = await new Response(proc.stdout).text()
		const code = await proc.exited

		if (code !== 0) {
			return { name: displayName, status: "fail" as const, message: "Not running" }
		}

		const status = output.trim()
		if (status !== "running") {
			return { name: displayName, status: "fail" as const, message: `Status: ${status}` }
		}
		return { name: displayName, status: "ok" as const, message: "Running" }
	}).pipe(
		Effect.orElseSucceed(() => ({ name: displayName, status: "fail" as const, message: "Not running" })),
	)

const checkBun: Effect.Effect<CheckResult> = Effect.tryPromise(async () => {
	const proc = Bun.spawn(["bun", "--version"])
	const text = await new Response(proc.stdout).text()
	await proc.exited
	return { name: "Bun", status: "ok" as const, message: `v${text.trim()}` }
}).pipe(
	Effect.orElseSucceed(() => ({
		name: "Bun",
		status: "fail" as const,
		message: "Not found. Install from https://bun.sh",
	})),
)

const checkDocker: Effect.Effect<CheckResult> = Effect.tryPromise(async () => {
	const proc = Bun.spawn(["docker", "info"], { stdout: "ignore", stderr: "ignore" })
	const code = await proc.exited
	return code === 0
		? { name: "Docker", status: "ok" as const, message: "Running" }
		: {
				name: "Docker",
				status: "fail" as const,
				message: "Not running. Start Docker Desktop",
			}
}).pipe(
	Effect.orElseSucceed(() => ({
		name: "Docker",
		status: "fail" as const,
		message: "Not running. Start Docker Desktop",
	})),
)

const checkDockerCompose: Effect.Effect<CheckResult> = Effect.tryPromise(async () => {
	const proc = Bun.spawn(["docker", "compose", "ps", "--format", "json"])
	const text = await new Response(proc.stdout).text()
	await proc.exited
	const containers = text.trim().split("\n").filter(Boolean)
	if (containers.length === 0) {
		return {
			name: "Docker Compose",
			status: "warn" as const,
			message: "No containers running. Run `docker compose up -d`",
		}
	}
	return {
		name: "Docker Compose",
		status: "ok" as const,
		message: `${containers.length} container(s) running`,
	}
}).pipe(
	Effect.orElseSucceed(() => ({
		name: "Docker Compose",
		status: "warn" as const,
		message: "Could not check containers",
	})),
)

/** `.env.local` is what `bun run alchemy:dev` reads. */
const checkEnvLocal: Effect.Effect<CheckResult> = Effect.promise(() => Bun.file(".env.local").exists()).pipe(
	Effect.map((exists): CheckResult =>
		exists
			? { name: ".env.local", status: "ok", message: "Found" }
			: { name: ".env.local", status: "warn", message: "Missing. Run `bun run setup`" },
	),
)

/** Local S3 for uploads; the database and sync objects run inside `alchemy dev`. */
const checkMinio: Effect.Effect<CheckResult> = checkContainer("hazel-minio-1", "MinIO")

const runAllChecks: Effect.Effect<{ environment: CheckResult[]; services: CheckResult[] }> = Effect.gen(
	function* () {
		const [environment, services] = yield* Effect.all([
			Effect.all([checkBun, checkDocker, checkDockerCompose, checkEnvLocal]),
			Effect.all([checkMinio]),
		])
		return { environment, services }
	},
)

export class Doctor extends Context.Service<Doctor>()("Doctor", {
	make: Effect.succeed({
		checkBun,
		checkDocker,
		checkDockerCompose,
		checkEnvLocal,
		checkMinio,
		runAllChecks,
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
