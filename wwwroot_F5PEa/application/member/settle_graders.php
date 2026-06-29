<?php
/**
 * settle_graders.php — pure bet-grading logic (no DB, no I/O).
 *
 * Extracted from settle_bets.php so the grader can be unit-tested in
 * isolation (see test_graders.php) and shared by any settle path.
 *
 * gradeBet(array $bet, array $fx, bool $flipped): ?string
 *   Returns 'W' | 'L' | 'HW' | 'HL' | 'T' (void/refund) | null (unknown — skip).
 *
 * $fx shape (built by settle_bets.php from foot_match / api-sports):
 *   goals.home/away                 final full-time score
 *   score.halftime.home/away        half-time score (may be null)
 *   corners.home/away               final corner counts (may be null)
 *   cards.home/away                 final card counts = yc + rc (may be null)
 *   fixture.status.short            'FT' etc.
 *
 * PHP 7.4 compatible (no match expr / str_contains / nullsafe).
 *
 * ---- wtype / rtype / spread conventions (must mirror api_v2.php) -----------
 *   Existing (unchanged): ML/HT_ML, DNB, SP/HT_SP, OU/HT_OU, DC, BTS/HT_BTS,
 *                         CS/HT_CS, OE, CORNER_OU, CORNER_HDP.
 *   A1 additions:
 *     2H_ML            rtype H|D|C                     (2nd-half result)
 *     2H_OU            rtype OVER|UNDER  spread        (2nd-half totals)
 *     2H_BTS           rtype Y|N                       (2nd-half BTS)
 *     2H_OE            rtype ODD|EVEN                  (2nd-half odd/even)
 *     EH / HT_EH       rtype H|D|C       spread        (European/3-way handicap;
 *                        spread = handicap on the CHOSEN side for H/C,
 *                        = HOME handicap for D)
 *     TEAM_OU          rtype H_OVER|H_UNDER|C_OVER|C_UNDER  spread
 *     CRN_T_OU         rtype H_OVER|H_UNDER|C_OVER|C_UNDER  spread (team corners)
 *     CARD_T_OU        rtype H_OVER|H_UNDER|C_OVER|C_UNDER  spread (team cards)
 *     EXACT_TG         rtype "N" | "N+"                (full-match total goals)
 *     EXTG_HT          rtype "N" | "N+"                (1st-half total)
 *     EXTG_2H          rtype "N" | "N+"                (2nd-half total)
 *     EXACT_TEAM       rtype "H_N"|"C_N"|"H_N+"|"C_N+" (team exact goals)
 *     CLN_SHEET        rtype H_Y|H_N|C_Y|C_N
 *     WIN_TO_NIL       rtype H_Y|H_N|C_Y|C_N  (bare H|C = Yes)
 *     HIGH_HALF        rtype 1ST|2ND|EQUAL             (needs HT)
 *     WIN_BOTH         rtype H|C                       (needs HT)
 *     WIN_EITH         rtype H|C                       (needs HT)
 *     SCR_BOTH         rtype H_Y|H_N|C_Y|C_N (bare H|C = Yes; needs HT)
 *     TSCORE_2H        rtype H_Y|H_N|C_Y|C_N (bare H|C = Yes; needs HT)
 *     HT_FT            rtype "X/Y" with X,Y in H|D|C   (needs HT)
 *     CARDS_OU         rtype OVER|UNDER  spread        (total cards)
 *     CARDS_HDP        rtype H|C         spread        (Asian handicap on cards)
 *     CARDS_EH         rtype H|D|C       spread        (European handicap on cards)
 *     CORNER_EH        rtype H|D|C       spread        (European handicap on corners)
 *   A2 Tier-0 additions (foot_match-derivable, no fetch):
 *     MARGIN           rtype D | H_N | H_N+ | C_N | C_N+   (winning margin)
 *     RES_TOT/HT_RES_TOT rtype H_OVER|D_UNDER|...  spread  (result + total)
 *     RES_BTS          rtype H_Y|D_N|C_Y|...           (result + BTS)
 *     TOT_BTS          rtype OVER_Y|UNDER_N|...  spread (total + BTS)
 *     TEAM_OE          rtype H_ODD|H_EVEN|C_ODD|C_EVEN (per-team odd/even)
 *     HT_OE            rtype ODD|EVEN                  (1st-half total odd/even)
 *     HALF_TEAM        rtype H_1ST|H_2ND|H_EQUAL|C_... (per-team highest half)
 *
 *   A2-safe additions (need foot_match.gs_* enrich = soccerfixtures timeline
 *   + ET/PEN scores; SKIP=null when $fx['gs'] absent → manual, never wrong):
 *     FGL_TEAM         rtype H|C|NONE                  (team to score first)
 *     LGL_TEAM         rtype H|C|NONE                  (team to score last)
 *     NGL_TEAM         rtype H|C|NO   spread=N         (team scoring Nth goal)
 *     DEC_PEN          rtype Y|N                       (decided on penalties)
 *     DEC_ET           rtype Y|N                       (decided in extra time)
 *     QUALIFY          rtype H|C       (team advances; ONLY when dec=ET/PEN)
 *     WIN_METH         rtype "<H|C>_<REG|ET|PEN>"      (method of victory)
 *     FG_INT/_H/_C     rtype "<A>_<B>" min window | NONE (1st-goal interval)
 *   A2-safe graders present but NOT yet hinted in api_v2 (outcome-label format
 *   pending live verification): WIN_METH, FG_INT* — stay manual until hinted.
 *
 *   NOTE: db_client.bet.wtype/rtype are varchar(10) — every code is <=10 chars.
 */

