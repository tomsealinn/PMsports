<?php
/* Tests parseSettlementHints (extracted verbatim from api_v2.php into
 * hints_fns.php via sed). Run on prod PHP 7.4. */
require __DIR__ . '/hints_fns.php';

$P = 0; $F = 0; $fails = [];
function H($mn, $field, $line, $label = '') {
    return parseSettlementHints($mn, $label, 'Real Madrid', 'Barcelona', false, '', $field, $line);
}
function t($desc, $ew, $er, $es, $mn, $field, $line = null, $label = '') {
    global $P, $F, $fails;
    $r = H($mn, $field, $line, $label);
    $gw = $r['wtype'] === null ? 'null' : $r['wtype'];
    $gr = $r['rtype'] === null ? 'null' : $r['rtype'];
    $gs = $r['spread'] === null ? 'null' : (string)$r['spread'];
    $ew = $ew === null ? 'null' : $ew; $er = $er === null ? 'null' : $er; $es = $es === null ? 'null' : (string)$es;
    if ($gw === $ew && $gr === $er && $gs === $es) $P++;
    else { $F++; $fails[] = "FAIL [$desc] exp=($ew,$er,$es) got=($gw,$gr,$gs)"; }
}

// ===== Tier 0 =====
t('MARGIN H_1', 'MARGIN', 'H_1', null, 'Winning Margin', '1 by 1', null);
t('MARGIN C_4+', 'MARGIN', 'C_4+', null, 'Winning Margin', '2 by 4+', null);
t('MARGIN DS', 'MARGIN', 'DS', null, 'Winning Margin', 'Score Draw', null);
t('MARGIN D0', 'MARGIN', 'D0', null, 'Winning Margin', 'Draw', null);
t('RES_TOT H_OVER', 'RES_TOT', 'H_OVER', '2.5', 'Result/Total Goals', 'Home/Over', 2.5);
t('HT_RES_TOT D_UNDER', 'HT_RES_TOT', 'D_UNDER', '1.5', 'Result/Total Goals (1st Half)', 'Draw/Under', 1.5);
t('RES_BTS C_Y', 'RES_BTS', 'C_Y', null, 'Results/Both Teams To Score', 'Away/Yes', null);
t('RES_BTS H_N', 'RES_BTS', 'H_N', null, 'Results/Both Teams To Score', 'Home/No', null);
t('TOT_BTS OVER_Y', 'TOT_BTS', 'OVER_Y', '2.5', 'Total Goals/Both Teams To Score', 'o/yes', 2.5);
t('TOT_BTS UNDER_N', 'TOT_BTS', 'UNDER_N', '2.5', 'Total Goals/Both Teams To Score', 'u/no', 2.5);
t('TEAM_OE H_ODD', 'TEAM_OE', 'H_ODD', null, 'Home Odd/Even', 'Odd', null);
t('TEAM_OE C_EVEN', 'TEAM_OE', 'C_EVEN', null, 'Away Odd/Even', 'Even', null);
t('HT_OE ODD', 'HT_OE', 'ODD', null, 'Odd/Even 1st Half', 'Odd', null);
t('OE EVEN', 'OE', 'EVEN', null, 'Odd/Even', 'Even', null);
t('OE ODD goals', 'OE', 'ODD', null, 'Goals Odd/Even', 'odd', null);
t('2H_OE via odd/even(2nd half)', '2H_OE', 'ODD', null, 'Odd/Even (2nd Half)', 'Odd', null);
t('GoalLine OU', 'OU', 'OVER', '2.5', 'Goal Line', 'Over', 2.5);
t('GoalLine HT', 'HT_OU', 'UNDER', '1.5', 'Goal Line (1st Half)', 'Under', 1.5);
t('HowMany H 3+', 'EXACT_TEAM', 'H_3+', null, 'How many goals will Home Team score?', 'more 3', null);
t('EXACT_TEAM more3', 'EXACT_TEAM', 'H_3+', null, 'Home Team Exact Goals Number', 'more 3', null);
t('EXACT_TG more7', 'EXACT_TG', '7+', null, 'Exact Goals Number', 'more 7', null);
t('EXTG_HT more5', 'EXTG_HT', '5+', null, '1st Half Exact Goals Number', 'more 5', null);
t('HIGH_HALF Draw=EQUAL', 'HIGH_HALF', 'EQUAL', null, 'Highest Scoring Half', 'Draw', null);
t('HIGH_HALF 2ND', 'HIGH_HALF', '2ND', null, 'Highest Scoring Half', '2nd Half', null);

// ===== A1 regression =====
t('2H_OU', '2H_OU', 'OVER', '1.5', 'Goals Over/Under 2nd Half', 'Over', 1.5);
t('2H_ML', '2H_ML', 'H', null, '2nd Half Winner', 'Home', null);
t('2H_BTS', '2H_BTS', 'Y', null, 'Both Teams To Score - 2nd Half', 'Yes', null);
t('TEAM_OU C_UNDER', 'TEAM_OU', 'C_UNDER', '0.5', 'Total - Away', 'Under', 0.5);
t('HTFT 1/x', 'HT_FT', 'H/D', null, 'Half Time/Full Time', '1/x', null);
t('HTFT Home/Away', 'HT_FT', 'H/C', null, 'HT/FT Double', 'Home/Away', null);
t('WIN_BOTH H', 'WIN_BOTH', 'H', null, 'Win Both Halves', 'Home', null);
t('CLN_SHEET home', 'CLN_SHEET', 'H_Y', null, 'Clean Sheet - Home', 'Yes', null, '是');
t('EH null', null, null, null, 'European Handicap', 'Home', -1.0);
t('CORNER_OU', 'CORNER_OU', 'OVER', '9', 'Total Corners', 'Over', 9.0);

echo "PASS=$P FAIL=$F\n";
foreach ($fails as $x) echo $x . "\n";
exit($F > 0 ? 1 : 0);
