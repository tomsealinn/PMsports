<?php
$_p = unserialize(_POST_);
global $web_time_zone;
$arr_js = ["lib/calendar.js","lib/ClassFankCal.js","{$_p["p"]}.js","lib/ClassSelect.js","zxcvbn.js"];
$arr_css = [
    "control/reset.css",
    "control/cal.css",
    "control/report_main.css",
    "control/overcss.css",
];

$js = "";
$css = "";
include_once INCLUDE_DIR."/getHtml.php";