<?php
/* Unit tests for settle_graders.php gradeBet(). Run on prod PHP 7.4:
 *   scp this + settle_graders.php to a temp dir, then `php test_graders.php`.
 * Returns 'W'|'L'|'HW'|'HL'|'T'|null. */
require __DIR__ . '/settle_graders.php';

$P = 0; $F = 0; $fails = [];
function fx($h, $c, $hh = null, $ch = null, $crh = null, $crc = null, $kh = null, $kc = null) {
    return [
        'goals'   => ['home' => $h, 'away' => $c],
        'score'   => ['halftime' => ['home' => $hh, 'away' => $ch]],
        'corners' => ['home' => $crh, 'away' => $crc],
        'cards'   => ['home' => $kh, 'away' => $kc],
    ];
}
// Build an $fx carrying an A2 enrich payload ($gs) plus a final score.
function fxg(array $gs, $h = 0, $c = 0, $hh = null, $ch = null) {
    $f = fx($h, $c, $hh, $ch);
    $f['gs'] = $gs;
    return $f;
}
function t($desc, $exp, $wtype, $rtype, $spread, $fx, $flip = false) {
    global $P, $F, $fails;
    $got = gradeBet(['wtype' => $wtype, 'rtype' => $rtype, 'spread' => $spread], $fx, $flip);
    $g = $got === null ? 'null' : $got;
    if ($g === $exp) $P++;
    else { $F++; $fails[] = "FAIL [$desc] exp=$exp got=$g"; }
}

// ===== regression: existing wtypes =====
t('ML home win', 'W', 'ML', 'H', null, fx(2, 1));
t('ML away lose', 'L', 'ML', 'C', null, fx(2, 1));
t('ML draw', 'W', 'ML', 'D', null, fx(1, 1));
t('HT_ML home', 'W', 'HT_ML', 'H', null, fx(2, 1, 1, 0));
t('DNB push', 'T', 'DNB', 'H', null, fx(1, 1));
t('SP home -0.5 win', 'W', 'SP', 'H', -0.5, fx(2, 1));
t('SP home -1 push', 'T', 'SP', 'H', -1.0, fx(2, 1));
t('SP away +1.5 win', 'W', 'SP', 'C', 1.5, fx(2, 1));
t('OU over 2.5 win', 'W', 'OU', 'OVER', 2.5, fx(2, 1));
t('OU under 2.5 lose', 'L', 'OU', 'UNDER', 2.5, fx(2, 1));
t('OU over 3 push', 'T', 'OU', 'OVER', 3.0, fx(2, 1));
t('OU over 3 quarter HW', 'HW', 'OU', 'OVER', 2.75, fx(2, 1));
t('DC HD win', 'W', 'DC', 'HD', null, fx(1, 1));
t('BTS yes win', 'W', 'BTS', 'Y', null, fx(2, 1));
t('BTS no lose', 'L', 'BTS', 'N', null, fx(2, 1));
t('CS 2:1 win', 'W', 'CS', '2:1', null, fx(2, 1));
t('CS 2:0 lose', 'L', 'CS', '2-0', null, fx(2, 1));
t('OE odd win', 'W', 'OE', 'ODD', null, fx(2, 1));
t('OE even lose', 'L', 'OE', 'EVEN', null, fx(2, 1));
t('flip ML home', 'W', 'ML', 'H', null, fx(1, 2), true);

