#!/usr/bin/env bash
# Fetches the heavy inputs of the public example characters — each painting,
# the two images See-through was fed, and the two See-through layer sets — from
# https://github.com/rig-c/examples — the rig-c examples repository, whose
# corpus directories this script pins — into the gitignored
# examples/<key>/inputs/ of this checkout.
#
# What lives HERE, tracked, is the light half of each example: its config, the
# proposal, the outputs under expected/ (the reference implementation's, or for
# an example the reference never saw, this port's own build), and small
# contact sheets. The heavy half is ~40 MB of PNG per character, which is why it
# is a sibling repository rather than part of this one, and why it is fetched.
#
#   bash scripts/fetch-examples.sh               clone the PINNED commit
#   bash scripts/fetch-examples.sh --from <dir>  copy from a local working copy
#
# 🔒 The commit is PINNED, never a branch. The selftest compares what the
# readers see in these inputs against expected/parts.json, which is tracked
# here; a fetch that followed the other repository's main would let an upstream
# edit turn this tree red — or, worse, green — with no change in this tree. A
# new pin is a change to this file, reviewed like any other.
#
# `--from` copies a working copy on disk and verifies no commit, so it says it is
# UNPINNED on every line it prints about itself. It exists for preparing an
# upstream change before it is pushed, and for machines with no network.
#
# Every input is held to a hash (issue #367): the blob id git records for it in
# the pinned commit's tree (`git ls-tree -r`). A file already on disk is kept
# only when its bytes have that id; one that differs is re-fetched, and a file
# the tree does not have is removed, each on a line naming the file, the id
# found and the id required. A file that cannot be replaced is refused by the
# same name, and no record is written. On success each example gets
# examples/<key>/inputs/.fetched.json — the commit and every file's blob id —
# which the example suites in selftest.ts read, through the same check
# (scripts/example_inputs.ts), so a stale input there is a named FAIL rather
# than a flake. Before #367 a file on disk was kept unread, and a painting from
# before #227 survived a fresh fetch. A re-run hashes and copies nothing that
# matches, so it stays cheap; CI still does not cache examples/.
#
# `--from` a clean git checkout of the pinned commit is held to that commit's
# tree like a fetch; any other `--from` copy is UNPINNED, its record says so,
# and the example suites refuse it by name.
#
# 🚨 The script never reports success on an empty or partial fetch: every
# character it fetches must end up holding painting.png, both st_input images
# and both layers.json manifests before the exit status may be 0.
set -euo pipefail

REPO_URL="https://github.com/rig-c/examples"
# ⚠️ PLACEHOLDER. Set this to the full 40-character commit of rig-c/examples
# these fixtures were compared against. The script refuses to run until it is.
# PIN: <commit> — the examples repository's commit that adds wind/, the figure painted
# to pass `rig-parts painting` and to serve a wind demo (issue #372); demo/, scarf/,
# reference-demo/ and reference-sample/ are as at 842c5b3 (issue #227).
PINNED_COMMIT=ba99e403d4058fc1cfe40699bdcde8aaf00a90c0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/examples"

from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      [ $# -ge 2 ] || { echo "fetch-examples: --from needs a directory" >&2; exit 2; }
      from="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "fetch-examples: unknown argument \"$1\"; usage: fetch-examples.sh [--from <dir>]" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$DEST" ]; then
  echo "fetch-examples: $DEST does not exist, so there is no example here to fetch inputs for" >&2
  exit 1
fi

work=""
cleanup() { [ -n "$work" ] && rm -rf "$work"; return 0; }
trap cleanup EXIT

if [ -n "$from" ]; then
  if [ ! -d "$from" ]; then
    echo "fetch-examples: --from names $from, which is not a directory" >&2
    exit 2
  fi
  upstream="$(cd "$from" && pwd -P)"
  work="$(mktemp -d)"
  # A clean checkout of the pinned commit is as good as a fetch of it: its tree
  # gives the blob ids, and example_inputs.ts holds every checked-out file to
  # them. Anything else is UNPINNED.
  top="$(git -C "$upstream" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$(git -C "$upstream" rev-parse HEAD 2>/dev/null || true)"
  if [ "$top" = "$upstream" ] && [ "$head" = "$PINNED_COMMIT" ]; then
    git -C "$upstream" ls-tree -r -z "$PINNED_COMMIT" > "$work/tree"
    echo "fetch-examples: --from $upstream, a checkout of the pinned $PINNED_COMMIT; every file is held to that commit's tree"
    pinned_args=(--commit "$PINNED_COMMIT" --tree "$work/tree")
  else
    echo "fetch-examples: UNPINNED — copying the working copy at $upstream; no commit is verified"
    pinned_args=(--unpinned)
  fi
else
  case "$PINNED_COMMIT" in
    __*__ | "")
      echo "fetch-examples: refused — PINNED_COMMIT in scripts/fetch-examples.sh is still the placeholder \"$PINNED_COMMIT\"." >&2
      echo "  Set it to the commit of $REPO_URL these examples were compared against;" >&2
      echo "  until then the only way to fetch is --from <a local working copy>, which is unpinned." >&2
      exit 1
      ;;
  esac
  if ! printf '%s' "$PINNED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "fetch-examples: refused — PINNED_COMMIT \"$PINNED_COMMIT\" is not a full 40-character commit id; a branch, tag or short id can move" >&2
    exit 1
  fi
  work="$(mktemp -d)"
  upstream="$work/parts-examples"
  git init -q "$upstream"
  git -C "$upstream" remote add origin "$REPO_URL"
  if ! git -C "$upstream" fetch -q --depth 1 origin "$PINNED_COMMIT"; then
    echo "fetch-examples: could not fetch commit $PINNED_COMMIT from $REPO_URL" >&2
    exit 1
  fi
  git -C "$upstream" -c advice.detachedHead=false checkout -q FETCH_HEAD
  got="$(git -C "$upstream" rev-parse HEAD)"
  if [ "$got" != "$PINNED_COMMIT" ]; then
    echo "fetch-examples: asked for $PINNED_COMMIT and checked out $got" >&2
    exit 1
  fi
  git -C "$upstream" ls-tree -r -z "$PINNED_COMMIT" > "$work/tree"
  echo "fetch-examples: $REPO_URL at $PINNED_COMMIT"
  pinned_args=(--commit "$PINNED_COMMIT" --tree "$work/tree")
fi

# The copy and the hash check are scripts/example_inputs.ts, the module the
# example suites read the same check from: for each examples/<key>/config.json,
# it copies what is missing, replaces what is stale and removes what the tree
# lacks — naming each file replaced or removed — refuses by name what it cannot
# fix, and writes examples/<key>/inputs/.fetched.json only after every file
# matched. Not `exec`: the EXIT trap removes the clone afterwards.
status=0
bun "$ROOT/scripts/example_inputs.ts" sync --upstream "$upstream" --dest "$DEST" "${pinned_args[@]}" || status=$?
exit "$status"
