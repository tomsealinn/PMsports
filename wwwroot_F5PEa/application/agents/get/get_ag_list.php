<?php
global $db_c;
$_p = unserialize(_POST_);
$cc = new Account($_p);
$userArr = $cc->getUID();//uid验证
if($userArr["status"]=="error"){exit(json_encode($userArr));}
$nid = $userArr["sup"]["nid"];
$table = Constant::T_RANK;
$user_id = intval($_p["user_id"]);
$rs = $db_c->select("SELECT `dfwinloss`,`winloss` FROM {$table} WHERE `id`={$user_id}  AND `nid` LIKE '{$nid}%'","Row");
$para = [
    "account" => $cc->get_ag_list(),
    "dfwinloss" => $rs["dfwinloss"],
    "winloss" => $rs["winloss"]
];

$cc->insertLog("账号管理->代理->修改->用户详情设定[加载数据]");
exit(json_encode($para));