// ===== A1 =====
t('2H_ML home', 'W', '2H_ML', 'H', null, fx(3, 1, 1, 1));      // 2H: 2-0
t('2H_OU over1.5', 'W', '2H_OU', 'OVER', 1.5, fx(3, 1, 1, 1)); // 2H total 2
t('2H_BTS yes', 'L', '2H_BTS', 'Y', null, fx(3, 1, 1, 1));     // 2H 2-0 -> no
t('2H_OE even', 'W', '2H_OE', 'EVEN', null, fx(3, 1, 1, 1));   // 2H total 2
t('EH home -1 win', 'W', 'EH', 'H', -1.0, fx(3, 1));
t('EH home -2 lose', 'L', 'EH', 'H', -2.0, fx(3, 1));
t('EH draw -1 win', 'W', 'EH', 'D', -1.0, fx(2, 1));
t('TEAM_OU H over1.5', 'W', 'TEAM_OU', 'H_OVER', 1.5, fx(2, 1));
t('TEAM_OU C under0.5', 'L', 'TEAM_OU', 'C_UNDER', 0.5, fx(2, 1));
t('EXACT_TG 3', 'W', 'EXACT_TG', '3', null, fx(2, 1));
t('EXACT_TG 3+ at4', 'W', 'EXACT_TG', '3+', null, fx(3, 1));
t('EXTG_HT 1', 'W', 'EXTG_HT', '1', null, fx(2, 1, 1, 0));
t('EXTG_2H 2', 'W', 'EXTG_2H', '2', null, fx(3, 1, 1, 1));
t('EXACT_TEAM H_2', 'W', 'EXACT_TEAM', 'H_2', null, fx(2, 1));
t('EXACT_TEAM C_1+', 'W', 'EXACT_TEAM', 'C_1+', null, fx(2, 1));
t('CLN_SHEET H_Y', 'L', 'CLN_SHEET', 'H_Y', null, fx(2, 1));   // away scored
t('CLN_SHEET C_N', 'W', 'CLN_SHEET', 'C_N', null, fx(2, 1));   // home scored -> away not clean
t('WIN_TO_NIL H_Y', 'L', 'WIN_TO_NIL', 'H_Y', null, fx(2, 1));
t('WIN_TO_NIL H bare', 'W', 'WIN_TO_NIL', 'H', null, fx(2, 0));
t('HIGH_HALF 2ND', 'W', 'HIGH_HALF', '2ND', null, fx(3, 1, 1, 0)); // 1H=1,2H=3
t('WIN_BOTH H', 'W', 'WIN_BOTH', 'H', null, fx(3, 1, 1, 0));   // 1H 1-0, 2H 2-1
t('WIN_EITH C', 'L', 'WIN_EITH', 'C', null, fx(3, 1, 1, 0));
t('SCR_BOTH H_Y', 'W', 'SCR_BOTH', 'H_Y', null, fx(3, 1, 1, 0));
t('TSCORE_2H C_Y', 'W', 'TSCORE_2H', 'C_Y', null, fx(3, 1, 1, 0)); // 2H away 1
t('HT_FT H/H', 'W', 'HT_FT', 'H/H', null, fx(2, 1, 1, 0));
t('HT_FT D/H', 'W', 'HT_FT', 'D/H', null, fx(2, 1, 1, 1));
t('CORNER_OU over9.5', 'W', 'CORNER_OU', 'OVER', 9.5, fx(0, 0, null, null, 6, 5));
t('CORNER_HDP H -1.5', 'L', 'CORNER_HDP', 'H', -1.5, fx(0, 0, null, null, 6, 5));
t('CRN_T_OU H over5.5', 'W', 'CRN_T_OU', 'H_OVER', 5.5, fx(0, 0, null, null, 6, 5));
t('CARDS_OU over4.5', 'W', 'CARDS_OU', 'OVER', 4.5, fx(0, 0, null, null, null, null, 3, 2));
t('CARDS_HDP C +0.5', 'L', 'CARDS_HDP', 'C', 0.5, fx(0, 0, null, null, null, null, 3, 2));
t('CARD_T_OU H over2.5', 'W', 'CARD_T_OU', 'H_OVER', 2.5, fx(0, 0, null, null, null, null, 3, 2));
t('CORNER_OU no data', 'null', 'CORNER_OU', 'OVER', 9.5, fx(2, 1));
t('CARDS_OU no data', 'null', 'CARDS_OU', 'OVER', 4.5, fx(2, 1));
t('2H_ML no HT', 'null', '2H_ML', 'H', null, fx(2, 1));

