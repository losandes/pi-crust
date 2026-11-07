# Shared checker scripts

What every blocking checker needs and none of them should own: finding the project, asking git what changed, naming a base branch, and printing findings the same way.

Only what had actually diverged lives here. The `report` helper is five lines and identical everywhere, so extracting it would trade a trivial duplicate for an import — these two were extracted because copies of them had already begun to disagree. Four implementations of "which files changed" differed on whether staged files counted, whether a non-repository was an error or an empty list, and whether paths came back absolute or workspace-relative — differences nobody chose, all introduced by copying.

## Using them

A checker finds this directory by walking up from itself, so it does not care how deeply its skill is nested:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shared() {
  local dir="$SCRIPT_DIR"
  while [[ "$dir" != "/" ]]; do
    [[ -f "$dir/scripts/workspace.sh" ]] && { printf '%s\n' "$dir/scripts"; return 0; }
    dir="$(dirname "$dir")"
  done
  echo "error: shared scripts not found above $SCRIPT_DIR" >&2
  exit 2
}
SHARED="$(shared)"
# shellcheck source=/dev/null
source "$SHARED/workspace.sh"
```

## What is here

| File | Owns |
|---|---|
| `workspace.sh` | the project root, and the base branch to compare against |
| `changed-files.sh` | what git says changed, filtered to one pattern |

## The cost

A skill directory is no longer self-contained: copied out on its own, its checker will not find this directory and will exit 2 saying so. That is deliberate. The unit that travels is the whole skills directory, which already had to be true the moment records moved to `adr/`.
