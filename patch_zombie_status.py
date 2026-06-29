#!/usr/bin/env python3
"""Idempotent anchored patch (PROD backend): fix derive_status zombie-sweeper
bypass when datetime<=0.  A foot_match row with datetime=0/NULL, status=1,
is_inball=0 and no live WS snap currently returns 'inplay' forever (the
LIVE_WINDOW sweeper is skipped because age is None when ts<=0), so a match
that finished yesterday keeps showing on 滚球 with no kickoff/clock/phase.
Aborts unless the anchor matches exactly once.  Reads SRC, writes DST.
"""
import sys

SRC, DST = sys.argv[1], sys.argv[2]
s = open(SRC, encoding="utf-8").read()

OLD = (
    '        if snap_status == "finished" or snap.get("is_finished"):\n'
    '            return "settled"\n'
    "\n"
    "    # Zombie sweeper: Crown says still-active but kickoff > LIVE_WINDOW"
)
NEW = (
    '        if snap_status == "finished" or snap.get("is_finished"):\n'
    '            return "settled"\n'
    "\n"
    "    # Unknown / zero kickoff (Crown never populated foot_match.datetime) with\n"
    "    # no live snap to prove the match is on the pitch: status=1 alone is a\n"
    "    # stale Crown flag, and the LIVE_WINDOW sweeper below can't catch it\n"
    "    # because `age` is undefined when ts<=0.  Without this guard such rows\n"
    "    # masquerade as inplay forever (e.g. a match that finished yesterday but\n"
    "    # was never settled, datetime never written) — they surface on 滚球 with\n"
    "    # no kickoff/clock/phase.  Treat as settled so they leave the live list.\n"
    "    if ts <= 0 and snap is None:\n"
    '        return "settled"\n'
    "\n"
    "    # Zombie sweeper: Crown says still-active but kickoff > LIVE_WINDOW"
)

MARKER = "if ts <= 0 and snap is None:"
if MARKER in s:
    print("already applied, skipping")
else:
    n = s.count(OLD)
    if n != 1:
        sys.exit(f"ABORT: anchor count={n} (expected 1)")
    s = s.replace(OLD, NEW)
    print("applied")

open(DST, "w", encoding="utf-8").write(s)
print("WROTE", DST)