// ===== A2 Tier-0 =====
// MARGIN
t('MARGIN H_1 win', 'W', 'MARGIN', 'H_1', null, fx(2, 1));
t('MARGIN H_2 lose', 'L', 'MARGIN', 'H_2', null, fx(2, 1));
t('MARGIN H_2 win', 'W', 'MARGIN', 'H_2', null, fx(3, 1));
t('MARGIN H_2+ win', 'W', 'MARGIN', 'H_2+', null, fx(3, 1));
t('MARGIN C_1 win', 'W', 'MARGIN', 'C_1', null, fx(1, 2));
t('MARGIN C_1 lose(home won)', 'L', 'MARGIN', 'C_1', null, fx(2, 1));
t('MARGIN D win', 'W', 'MARGIN', 'D', null, fx(1, 1));
t('MARGIN D lose', 'L', 'MARGIN', 'D', null, fx(2, 1));
t('MARGIN H_3+ at exactly3', 'W', 'MARGIN', 'H_3+', null, fx(3, 0));
t('MARGIN D0 goalless win', 'W', 'MARGIN', 'D0', null, fx(0, 0));
t('MARGIN D0 at 1-1 lose', 'L', 'MARGIN', 'D0', null, fx(1, 1));
t('MARGIN DS scoredraw win', 'W', 'MARGIN', 'DS', null, fx(1, 1));
t('MARGIN DS at 0-0 lose', 'L', 'MARGIN', 'DS', null, fx(0, 0));
// CORNER_3W
t('CORNER_3W OVER_8 win', 'W', 'CORNER_3W', 'OVER_8', null, fx(0, 0, null, null, 6, 5));   // 11 corners
t('CORNER_3W EXACTLY_11 win', 'W', 'CORNER_3W', 'EXACTLY_11', null, fx(0, 0, null, null, 6, 5));
t('CORNER_3W UNDER_11 lose', 'L', 'CORNER_3W', 'UNDER_11', null, fx(0, 0, null, null, 6, 5));
t('CORNER_3W no data', 'null', 'CORNER_3W', 'OVER_8', null, fx(2, 1));
// RES_TOT
t('RES_TOT H_OVER 2.5 win', 'W', 'RES_TOT', 'H_OVER', 2.5, fx(2, 1));
t('RES_TOT H_UNDER 2.5 lose', 'L', 'RES_TOT', 'H_UNDER', 2.5, fx(2, 1));
t('RES_TOT D_OVER 2.5 res-miss', 'L', 'RES_TOT', 'D_OVER', 2.5, fx(2, 1));
t('RES_TOT C_OVER 2.5 win', 'W', 'RES_TOT', 'C_OVER', 2.5, fx(1, 3));
t('RES_TOT H_OVER 3 push void', 'T', 'RES_TOT', 'H_OVER', 3.0, fx(2, 1));
t('HT_RES_TOT H_OVER 0.5 win', 'W', 'HT_RES_TOT', 'H_OVER', 0.5, fx(2, 1, 1, 0));
t('HT_RES_TOT no HT', 'null', 'HT_RES_TOT', 'H_OVER', 0.5, fx(2, 1));
// RES_BTS
t('RES_BTS H_Y win', 'W', 'RES_BTS', 'H_Y', null, fx(2, 1));
t('RES_BTS H_N lose', 'L', 'RES_BTS', 'H_N', null, fx(2, 1));
t('RES_BTS D_Y win', 'W', 'RES_BTS', 'D_Y', null, fx(1, 1));
t('RES_BTS C_N res-miss', 'L', 'RES_BTS', 'C_N', null, fx(2, 0));
// TOT_BTS
t('TOT_BTS OVER_Y win', 'W', 'TOT_BTS', 'OVER_Y', 2.5, fx(2, 1));
t('TOT_BTS UNDER_N win', 'W', 'TOT_BTS', 'UNDER_N', 2.5, fx(1, 0));
t('TOT_BTS OVER_N lose', 'L', 'TOT_BTS', 'OVER_N', 2.5, fx(2, 1));
t('TOT_BTS push void', 'T', 'TOT_BTS', 'OVER_Y', 3.0, fx(2, 1));
// TEAM_OE
t('TEAM_OE H_EVEN win', 'W', 'TEAM_OE', 'H_EVEN', null, fx(2, 1));
t('TEAM_OE H_ODD lose', 'L', 'TEAM_OE', 'H_ODD', null, fx(2, 1));
t('TEAM_OE C_ODD win', 'W', 'TEAM_OE', 'C_ODD', null, fx(2, 1));
t('TEAM_OE H_EVEN at0', 'W', 'TEAM_OE', 'H_EVEN', null, fx(0, 1));
// HT_OE
t('HT_OE odd win', 'W', 'HT_OE', 'ODD', null, fx(3, 1, 1, 0));
t('HT_OE even lose', 'L', 'HT_OE', 'EVEN', null, fx(3, 1, 1, 0));
t('HT_OE no HT', 'null', 'HT_OE', 'ODD', null, fx(2, 1));
// HALF_TEAM
t('HALF_TEAM H_2ND', 'W', 'HALF_TEAM', 'H_2ND', null, fx(3, 1, 1, 0)); // home 1H 1, 2H 2
t('HALF_TEAM H_1ST lose', 'L', 'HALF_TEAM', 'H_1ST', null, fx(3, 1, 1, 0));
t('HALF_TEAM C_EQUAL', 'W', 'HALF_TEAM', 'C_EQUAL', null, fx(3, 0, 1, 0)); // away 0/0
t('HALF_TEAM no HT', 'null', 'HALF_TEAM', 'H_1ST', null, fx(2, 1));

