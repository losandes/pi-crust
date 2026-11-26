---
Context: Runtime layout
---

# Publish the built package on release

## Status

accepted

## Decision

**D1 — Publish the built directory with its own manifest.** Publish pi-crust publicly as `@polyn/pi-crust`, with Node executing the built `crust` command. Preserve the root manifest's TypeScript entry and the contributor's linked source workflow. The build includes the prebuilt visualizer and only runtime assets, the README, licence and configuration reference that command output names.

**D2 — Put `.npmignore` in the built directory.** Exclude the build marker; enforce the complete archive file set with the archive check. Do not add a `files` list that would override `.npmignore`.

**D3 — Serve the UI and API on both configured ports from one Node process.** Share one routes table and fallback between listeners so existing run links and health probes retain their ports.

**D4 — Bind installed observe to loopback unless explicitly shared.** Parse `--host`, `--host <address>` and `--strictPort` in the launcher. Refuse `--open` and unknown flags. Pass the selected bind address through `CRUST_UI_HOST`; strip it from all source-mode child environments so a clone keeps Vite and its existing API listener.

**D5 — Set the version before building and commit it with the distribution.** A published GitHub release supplies a SemVer tag with an optional leading `v`, without build metadata. Use `npm version --no-git-tag-version --allow-same-version` and commit the version and distribution together to the release target branch. Never alter tags.

**D6 — Publish the very archive that was checked.** Pack once, install that archive in a disposable prefix under the minimum Node without bun, exercise the commands and rendered UI, and publish that same file only after the code and archive checks pass. Dry-run the push before publishing, then push the release commit after publication.

**D7 — Derive the npm dist-tag from the target branch.** `main` maps to `latest`; another branch maps to its own name. Reject commit targets and branch names that cannot safely represent an npm dist-tag, including `latest` and names beginning with `v` or `V` followed by a digit.

## Context

[Issue 210](https://github.com/losandes/pi-crust/issues/210) requires installation with npm on Node without bun while preserving the contributor's clone. The root manifest names TypeScript, so publishing it unchanged would not provide a Node executable. Publishing from the root with a different manifest would require changing that contributor contract; a separate built manifest avoids it.

The run reporter prints frontend links but probes the backend port. A single listener on either port would break one of those contracts. Moving the probe would change the run path outside this work. Two listeners over the existing routes retain both. The installed launcher binds explicitly because the API's source-mode listener otherwise binds every interface. Refusing `--open` avoids starting a platform browser opener; ignoring unsupported flags would silently discard the request.

A root `.npmignore` would not govern an archive packed from the built directory. The built directory already contains only package assets, and npm excludes `.npmignore` itself. A `files` list was rejected because it would supersede the chosen ignore mechanism.

Setting the version only in the built directory would leave the root version stale. Default `npm version` tagging would conflict with the release's existing tag. Versioning before the build makes the built manifest reflect the version committed with it, rather than using separate distribution and version commits.

Publishing a second pack operation would not establish that the checked bytes are the published bytes. Running only HTTP probes would not prove that the UI renders the trace; the archive check also opens Chromium. A gate integration test was rejected because registry installation belongs to release verification rather than every pull request.

Using `main` as the npm tag would not update the default npm installation. The explicit `latest` mapping supplies that contract; prereleases intended not to become default must target another branch.

## Consequences

A release needs an `NPM_TOKEN` secret authorised for public publication, credentials able to push the release branch, registry access and Chromium. The workflow is exercised operationally only by a real release. Publication can succeed before a subsequent push fails; a push dry-run narrows but does not eliminate that gap.

The release workflow commits the distribution; local verification builds outside the working tree and removes its output. Only the visualizer's source build directory stays ignored, so the repository gate does not leave that output untracked.

The installed archive does not include every linked reference or cookbook, and command smoke checks deliberately stop before starting agents. These checks establish packaging, not provider authentication or live agent execution.
