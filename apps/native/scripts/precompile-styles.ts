/**
 * Compiles Hazel's stylesheet for every class its sources use and writes it beside the bundled
 * runtime (dist/styles.json), so a packaged boot skips Tailwind's compile and scan.
 */
import { writeFileSync } from "node:fs"

import { StyleResolver } from "@hazel/foldkit-rune"

const sheet = new URL("../../web-foldkit/src/styles.css", import.meta.url).pathname
const precompiled = await StyleResolver.precompile(sheet)
writeFileSync(new URL("../dist/styles.json", import.meta.url), JSON.stringify(precompiled))
