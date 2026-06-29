<?php
global $db_c;
$_p = unserialize(_POST_);
$ov = new OverView($_p);
$userArr = $ov->getUID();//uid验证
if ($userArr["status"] == "error") {
    exit(json_encode($userArr));
}

$ary = $ov->get_today_wagers();
$ov->insertLog("账号管理->会员[{$ary['mem']['name']}]->点击会员账号->右侧[交易状况]");
exit(json_encode($ary));