<?php
global $db_c;
$_p = unserialize(_POST_);
$ov = new OverView($_p);
$userArr = $ov->getUID();//uid验证
if ($userArr["status"] == "error") {
    exit(json_encode($userArr));
}
$ary = $ov->get_history_view();
$ov->insertLog("账号管理->会员[{$ary['mem']['name']}]->点击会员账号->右侧[账户历史-注单明细]");
exit(json_encode($ary));