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
# ---- the one way past this, and why it exists ----
#
# A commit whose message carries the trailer
#
#     Fork-guard: both
#
# is allowed through. That is not a hole being left open; it is the one case the
# rule as written cannot express. Moving every game into thecardplace/ changes a
# stable game and its fork in the same breath and CANNOT be split, because a
# half-moved tree has the shared transport in one place and a game pointing at
# the other — main would be broken between the two pull requests, which is worse
# than what this guard protects against.
#
# The trailer is deliberate in the only way that matters here: somebody has to
# type it, it is in the history for ever, and the run says loudly that it was
# used and prints both diffstats anyway. It is not a rubber stamp for "these two
# changes felt related". The question to ask before typing it is whether the two
# halves are genuinely one change that a broken main sits between; if splitting
# them merely means two pull requests and some patience, split them.
#
#   bash .github/scripts/fork-guard.sh <stable-dir> <fork-dir> [base-branch]
#
set -euo pipefail

stable="${1:?usage: fork-guard.sh <stable-dir> <fork-dir> [base-branch]}"
fork="${2:?usage: fork-guard.sh <stable-dir> <fork-dir> [base-branch]}"
base="${3:-main}"

git fetch --quiet origin "$base"

changed() { ! git diff --quiet FETCH_HEAD -- "$1"; }

# Every commit this branch adds on top of the base, not just the tip: a squash
# lands one message, but the branch under review may have many, and the person
# who wrote the trailer should not have to guess which one is read.
overridden() {
  git log --format='%B' FETCH_HEAD..HEAD 2>/dev/null |
    grep -qiE '^Fork-guard:[[:space:]]*both[[:space:]]*$'
}

if changed "$stable" && changed "$fork" && overridden; then
  echo "::notice::This branch changes both ${stable} and ${fork}, and carries the 'Fork-guard: both' trailer, so it is allowed through. Both diffstats are below — read them."
  echo ""
  echo "Changed in ${stable}:"
  git diff --stat FETCH_HEAD -- "$stable"
  echo ""
  echo "Changed in ${fork}:"
  git diff --stat FETCH_HEAD -- "$fork"
  exit 0
fi

if changed "$stable" && changed "$fork"; then
  echo "::error::This branch changes both ${stable} and ${fork}. The fork exists so the stable game cannot regress while multiplayer is built — split this into two pull requests: one for ${fork}, and one deliberate one for ${stable} on its own. If they genuinely cannot be split because main would be broken in between — a repository-wide move, for instance — add the trailer 'Fork-guard: both' to a commit message on this branch and say in the pull request why."
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