if (!function_exists('_sg_ouGrade')) {

/** Over/Under grade from (total - line). Handles half & quarter lines. */
function _sg_ouGrade(float $diff, bool $isOver): string {
    if (abs($diff) < 1e-9)   return 'T';
    if ($diff > 0.25)        return $isOver ? 'W'  : 'L';
    elseif ($diff > 0)       return $isOver ? 'HW' : 'HL';
    elseif ($diff < -0.25)   return $isOver ? 'L'  : 'W';
    else                     return $isOver ? 'HL' : 'HW';
}

/** Asian-handicap grade from diff = (myGoals + line) - oppGoals. */
function _sg_spGrade(float $diff): string {
    if ($diff > 0.25)          return 'W';
    elseif ($diff > 0)         return 'HW';
    elseif (abs($diff) < 1e-9) return 'T';
    elseif ($diff < -0.25)     return 'L';
    else                       return 'HL';
}

/** 3-way result code for a score pair. */
function _sg_res(int $h, int $c): string {
    return $h > $c ? 'H' : ($c > $h ? 'C' : 'D');
}

/**
 * European / 3-way handicap on a (home, away) score.
 *   rtype H|C : spread is the handicap applied to that chosen side;
 *               win iff the side strictly wins after the handicap
 *               (level after handicap = the Draw outcome → lose).
 *   rtype D   : spread is the HOME handicap; win iff level after handicap.
 * Returns 'W'|'L'|null.
 */
function _sg_ehGrade(int $hx, int $cx, string $rtype, ?float $sp): ?string {
    if ($sp === null) return null;
    if ($rtype === 'H') { $d = ($hx + $sp) - $cx; return $d > 1e-9 ? 'W' : 'L'; }
    if ($rtype === 'C') { $d = ($cx + $sp) - $hx; return $d > 1e-9 ? 'W' : 'L'; }
    if ($rtype === 'D') { $d = ($hx + $sp) - $cx; return abs($d) < 1e-9 ? 'W' : 'L'; }
    return null;
}

/** Exact-count grade: rtype "N" (==) or "N+" (>=). Returns 'W'|'L'|null. */
function _sg_exact(string $rtype, int $count): ?string {
    $r = trim($rtype);
    if ($r === '') return null;
    if (preg_match('/^(\d+)\s*\+$/', $r, $m)) return $count >= (int)$m[1] ? 'W' : 'L';
    if (preg_match('/^\d+$/', $r))            return $count === (int)$r   ? 'W' : 'L';
    return null;
}

/** Split a side_dir rtype like "H_OVER" → ['H','OVER']; null on bad shape. */
function _sg_sideDir(string $rtype): ?array {
    $p = explode('_', strtoupper(trim($rtype)), 2);
    if (count($p) !== 2) return null;
    if ($p[0] !== 'H' && $p[0] !== 'C') return null;
    if ($p[1] !== 'OVER' && $p[1] !== 'UNDER') return null;
    return $p;
}

/** Split a side_YN rtype like "H_Y"; accepts bare "H"/"C" (= Yes). */
function _sg_sideYN(string $rtype): ?array {
    $r = strtoupper(trim($rtype));
    if ($r === 'H' || $r === 'C') return [$r, 'Y'];
    $p = explode('_', $r, 2);
    if (count($p) !== 2) return null;
    if ($p[0] !== 'H' && $p[0] !== 'C') return null;
    $yn = $p[1] === 'Y' || $p[1] === 'YES' ? 'Y' : ($p[1] === 'N' || $p[1] === 'NO' ? 'N' : null);
    if ($yn === null) return null;
    return [$p[0], $yn];
}

/**
 * Decide single-leg result by wtype/rtype/spread + scores.
 */
function gradeBet(array $bet, array $fx, bool $flipped): ?string {
    $h = $fx['goals']['home'] ?? null;
    $c = $fx['goals']['away'] ?? null;
    $hHt = $fx['score']['halftime']['home'] ?? null;
    $cHt = $fx['score']['halftime']['away'] ?? null;
    if ($flipped) { [$h, $c] = [$c, $h]; [$hHt, $cHt] = [$cHt, $hHt]; }
    if ($h === null || $c === null) return null;

    $wtype  = strtoupper((string)($bet['wtype']  ?? ''));
    $rtype  = strtoupper((string)($bet['rtype']  ?? ''));
    $spread = $bet['spread'] !== null && $bet['spread'] !== '' ? (float)$bet['spread'] : null;

    // Final corner counts (foot_match.apisports_corners_h/c; null on external).
    $cH = isset($fx['corners']['home']) && $fx['corners']['home'] !== null ? (int)$fx['corners']['home'] : null;
    $cC = isset($fx['corners']['away']) && $fx['corners']['away'] !== null ? (int)$fx['corners']['away'] : null;
    if ($flipped) { [$cH, $cC] = [$cC, $cH]; }

    // Final card counts = yellow + red (foot_match.apisports_yc/rc_h/c).
    $kH = isset($fx['cards']['home']) && $fx['cards']['home'] !== null ? (int)$fx['cards']['home'] : null;
    $kC = isset($fx['cards']['away']) && $fx['cards']['away'] !== null ? (int)$fx['cards']['away'] : null;
    if ($flipped) { [$kH, $kC] = [$kC, $kH]; }

    // ---- A2 enrich data (Goalserve soccerfixtures timeline + ET/PEN) ----
    // $fx['gs'] is decoded from foot_match.gs_timeline + gs_* cols by
    // settle_bets.php PRIORITY-0.  Goal/card sides ('H'/'C') and score pairs
    // are in foot_match (home/away) orientation; flip to bet orientation when
    // $flipped.  All A2 cases below SKIP (return null) when $gs is absent, so
    // a row that hasn't been enriched yet grades as manual (never mis-graded).
    $gs = (isset($fx['gs']) && is_array($fx['gs'])) ? $fx['gs'] : null;
    $gsGoals = []; $gsFt = null; $gsEt = null; $gsPen = null; $gsDec = null;
    if ($gs !== null) {
        $gsDec = isset($gs['dec']) && $gs['dec'] !== '' ? strtoupper((string)$gs['dec']) : null;
        $_gsPair = function ($p) use ($flipped) {
            if (!is_array($p) || count($p) < 2 || $p[0] === null || $p[1] === null) return null;
            $a = (int)$p[0]; $b = (int)$p[1];
            return $flipped ? [$b, $a] : [$a, $b];
        };
        $gsFt  = $_gsPair($gs['ft']  ?? null);
        $gsEt  = $_gsPair($gs['et']  ?? null);
        $gsPen = $_gsPair($gs['pen'] ?? null);
        if (isset($gs['g']) && is_array($gs['g'])) {
            foreach ($gs['g'] as $gv) {
                if (!is_array($gv)) continue;
                $sd = strtoupper((string)($gv['s'] ?? ''));
                if ($flipped) { $sd = $sd === 'H' ? 'C' : ($sd === 'C' ? 'H' : $sd); }
                $gsGoals[] = [
                    'm' => (isset($gv['m']) && $gv['m'] !== null) ? (int)$gv['m'] : null,
                    'x' => (isset($gv['x']) && $gv['x'] !== null) ? (int)$gv['x'] : 0,
                    's' => $sd,
                    'p' => (string)($gv['p'] ?? ''),
                    't' => strtoupper((string)($gv['t'] ?? 'N')),
                ];
            }
            usort($gsGoals, function ($a, $b) {
                $am = $a['m'] === null ? 9999 : $a['m'];
                $bm = $b['m'] === null ? 9999 : $b['m'];
                if ($am !== $bm) return $am <=> $bm;
                return (int)$a['x'] <=> (int)$b['x'];
            });
        }
    }
    // Winner side ('H'|'C'|null) from a [home,away] score pair.
    $gsWinner = function (?array $pair) {
        if ($pair === null) return null;
        if ($pair[0] > $pair[1]) return 'H';
        if ($pair[1] > $pair[0]) return 'C';
        return null;
    };

    // Raw score frames.
    $Hf = (int)$h; $Cf = (int)$c;
    $Hht = $hHt !== null ? (int)$hHt : null;
    $Cht = $cHt !== null ? (int)$cHt : null;
    $H2 = $Hht !== null ? ($Hf - $Hht) : null;   // 2nd-half goals (null if no HT)
    $C2 = $Cht !== null ? ($Cf - $Cht) : null;

    // Legacy half/full resolution for the original HT_* + generic cases.
    $isHt = in_array($wtype, ['HT_ML','HT_SP','HT_OU','HT_BTS','HT_CS'], true);
    if ($isHt) {
        if ($Hht === null || $Cht === null) return null;
        $H = $Hht; $C = $Cht;
    } else {
        $H = $Hf; $C = $Cf;
    }
    $total = $H + $C;
    $homeWin = $H > $C; $awayWin = $C > $H; $draw = $H === $C;

    switch ($wtype) {
        // ---- Match winner (3-way) ----
        case '1X2':
        case 'ML':
        case 'HT_ML':
            if ($rtype === 'H') return $homeWin ? 'W' : 'L';
            if ($rtype === 'C') return $awayWin ? 'W' : 'L';
            if ($rtype === 'D') return $draw    ? 'W' : 'L';
            return null;

        // ---- Draw No Bet ----
        case 'DNB':
            if ($draw) return 'T';
            if ($rtype === 'H') return $homeWin ? 'W' : 'L';
            if ($rtype === 'C') return $awayWin ? 'W' : 'L';
            return null;

        // ---- Asian Handicap ----
        case 'SP':
        case 'HT_SP':
            if ($spread === null) return null;
            $myGoals  = $rtype === 'H' ? $H : ($rtype === 'C' ? $C : null);
            $oppGoals = $rtype === 'H' ? $C : ($rtype === 'C' ? $H : null);
            if ($myGoals === null) return null;
            return _sg_spGrade(($myGoals + $spread) - $oppGoals);

        // ---- Over / Under totals ----
        case 'OU':
        case 'HT_OU':
            if ($spread === null) return null;
            return _sg_ouGrade($total - $spread, $rtype === 'OVER');

        // ---- Double Chance ----
        case 'DC':
            if ($rtype === 'HD') return ($homeWin || $draw)    ? 'W' : 'L';
            if ($rtype === 'CD') return ($awayWin || $draw)    ? 'W' : 'L';
            if ($rtype === 'HC') return ($homeWin || $awayWin) ? 'W' : 'L';
            return null;

        // ---- Both Teams To Score ----
        case 'BTS':
        case 'HT_BTS':
            $bts = ($H > 0 && $C > 0);
            if ($rtype === 'Y') return $bts ? 'W' : 'L';
            if ($rtype === 'N') return $bts ? 'L' : 'W';
            return null;

        // ---- Correct Score (full / half) ----
        case 'HT_CS':
        case 'CS':
            $rs = str_replace('-', ':', $rtype);
            $parts = explode(':', $rs);
            if (count($parts) !== 2) return null;
            $rH = (int)$parts[0]; $rC = (int)$parts[1];
            return ($rH === $H && $rC === $C) ? 'W' : 'L';

        // ---- Total Goals Odd/Even ----
        case 'OE':
            $isOdd = ($total % 2 === 1);
            if ($rtype === 'ODD')  return $isOdd ? 'W' : 'L';
            if ($rtype === 'EVEN') return $isOdd ? 'L' : 'W';
            return null;

        // ====================== A1 ADDITIONS ======================

        // ---- 2nd-half result / To Win 2nd Half ----
        case '2H_ML':
            if ($H2 === null || $C2 === null) return null;
            if ($rtype === 'H') return $H2 >  $C2 ? 'W' : 'L';
            if ($rtype === 'C') return $C2 >  $H2 ? 'W' : 'L';
            if ($rtype === 'D') return $H2 === $C2 ? 'W' : 'L';
            return null;

        // ---- 2nd-half Over/Under ----
        case '2H_OU':
            if ($spread === null || $H2 === null || $C2 === null) return null;
            return _sg_ouGrade(($H2 + $C2) - $spread, $rtype === 'OVER');

        // ---- 2nd-half BTS ----
        case '2H_BTS':
            if ($H2 === null || $C2 === null) return null;
            $bts2 = ($H2 > 0 && $C2 > 0);
            if ($rtype === 'Y') return $bts2 ? 'W' : 'L';
            if ($rtype === 'N') return $bts2 ? 'L' : 'W';
            return null;

        // ---- 2nd-half Odd/Even ----
        case '2H_OE':
            if ($H2 === null || $C2 === null) return null;
            $isOdd2 = ((($H2 + $C2) % 2) === 1);
            if ($rtype === 'ODD')  return $isOdd2 ? 'W' : 'L';
            if ($rtype === 'EVEN') return $isOdd2 ? 'L' : 'W';
            return null;

        // ---- European / 3-way handicap (full / 1st half) ----
        case 'EH':
            return _sg_ehGrade($Hf, $Cf, $rtype, $spread);
        case 'HT_EH':
            if ($Hht === null || $Cht === null) return null;
            return _sg_ehGrade($Hht, $Cht, $rtype, $spread);

        // ---- Team goals Over/Under (full match) ----
        case 'TEAM_OU':
            if ($spread === null) return null;
            $sd = _sg_sideDir($rtype);
            if ($sd === null) return null;
            $val = $sd[0] === 'H' ? $Hf : $Cf;
            return _sg_ouGrade($val - $spread, $sd[1] === 'OVER');

        // ---- Exact total goals (full / 1st half / 2nd half) ----
        case 'EXACT_TG':
            return _sg_exact($rtype, $Hf + $Cf);
        case 'EXTG_HT':
            if ($Hht === null || $Cht === null) return null;
            return _sg_exact($rtype, $Hht + $Cht);
        case 'EXTG_2H':
            if ($H2 === null || $C2 === null) return null;
            return _sg_exact($rtype, $H2 + $C2);

        // ---- Team exact goals (rtype "H_N" / "C_N+") ----
        case 'EXACT_TEAM':
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2) return null;
            if ($p[0] === 'H') return _sg_exact($p[1], $Hf);
            if ($p[0] === 'C') return _sg_exact($p[1], $Cf);
            return null;

        // ---- Clean sheet (home keeps clean = away scored 0) ----
        case 'CLN_SHEET':
            $yn = _sg_sideYN($rtype);
            if ($yn === null) return null;
            $clean = $yn[0] === 'H' ? ($Cf === 0) : ($Hf === 0);
            return ($clean === ($yn[1] === 'Y')) ? 'W' : 'L';

        // ---- Win to nil (team wins AND keeps clean) ----
        case 'WIN_TO_NIL':
            $yn = _sg_sideYN($rtype);
            if ($yn === null) return null;
            $wtn = $yn[0] === 'H' ? ($Hf > $Cf && $Cf === 0) : ($Cf > $Hf && $Hf === 0);
            return ($wtn === ($yn[1] === 'Y')) ? 'W' : 'L';

        // ---- Highest scoring half ----
        case 'HIGH_HALF':
            if ($H2 === null || $C2 === null) return null;
            $g1 = $Hht + $Cht; $g2 = $H2 + $C2;
            $win = $g1 > $g2 ? '1ST' : ($g2 > $g1 ? '2ND' : 'EQUAL');
            $r = strtoupper($rtype);
            if (in_array($r, ['1ST','2ND','EQUAL'], true)) return $r === $win ? 'W' : 'L';
            return null;

        // ---- Win both halves / either half ----
        case 'WIN_BOTH':
            if ($H2 === null || $C2 === null) return null;
            if ($rtype === 'H') return ($Hht > $Cht && $H2 > $C2) ? 'W' : 'L';
            if ($rtype === 'C') return ($Cht > $Hht && $C2 > $H2) ? 'W' : 'L';
            return null;
        case 'WIN_EITH':
            if ($H2 === null || $C2 === null) return null;
            if ($rtype === 'H') return ($Hht > $Cht || $H2 > $C2) ? 'W' : 'L';
            if ($rtype === 'C') return ($Cht > $Hht || $C2 > $H2) ? 'W' : 'L';
            return null;

        // ---- Team to score in both halves / in 2nd half ----
        case 'SCR_BOTH':
            if ($H2 === null || $C2 === null) return null;
            $yn = _sg_sideYN($rtype);
            if ($yn === null) return null;
            $sb = $yn[0] === 'H' ? ($Hht > 0 && $H2 > 0) : ($Cht > 0 && $C2 > 0);
            return ($sb === ($yn[1] === 'Y')) ? 'W' : 'L';
        case 'TSCORE_2H':
            if ($H2 === null || $C2 === null) return null;
            $yn = _sg_sideYN($rtype);
            if ($yn === null) return null;
            $sc = $yn[0] === 'H' ? ($H2 > 0) : ($C2 > 0);
            return ($sc === ($yn[1] === 'Y')) ? 'W' : 'L';

        // ---- Half-time / Full-time ----
        case 'HT_FT':
            if ($Hht === null || $Cht === null) return null;
            $rr = str_replace(['-', ' '], ['/', ''], strtoupper($rtype));
            $parts = explode('/', $rr);
            if (count($parts) !== 2) return null;
            $htR = _sg_res($Hht, $Cht); $ftR = _sg_res($Hf, $Cf);
            return ($parts[0] === $htR && $parts[1] === $ftR) ? 'W' : 'L';

        // ====================== Corners ======================
        case 'CORNER_OU':
            if ($spread === null || $cH === null || $cC === null) return null;
            return _sg_ouGrade(($cH + $cC) - $spread, $rtype === 'OVER');
        case 'CORNER_HDP':
            if ($spread === null || $cH === null || $cC === null) return null;
            $myC  = $rtype === 'H' ? $cH : ($rtype === 'C' ? $cC : null);
            $oppC = $rtype === 'H' ? $cC : ($rtype === 'C' ? $cH : null);
            if ($myC === null) return null;
            return _sg_spGrade(($myC + $spread) - $oppC);
        case 'CORNER_EH':
            if ($cH === null || $cC === null) return null;
            return _sg_ehGrade($cH, $cC, $rtype, $spread);
        case 'CRN_T_OU':
            if ($spread === null || $cH === null || $cC === null) return null;
            $sd = _sg_sideDir($rtype);
            if ($sd === null) return null;
            $val = $sd[0] === 'H' ? $cH : $cC;
            return _sg_ouGrade($val - $spread, $sd[1] === 'OVER');
        // Corner total 3-way at an INTEGER line.  rtype "OVER_N"|"UNDER_N"|"EXACTLY_N".
        case 'CORNER_3W':
            if ($cH === null || $cC === null) return null;
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2 || !preg_match('/^\d+$/', $p[1])) return null;
            $tc = $cH + $cC; $n = (int)$p[1];
            if ($p[0] === 'OVER')    return $tc >  $n ? 'W' : 'L';
            if ($p[0] === 'UNDER')   return $tc <  $n ? 'W' : 'L';
            if ($p[0] === 'EXACTLY') return $tc === $n ? 'W' : 'L';
            return null;

        // ====================== Cards (count = yc + rc) ======================
        case 'CARDS_OU':
            if ($spread === null || $kH === null || $kC === null) return null;
            return _sg_ouGrade(($kH + $kC) - $spread, $rtype === 'OVER');
        case 'CARDS_HDP':
            if ($spread === null || $kH === null || $kC === null) return null;
            $myK  = $rtype === 'H' ? $kH : ($rtype === 'C' ? $kC : null);
            $oppK = $rtype === 'H' ? $kC : ($rtype === 'C' ? $kH : null);
            if ($myK === null) return null;
            return _sg_spGrade(($myK + $spread) - $oppK);
        case 'CARDS_EH':
            if ($kH === null || $kC === null) return null;
            return _sg_ehGrade($kH, $kC, $rtype, $spread);
        case 'CARD_T_OU':
            if ($spread === null || $kH === null || $kC === null) return null;
            $sd = _sg_sideDir($rtype);
            if ($sd === null) return null;
            $val = $sd[0] === 'H' ? $kH : $kC;
            return _sg_ouGrade($val - $spread, $sd[1] === 'OVER');

        // ============ A2 Tier-0 (foot_match-derivable, no fetch) ============

        // ---- Winning margin.  rtype:
        //      D  = any draw, D0 = goalless draw (0-0), DS = score draw (>=1-1),
        //      "<H|C>_<N|N+>" : home/away win by exactly N (or N+). ----
        case 'MARGIN':
            if ($rtype === 'D')  return ($Hf === $Cf) ? 'W' : 'L';
            if ($rtype === 'D0') return ($Hf === 0 && $Cf === 0) ? 'W' : 'L';
            if ($rtype === 'DS') return ($Hf === $Cf && $Hf > 0) ? 'W' : 'L';
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2) return null;
            $diff = $Hf - $Cf;
            if ($p[0] === 'H') return $diff <= 0 ? 'L' : _sg_exact($p[1], $diff);
            if ($p[0] === 'C') return $diff >= 0 ? 'L' : _sg_exact($p[1], -$diff);
            return null;

        // ---- Result + Total Goals combo.  rtype "<H|D|C>_<OVER|UNDER>" spread.
        //      Lines are .5 (no push); integer-line exact total → void. ----
        case 'RES_TOT':
        case 'HT_RES_TOT':
            if ($spread === null) return null;
            if ($wtype === 'HT_RES_TOT') { if ($Hht === null || $Cht === null) return null; $rh = $Hht; $rc = $Cht; }
            else { $rh = $Hf; $rc = $Cf; }
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2 || ($p[1] !== 'OVER' && $p[1] !== 'UNDER')) return null;
            $tot = $rh + $rc;
            $ouWin = $p[1] === 'OVER' ? ($tot > $spread) : ($tot < $spread);
            if (_sg_res($rh, $rc) === $p[0] && $ouWin) return 'W';
            if (abs($tot - $spread) < 1e-9) return 'T';
            return 'L';

        // ---- Result + Both-Teams-To-Score combo.  rtype "<H|D|C>_<Y|N>". ----
        case 'RES_BTS':
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2) return null;
            $bts = ($Hf > 0 && $Cf > 0);
            $btsWanted = ($p[1] === 'Y' || $p[1] === 'YES');
            return (_sg_res($Hf, $Cf) === $p[0] && $bts === $btsWanted) ? 'W' : 'L';

        // ---- Total Goals + BTS combo.  rtype "<OVER|UNDER>_<Y|N>" spread. ----
        case 'TOT_BTS':
            if ($spread === null) return null;
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2 || ($p[0] !== 'OVER' && $p[0] !== 'UNDER')) return null;
            $tot = $Hf + $Cf;
            $ouWin = $p[0] === 'OVER' ? ($tot > $spread) : ($tot < $spread);
            $bts = ($Hf > 0 && $Cf > 0);
            $btsWanted = ($p[1] === 'Y' || $p[1] === 'YES');
            if ($ouWin && $bts === $btsWanted) return 'W';
            if (abs($tot - $spread) < 1e-9) return 'T';
            return 'L';

        // ---- Per-team goals Odd/Even.  rtype "<H|C>_<ODD|EVEN>" (0 = even). ----
        case 'TEAM_OE':
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2) return null;
            $val = $p[0] === 'H' ? $Hf : ($p[0] === 'C' ? $Cf : null);
            if ($val === null) return null;
            $isOdd = (($val % 2) === 1);
            if ($p[1] === 'ODD')  return $isOdd ? 'W' : 'L';
            if ($p[1] === 'EVEN') return $isOdd ? 'L' : 'W';
            return null;

        // ---- 1st-half total Odd/Even. ----
        case 'HT_OE':
            if ($Hht === null || $Cht === null) return null;
            $isOddH = ((($Hht + $Cht) % 2) === 1);
            if ($rtype === 'ODD')  return $isOddH ? 'W' : 'L';
            if ($rtype === 'EVEN') return $isOddH ? 'L' : 'W';
            return null;

        // ---- Per-team highest-scoring half.  rtype "<H|C>_<1ST|2ND|EQUAL>". ----
        case 'HALF_TEAM':
            if ($H2 === null || $C2 === null) return null;
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2) return null;
            $g1 = $p[0] === 'H' ? $Hht : ($p[0] === 'C' ? $Cht : null);
            $g2 = $p[0] === 'H' ? $H2  : ($p[0] === 'C' ? $C2  : null);
            if ($g1 === null) return null;
            $win = $g1 > $g2 ? '1ST' : ($g2 > $g1 ? '2ND' : 'EQUAL');
            return in_array($p[1], ['1ST','2ND','EQUAL'], true) ? ($p[1] === $win ? 'W' : 'L') : null;

        // ============ A2-safe (Goalserve soccerfixtures enrich) ============
        // All require $gs (foot_match.gs_timeline + gs_* cols); SKIP when
        // absent so an un-enriched row grades manual, never mis-graded.

        // ---- Team to score first / last.  rtype H | C | NONE (no goals). ----
        case 'FGL_TEAM':
        case 'LGL_TEAM':
            if ($gs === null) return null;
            $finalTot = $gsFt !== null ? ($gsFt[0] + $gsFt[1]) : ($Hf + $Cf);
            if (empty($gsGoals)) {
                if ($finalTot > 0) return null;            // timeline incomplete → manual
                $side = 'NONE';
            } else {
                $g = $wtype === 'FGL_TEAM' ? $gsGoals[0] : $gsGoals[count($gsGoals) - 1];
                $side = $g['s'];
                if ($side !== 'H' && $side !== 'C') return null; // unknown side → manual
            }
            if (in_array($rtype, ['NONE', 'NO', 'NG'], true)) return $side === 'NONE' ? 'W' : 'L';
            if ($rtype === 'H' || $rtype === 'C')              return $side === $rtype ? 'W' : 'L';
            return null;

        // ---- Which team scores the Nth goal.  rtype H|C|NO, spread = N. ----
        case 'NGL_TEAM':
            if ($gs === null || $spread === null) return null;
            $n = (int)round($spread);
            if ($n < 1) return null;
            $finalTot = $gsFt !== null ? ($gsFt[0] + $gsFt[1]) : ($Hf + $Cf);
            if (count($gsGoals) < $n) {
                if ($finalTot >= $n) return null;          // timeline incomplete → manual
                return in_array($rtype, ['NO', 'NONE', 'NG'], true) ? 'W' : 'L';
            }
            $side = $gsGoals[$n - 1]['s'];
            if ($side !== 'H' && $side !== 'C') return null;
            if ($rtype === 'H' || $rtype === 'C')              return $side === $rtype ? 'W' : 'L';
            if (in_array($rtype, ['NO', 'NONE', 'NG'], true))  return 'L';
            return null;

        // ---- Game decided after penalties / in extra time.  rtype Y|N. ----
        case 'DEC_PEN':
        case 'DEC_ET':
            if ($gsDec === null) return null;
            $yes = ($wtype === 'DEC_PEN') ? ($gsDec === 'PEN') : ($gsDec === 'ET');
            if (in_array($rtype, ['Y', 'YES'], true)) return $yes ? 'W' : 'L';
            if (in_array($rtype, ['N', 'NO'],  true)) return $yes ? 'L' : 'W';
            return null;

        // ---- To Qualify.  rtype H|C.  Only resolvable when the tie was
        //      decided in ET/PEN (the ET/PEN winner always advances); a
        //      regulation result may be a 2-leg aggregate → SKIP. ----
        case 'QUALIFY':
            if ($gs === null || $gsDec === null) return null;
            if ($gsDec === 'PEN')      $win = $gsWinner($gsPen);
            elseif ($gsDec === 'ET')   $win = $gsWinner($gsEt);
            else return null;
            if ($win === null) return null;
            if ($rtype === 'H' || $rtype === 'C') return $rtype === $win ? 'W' : 'L';
            return null;

        // ---- Method of Victory.  rtype "<H|C>_<REG|ET|PEN>". ----
        case 'WIN_METH':
            if ($gs === null || $gsDec === null) return null;
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2 || ($p[0] !== 'H' && $p[0] !== 'C')) return null;
            if ($gsDec === 'PEN')    $win = $gsWinner($gsPen);
            elseif ($gsDec === 'ET') $win = $gsWinner($gsEt);
            else                     $win = $gsWinner($gsFt !== null ? $gsFt : [$Hf, $Cf]);
            if ($win === null) return null;
            return ($p[0] === $win && $p[1] === $gsDec) ? 'W' : 'L';

        // ---- 1st-goal time interval (overall / per-team).
        //      rtype "<A>_<B>" inclusive minute window, or NONE (no goal).
        //      Stoppage goals (45+2) count at their base minute (45). ----
        case 'FG_INT':
        case 'FG_INT_H':
        case 'FG_INT_C':
            if ($gs === null) return null;
            $want = $wtype === 'FG_INT_H' ? 'H' : ($wtype === 'FG_INT_C' ? 'C' : null);
            $first = null;
            foreach ($gsGoals as $gv) {
                if ($want !== null && $gv['s'] !== $want) continue;
                if ($gv['m'] === null) return null; // unplaceable goal → manual
                $first = $gv; break;
            }
            if ($first === null) {
                // No qualifying goal — guard against an incomplete timeline:
                // if the relevant scope actually scored, skip (manual).
                $homeF = $gsFt !== null ? $gsFt[0] : $Hf;
                $awayF = $gsFt !== null ? $gsFt[1] : $Cf;
                $scopeTot = $want === 'H' ? $homeF : ($want === 'C' ? $awayF : ($homeF + $awayF));
                if ($scopeTot > 0) return null;
            }
            if (in_array($rtype, ['NONE', 'NG', 'NO'], true)) return $first === null ? 'W' : 'L';
            if ($first === null) return 'L';
            $p = explode('_', $rtype, 2);
            if (count($p) !== 2 || !preg_match('/^\d+$/', $p[0]) || !preg_match('/^\d+$/', $p[1])) return null;
            $a = (int)$p[0]; $b = (int)$p[1];
            return ($first['m'] >= $a && $first['m'] <= $b) ? 'W' : 'L';

        default:
            return null; // unknown — leave for manual review
    }
}

} // function_exists guard
