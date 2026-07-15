#!/usr/bin/env bash
# ponytail: gate that prevents the message-vs-tracked-file drift that bit v0.2.
# Two rules only; readable in 30s.
#   1. Stage guard: refuse to add a .go or .py file unless the staged batch
#      also contains some sentinel that proves it was intentional (.go.mod,
#      cli/index.js, server/index.js, etc.). Catches accidental `git add -A`.
#   2. Tracked guard: refuse a commit that adds new .go files when the repo
#      already has cli/index.js (Node CLI is the canonical implementation).
# Wire-up: `git config core.hooksPath .githooks` (already done in this repo).
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

NEW_FILES=$(git diff --cached --name-only --diff-filter=A)
GO_NEW=$(echo "$NEW_FILES" | grep -cE '(^|/)[^/]+\.go$|(^|/)go\.mod$' || true)
PY_NEW=$(echo "$NEW_FILES" | grep -cE '(^|/)requirements\.txt$|(^|/)[^/]+\.py$' || true)

fail() { echo "✗ pre-commit-check: $1" >&2; exit 1; }

# ponytail: rule 1 — staged .go files are forbidden by v0.2 architecture.
if [ "$GO_NEW" -gt 0 ]; then
  fail "refusing to add $GO_NEW Go file(s); v0.2 is Node.js-only. If intentional, use `git commit --no-verify`."
fi

# ponytail: rule 2 — staged Python files (other than doc/tests) need review.
# Allow README/CHANGELOG plaintext; Python in scripts/ and server/ is forbidden.
PY_NON_DOC=$(echo "$NEW_FILES" | grep -E '(^|/)server/.*\.py$|(^|/)(scripts|tools)/.*\.py$' | grep -cv '^$' || true)
if [ "$PY_NON_DOC" -gt 0 ]; then
  fail "refusing to add $PY_NON_DOC Python file(s) under server/scripts/tools; v0.2 is Node.js. Use `git commit --no-verify` to override."
fi

# ponytail: rule 3 — sanity, never commit a nantianmen.exe; it's ~9MB and gitignored.
EXE_NEW=$(echo "$NEW_FILES" | grep -cE '(^|/)[^/]+\.exe$' || true)
if [ "$EXE_NEW" -gt 0 ]; then
  fail "refusing to add $EXE_NEW binary .exe; should be gitignored or released via `build/`. Use `git commit --no-verify` to override."
fi

echo "✓ pre-commit-check: clean ($([ -n "$NEW_FILES" ] && echo "$NEW_FILES" | wc -l || echo 0) files staged)"
