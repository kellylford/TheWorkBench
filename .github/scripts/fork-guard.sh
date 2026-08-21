#!/usr/bin/env bash
#
# A stable card game and its multiplayer fork must not be changed by the same
# branch. That is the whole reason the forks exist: the game people actually play
# cannot regress while the multiplayer version is being built.
#
# THE OBVIOUS VERSION OF THIS CHECK IS WRONG, and both copies of it were.
# They failed on ANY change to the stable game:
#
#     if ! git diff --quiet FETCH_HEAD -- sheephead/; then exit 1; fi
#
# The error message told you to "make it a deliberate, separate pull request
# against the stable game" — and that pull request would have failed this very
# check, because the workflow's path filter includes the stable game, so the job
# runs and the guard fires. The stable games were unmaintainable through CI, and
# the check said so in its own failure text without anybody noticing.
#
# The invariant is not "the stable game never changes". It is "no single branch
# changes both". A deliberate fix to the stable game, on its own, is exactly what
# is supposed to be possible.
#
# One script rather than a copy per job, because the last thing that was copied
# between these games — a hardcoded phase name in room.js — silently broke online
# play in one of them, and nobody wants to find out that a guard was fixed in two
# places out of three.
#
#   bash .github/scripts/fork-guard.sh <stable-dir> <fork-dir> [base-branch]
#
set -euo pipefail

stable="${1:?usage: fork-guard.sh <stable-dir> <fork-dir> [base-branch]}"
fork="${2:?usage: fork-guard.sh <stable-dir> <fork-dir> [base-branch]}"
base="${3:-main}"

git fetch --quiet origin "$base"

changed() { ! git diff --quiet FETCH_HEAD -- "$1"; }

if changed "$stable" && changed "$fork"; then
  echo "::error::This branch changes both ${stable} and ${fork}. The fork exists so the stable game cannot regress while multiplayer is built — split this into two pull requests: one for ${fork}, and one deliberate one for ${stable} on its own."
  echo ""
  echo "Changed in ${stable}:"
  git diff --stat FETCH_HEAD -- "$stable"
  echo ""
  echo "Changed in ${fork}:"
  git diff --stat FETCH_HEAD -- "$fork"
  exit 1
fi

if changed "$stable"; then
  echo "${stable} changed and ${fork} did not. That is a deliberate change to the stable game on its own, which is allowed — and is the only way to make one."
  git diff --stat FETCH_HEAD -- "$stable"
else
  echo "${stable} is unchanged against ${base}."
fi
