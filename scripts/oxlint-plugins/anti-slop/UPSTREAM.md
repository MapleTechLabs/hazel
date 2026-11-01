Vendored from https://github.com/dmmulroy/anti-slop at commit
`446268e5d15baa968eaec669ff65358d36ae6259` (2026-08-15), by way of Maple's copy
(`scripts/oxlint-plugins/anti-slop` in MapleTechLabs/maple), which carries these
differences from that snapshot:

- `no-runtime-typeof` can target only values whose annotations still contain
  `unknown`/`any`, and permits checks inside explicit boundary functions.
- `no-unknown-parameters`, `no-unknown-returns`, and `no-module-mocking` support
  audited `BOUNDARY:` / `TEST-SEAM:` markers. Their upstream-strict behavior remains
  the default when those options are not configured.
- `require-safety-comment-for-type-assertion` has an unsafe-boundary mode and an
  audited `SAFETY-FILE:` marker for trusted test and fixed-format round trips.
- the symbol/dictionary/widening rules preserve protocol keys, direct
  `Record<string, unknown>` at unparsed boundaries, generic type parameters, and
  explicit `satisfies` contracts.
- necessary platform declaration bridges may use a nearby, specific `SAFETY:`
  comment instead of laundering the same assertion through another helper.

Pull fixes from Maple's copy rather than upstream so the two repos stay in step.
The upstream test files are not vendored; the plugin is validated by running
Oxlint across the whole owned TypeScript/JavaScript tree.
