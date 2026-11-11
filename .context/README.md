# Context Libraries

This directory contains git subtrees of library documentation and examples for reference when working with this codebase.

## Subtree Repositories

The following repositories are included as git subtrees:

- **Effect** (`.context/effect/`)
  - Repository: https://github.com/Effect-TS/effect-smol
  - Branch: main
  - Purpose: Effect v4 (effect-smol) functional programming library documentation and examples

- **TanStack DB** (`.context/tanstack-db/`)
  - Repository: https://github.com/TanStack/db
  - Branch: main
  - Purpose: TanStack DB query and collection management library documentation and examples

## Updating Subtrees

To update all subtrees to their latest versions, run:

```bash
# Update Effect
git subtree pull --prefix=.context/effect effect-subtree main --squash

# Update TanStack DB
git subtree pull --prefix=.context/tanstack-db tanstack-db-subtree main --squash
```

Note: The git remotes should already be configured. If not, add them first:

```bash
git remote add effect-subtree https://github.com/Effect-TS/effect-smol
git remote add tanstack-db-subtree https://github.com/TanStack/db
```

## Usage

These libraries are referenced in the main CLAUDE.md file. Always check the `.context/` directory for library-specific documentation and example code before implementing features with these libraries.