// ===== A2-safe (Goalserve soccerfixtures enrich) =====
// Goal/card sides are foot_match (home/away) orientation; settle PRIORITY-0
// calls gradeBet with $flipped=false.
$gsHC  = ['dec' => 'REG', 'ft' => [1, 1], 'g' => [['m' => 10, 'x' => 0, 's' => 'H', 't' => 'N'], ['m' => 80, 'x' => 0, 's' => 'C', 't' => 'N']]];
$gsNone = ['dec' => 'REG', 'ft' => [0, 0], 'g' => []];
$gs3   = ['dec' => 'REG', 'ft' => [2, 1], 'g' => [['m' => 10, 's' => 'H', 't' => 'N'], ['m' => 40, 's' => 'C', 't' => 'N'], ['m' => 70, 's' => 'H', 't' => 'N']]];
// FGL/LGL team
t('FGL_TEAM H win', 'W', 'FGL_TEAM', 'H', null, fxg($gsHC, 1, 1));
t('FGL_TEAM C lose', 'L', 'FGL_TEAM', 'C', null, fxg($gsHC, 1, 1));
t('LGL_TEAM C win', 'W', 'LGL_TEAM', 'C', null, fxg($gsHC, 1, 1));
t('LGL_TEAM H lose', 'L', 'LGL_TEAM', 'H', null, fxg($gsHC, 1, 1));
t('FGL_TEAM NONE win', 'W', 'FGL_TEAM', 'NONE', null, fxg($gsNone, 0, 0));
t('FGL_TEAM H lose noGoal', 'L', 'FGL_TEAM', 'H', null, fxg($gsNone, 0, 0));
t('FGL_TEAM no gs', 'null', 'FGL_TEAM', 'H', null, fx(2, 1));
t('FGL_TEAM flip H->C', 'W', 'FGL_TEAM', 'C', null, fxg($gsHC, 1, 1), true);
// NGL_TEAM (spread = N)
t('NGL_TEAM 2nd=C win', 'W', 'NGL_TEAM', 'C', 2.0, fxg($gs3, 2, 1));
t('NGL_TEAM 2nd H lose', 'L', 'NGL_TEAM', 'H', 2.0, fxg($gs3, 2, 1));
t('NGL_TEAM 1st=H win', 'W', 'NGL_TEAM', 'H', 1.0, fxg($gs3, 2, 1));
t('NGL_TEAM 4th NO win', 'W', 'NGL_TEAM', 'NO', 4.0, fxg($gs3, 2, 1));
t('NGL_TEAM 4th H lose', 'L', 'NGL_TEAM', 'H', 4.0, fxg($gs3, 2, 1));
// DEC_PEN / DEC_ET
t('DEC_PEN Y win', 'W', 'DEC_PEN', 'Y', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('DEC_PEN N lose', 'L', 'DEC_PEN', 'N', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('DEC_ET Y on PEN lose', 'L', 'DEC_ET', 'Y', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('DEC_ET Y win', 'W', 'DEC_ET', 'Y', null, fxg(['dec' => 'ET', 'et' => [2, 1], 'g' => []], 2, 1));
t('DEC_PEN N on REG win', 'W', 'DEC_PEN', 'N', null, fxg(['dec' => 'REG', 'ft' => [2, 1], 'g' => []], 2, 1));
t('DEC_PEN no gs', 'null', 'DEC_PEN', 'Y', null, fx(2, 1));
// QUALIFY (only ET/PEN)
t('QUALIFY H on PEN win', 'W', 'QUALIFY', 'H', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('QUALIFY C on PEN lose', 'L', 'QUALIFY', 'C', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('QUALIFY H on ET win', 'W', 'QUALIFY', 'H', null, fxg(['dec' => 'ET', 'et' => [2, 1], 'g' => []], 2, 1));
t('QUALIFY on REG skip', 'null', 'QUALIFY', 'H', null, fxg(['dec' => 'REG', 'ft' => [2, 1], 'g' => []], 2, 1));
t('QUALIFY flip C on PEN', 'W', 'QUALIFY', 'C', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1), true);
// WIN_METH
t('WIN_METH H_PEN win', 'W', 'WIN_METH', 'H_PEN', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('WIN_METH C_PEN lose', 'L', 'WIN_METH', 'C_PEN', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('WIN_METH H_ET on PEN lose', 'L', 'WIN_METH', 'H_ET', null, fxg(['dec' => 'PEN', 'pen' => [4, 2], 'g' => []], 1, 1));
t('WIN_METH C_ET win', 'W', 'WIN_METH', 'C_ET', null, fxg(['dec' => 'ET', 'et' => [1, 2], 'g' => []], 1, 2));
t('WIN_METH H_REG win', 'W', 'WIN_METH', 'H_REG', null, fxg(['dec' => 'REG', 'ft' => [2, 1], 'g' => []], 2, 1));
// FG_INT
$gsFI = ['dec' => 'REG', 'ft' => [1, 1], 'g' => [['m' => 5, 's' => 'C', 't' => 'N'], ['m' => 20, 's' => 'H', 't' => 'N']]];
t('FG_INT 1_15 win', 'W', 'FG_INT', '1_15', null, fxg($gsFI, 1, 1));
t('FG_INT 16_30 lose', 'L', 'FG_INT', '16_30', null, fxg($gsFI, 1, 1));
t('FG_INT_H 16_30 win', 'W', 'FG_INT_H', '16_30', null, fxg($gsFI, 1, 1));
t('FG_INT_C 1_15 win', 'W', 'FG_INT_C', '1_15', null, fxg($gsFI, 1, 1));
t('FG_INT NONE on goal lose', 'L', 'FG_INT', 'NONE', null, fxg($gsFI, 1, 1));
t('FG_INT NONE no goal win', 'W', 'FG_INT', 'NONE', null, fxg($gsNone, 0, 0));
t('FG_INT 1_15 no goal lose', 'L', 'FG_INT', '1_15', null, fxg($gsNone, 0, 0));
t('FG_INT no gs', 'null', 'FG_INT', '1_15', null, fx(2, 1));

echo "PASS=$P FAIL=$F\n";
foreach ($fails as $x) echo $x . "\n";
exit($F > 0 ? 1 : 0);
