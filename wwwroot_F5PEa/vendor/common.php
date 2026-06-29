<?php
// Crown 原系统所有时间字段都用东八区(北京/上海)呈现。SPA 后台(member/agents/d0)
// 经此 bootstrap 加载，若不显式设定时区会回退到 php.ini 默认值(常为 UTC)，
// 导致注单时间(bet_time)、登入日志等显示时区错误。统一锁定为 Asia/Shanghai。
date_default_timezone_set('Asia/Shanghai');
include_once "common/Constant.php";
include_once "mysql/config.php";
include_once "common/global.php";
include_once "common/db.php";
include_once "common/ip.php";
include_once "common/client.class.php";
include_once "common/curl_http.php";
//include_once "common/curl_function.php";
include_once "common/isMoblie.php";
include_once "common/A2Xml.php";
include_once "common/function.php";
include_once "common/Base.php";
include_once "common/Transform.php";
include_once "common/TransformAG.php";
include_once "common/Login.php";
include_once "common/RatioChgRule.php";
include_once "common/Util_game.php";
include_once "common/Wtype_Rtype.php";
include_once "common/typeMap.php";
include_once "common/Bet.php";
include_once "common/Result.php";

//过滤特殊函数
$isNormal = ["code"=>1,"data"=>""];//网站是否正常 code=1 表示正常
$disable_functions = '/^!and|update|from|where|order|delete|\'|\*|insert|into|values|create|table|database|script|iframe|<>|onload|\"|phpinfo|eval|passthru|exec|system|chroot|scandir|chgrp|chown|shell_exec|proc_open|proc_get_status|ini_alter|ini_alter|ini_restore|pfsockopen|openlog|syslog|readlink|symlink|popepassthru|stream_socket_server|fsocket|fsockopen$/is';
foreach ($_REQUEST as $k => $v){
    if(preg_match($disable_functions,$v) && $k!="blackbox"){
        $isNormal = [
            "code"=>2,
            "data"=>$v
        ];
        break;
    }
}
$langx = isset($_REQUEST["langx"]) ? $_REQUEST["langx"] : "zh-cn";
include_once "common/conf/{$langx}.php";
include_once "common/conf/ag-{$langx}.php";
define('IS_NORMAL',serialize($isNormal));
