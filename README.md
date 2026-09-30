# nx-release-repro

Public reproduction of an Nx release limitation: **releasing a scoped release
group (via `--groups` or `--projects`) fails if a pending version plan exists
anywhere in the repo for a project that belongs to a *different, legitimately
configured* release group.**

- Nx: `v23.2.1`
- Package manager: `pnpm`

## Workspace layout

Two independent packages, each in their own release group:

```jsonc
// nx.json (relevant excerpt)
"release": {
  "groups": {
    "group-a": { "projectsRelationship": "independent", "projects": ["pkg-a"] },
    "group-b": { "projectsRelationship": "independent", "projects": ["pkg-b"] }
  },
  "versionPlans": {
    "ignorePatternsForPlanCheck": ["**/*.md", "pnpm-lock.yaml"]
  },
  "version": {
    "specifierSource": "version-plans",
    "currentVersionResolver": "git-tag",
    "fallbackCurrentVersionResolver": "disk"
  }
}
```

`nx-release-publish` is overridden in `targetDefaults` to a harmless no-op
`echo` command, so running any of the commands below — with or without
`--skip-publish` — never contacts a real registry.

## Reproducing the bug

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Ensure there's a pending version plan for **each** package (both already
   exist in this repo under `.nx/version-plans/`):

   ```md
   <!-- .nx/version-plans/version-plan-pkg-a.md -->
   ---
   pkg-a: patch
   ---

   Add more functionality to pkg-a
   ```

   ```md
   <!-- .nx/version-plans/version-plan-pkg-b.md -->
   ---
   pkg-b: minor
   ---

   Add a new feature to pkg-b
   ```

3. Confirm an **unfiltered** release works fine (both groups process
   correctly, each against its own plan):

   ```bash
   pnpm nx release --dry-run
   ```

   ✅ Succeeds — versions both `pkg-a` and `pkg-b` per their own version plan.

4. Now try to release **only `group-a`**:

   ```bash
   pnpm nx release --groups=group-a --dry-run
   ```

   ❌ Fails:

   ```
    NX   Found a version bump for project 'pkg-b' in 'version-plan-pkg-b.md' but the project is not in any configured release groups.
   ```

   `pkg-b` **is** configured (in `group-b`) — it's just not part of the
   group selected for this command. The same failure happens with
   `--projects=pkg-a`, and symmetrically with `--groups=group-b` /
   `--projects=pkg-b` (fails on `pkg-a`'s plan instead).

## Root cause

`nx/src/command-line/release/version.js` calls:

```js
setResolvedVersionPlansOnGroups(rawVersionPlans, releaseGraph.releaseGroups, ...)
```

- `rawVersionPlans` — **all** version plan files under `.nx/version-plans/`,
  read unconditionally, regardless of any `--groups`/`--projects` filter.
- `releaseGraph.releaseGroups` — **only** the release groups matched by the
  current `--groups`/`--projects` filter.

Inside `nx/src/command-line/release/config/version-plans.js`, each version
plan's project is looked up against that filtered group list:

```js
const groupForProject = releaseGroups.find((group) => group.projects.includes(key));
if (!groupForProject) {
  // ...
  throw new Error(`Found a version bump for project '${key}' in '${rawVersionPlan.fileName}' but the project is not in any configured release groups.`);
}
```

Since `releaseGroups` is the *filtered* list, any pending plan for a project
in a group that wasn't selected trips this check and throws a misleading
error — the project is not "unconfigured", it's simply out of scope for this
particular invocation.

**Practical impact:** you cannot release a single group/project via `nx
release --groups=X` or `--projects=Y` while *any* other team has an unrelated
pending version plan sitting in the repo. In a monorepo with many
independently-versioned packages, this makes scoped releases unreliable.

## Other things this repo demonstrates along the way

- Setting `"private": true` on a package excludes it from Nx release
  *entirely* (tagged `npm:private`, matches no release groups) — not just
  from the publish step.
- Installing `@nx/js` is required for `nx release version` to resolve a
  `versionActions` implementation for plain JS packages — but doing so also
  auto-infers a real `nx-release-publish` target (`@nx/js:release-publish`)
  on every package. Without the `targetDefaults` override in this repo, an
  unattended `nx release` (no `--skip-publish`, no TTY) would attempt a real
  `npm publish` against whichever registry your `.npmrc` resolves to.
- `publishConfig.access: "restricted"` is **not** a reliable safety net for
  unscoped packages — it's only meaningful for scoped (`@scope/name`)
  packages and is ignored otherwise. The reliable guard is overriding the
  `nx-release-publish` target itself (see `targetDefaults` in `nx.json`).
- Releasing one project/group correctly scopes both the version bump *and*
  version-plan file cleanup — e.g. releasing `pkg-b` alone consumes only
  `version-plan-pkg-b.md` and leaves `version-plan-pkg-a.md` untouched for a
  future release.
