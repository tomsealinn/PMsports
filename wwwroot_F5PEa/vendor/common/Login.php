<?php
class Login extends Base
{
    private $arr;
    private $status_code = "status_code";
    private $ls_ary = [];
    private $ls_code_ary = [];

    public function __construct($_p = [])
    {
        parent::__construct($_p);
        $this->arr = [
            "code"=>"102",
            "action"=>"login",
            "status" => "success",
            "status_code" => "4O000",//4O000 正常登入, 4O001 修改密码, 4O007 超過30(other_set name='chg_pwd_ag')天未修改密碼 要做修改密碼(*) ,4O002 修改安全码
            "user_id" => null,//当前账号id
            "username" => null,//当前账号
            "uid" => null,//uid
            "layer_id" => null,//主账号id
            "layer_username" => null,//主账号
            "pri_type" => null,//模块权限 A:即时注单,B:账号管理,B1:账号管理(观看和更改),B2:账号管理(删除),C:报表 如：A-B-B1-C
            "user_type" => null,//账号类型 1:主账号,2:子账号
            "enable" => null,//状态 Y:开通,N:关闭,S:只能查看
            "enable_pri" => null,
            "pay_type" => 0 //模式：0:自动恢复,1:余额浮动
        ];


        if($this->login_layer == Constant::MEM){
            global $ls_ary,$ls_code_ary;
            $this->arr = [
                "status" => 200,
                "msg" => 100,
                "code_message" => "",
                "username" => "",
                "mid" => "",
                "uid" => "",
                "passwd_safe" => "",
                "ltype" => "",
                "currency" => "",
                "odd_f" => "",
                "pay_type"=> "",
                "domain" => "",
                "t_link" => ""
            ];
            $this->status_code = "code_message";
            $this->ls_ary = $ls_ary;
            $this->ls_code_ary = $ls_code_ary;
        }
    }

    /**
     * 退出登录
     */
    public function get_out(){
        try{
            $this->dbc->update($this->utable,["isout"=>0,"lastdate"=>time(),"uid"=>"ss".time().rand(11111,99999)],"`id`={$this->user["id"]}");
            $this->insertLog("退出登陆");
            return "ok";
        }catch (\Exception $e){
            return $e->getMessage();
        }

    }

    /**
     * 登陆验证
     * @return array
     */
    public function getLogin(){
        global $prefix,$ltypes;
        $domain = get_domain();
        $is4pwd = "N";
        $keycode = "";
        if(isset($this->param["keycode"]) && !empty($this->param["keycode"]) && strlen($this->param["keycode"]) == 32 && isset($this->param["is4pwd"]) && $this->param["is4pwd"] == "Y"){
            $is4pwd = "Y";//简易密码验证
            $keycode = $this->param["keycode"];
        }

        if($this->login_layer==Constant::ADS || $this->login_layer==Constant::AD || $this->login_layer==Constant::D0){
            if(empty($this->param["verifycode"])){
                $this->arr["status"] = "error";
                $this->arr[$this->status_code] = "0X001";
                return $this->arr;
            }

            if(!is_numeric($this->param["verifycode"]) ||  !VerifyCode::check($this->param["verifycode"],$prefix)){
                $this->arr["status"] = "error";
                $this->arr[$this->status_code] = "4X042";
                return $this->arr;
            }
        }
        //print_R($this->param);exit;

        if($is4pwd == "N") {
            if (empty($this->param["username"])) {
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_usr"];
                } else {
                    $this->arr[$this->status_code] = "0X001";
                }
                return $this->arr;
            }

            if (empty($this->param["pwd"])) {
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_pwd"];
                } else {
                    $this->arr[$this->status_code] = "0X001";
                }
                return $this->arr;
            }

            if (!preg_match('/^[a-zA-Z][A-Za-z0-9_]{0,11}$/u', $this->param["username"])) {
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 105;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_error"];
                } else {
                    $this->arr[$this->status_code] = "4X010";
                }
                return $this->arr;
            }

            if (!regexPwd($this->param["pwd"])) {
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 105;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_error"];
                } else {
                    $this->arr[$this->status_code] = "4X021";
                }
                return $this->arr;
            }

            if (($this->login_layer==Constant::CO || $this->login_layer == Constant::SU) && !empty($this->param["pwd_safe"]) && $this->param["pwd_safe"]!="none" && !regexPwd($this->param["pwd_safe"])) {
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 105;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_error"];
                } else {
                    $this->arr[$this->status_code] = "4X011";
                }
                return $this->arr;
            }

            $user = $this->param["username"];
            $pwd = $this->param["pwd"];
        }

        $time = time();
        $filed = "`id`,`nid`,`setloginip`,`status`,`name`,`errnum`,`bandate`,`passwd`,`status`,`enddate`";
        $type_name = "会员";

        switch ($this->login_layer){
            case Constant::SU:
            case Constant::CO:
                $where = "`name`='{$user}'";
                if($this->login_layer == Constant::CO){
                    $where .= " AND `level`=3";
                }else{
                    $where .= " AND `level`=2";
                }
                if(empty($this->param["pwd_safe"]) || $this->param["pwd_safe"] == "none"){//安全码没输入的情况
                    $where .= " AND `pwd_safe` IS NULL ";
                }else{
                    $where .= " AND `pwd_safe`='{$this->param["pwd_safe"]}' ";
                }
                $filed .= ",`isMaster`,`pri`,`cash_sw`,`pay_type`,`config`,`loginname`,`pwd_safe`,if(`pwddate` IS NULL OR ({$time}-`pwddate`)>30*24*60*60,1,0) as `chg_pawd`,`level`";
                if($this->login_layer == Constant::SU){
                    $type_name = "总代理";
                }else{
                    $type_name = "股东";
                }
                break;
            case Constant::AG:
                $filed .= ",`isMaster`,`pri`,`cash_sw`,`pay_type`,`config`,`loginname`,if(`pwddate` IS NULL OR ({$time}-`pwddate`)>30*24*60*60,1,0) as `chg_pawd`,`loginname`,`level`";
                //$where = "((`name`='{$user}' AND `loginname` IS NULL) OR `loginname`='{$user}')  AND `level`=1";
                $md5pwd = md5Pwd($pwd);
                $where = "(`name`='{$user}' AND `loginname` IS NULL) AND `passwd`='{$md5pwd}' AND `level`=1";
                $decide=$this->dbc->select("SELECT `id` FROM {$this->utable} WHERE {$where}",'Row');
                if(!$decide){
                    $where = "`loginname`='{$user}' AND `level`=1";
                }
                $type_name = "代理";
                break;
            case Constant::D0:
                $filed .= ",`isMaster`,`level`,`pri`,if(`pwddate` IS NULL OR ({$time}-`pwddate`)>30*24*60*60,1,0) as `chg_pawd`";
                $where = "`name`='{$user}' AND `level`= 4";
                $type_name = "分公司";
                break;
            case Constant::AD:
            case Constant::ADS:
                $filed .= ",`isMaster`,`level`,`pri`";
                $where = "`name`='{$user}'";
                $type_name = "公司";
                break;
            case Constant::MEM:
                $filed .= ",`cash_sw`,`pay_type`,`pw`,`credit`,`balance_credit`,`config`,`loginname`,`setip`,`seturl`,`currency`,`ltype`,if(`pwddate` IS NULL OR ({$time}-`pwddate`)>30*24*60*60,1,0) as `chg_pawd`";
                if($is4pwd == "N") {
                    //$where = "((`name`='{$user}' AND `loginname` IS NULL) OR `loginname`='{$user}')";
                    $md5pwd = md5Pwd($pwd);
                    $where = "((`name`='{$user}' AND `loginname` IS NULL) AND `passwd`='{$md5pwd}')";
                    $decide=$this->dbc->select("SELECT `id` FROM {$this->utable} WHERE {$where}",'Row');
                    if(!$decide){
                        $where = "`loginname`='{$user}'";
                    }
                }else{//简易密码登陆
                    $where = "`passcodeMD5`='{$keycode}'";
                }
                $type_name = "会员";
                break;
            default:
                $this->arr["status"] = "error";
                $this->arr[$this->status_code] = "4X001";
                return $this->arr;
                break;

        }

        $logtable = $this->tables[$this->login_layer]["t_login_log"];
        //print_r("SELECT {$filed} FROM {$this->utable} WHERE {$where}");exit;
        $rs = $this->dbc->select("SELECT {$filed} FROM {$this->utable} WHERE {$where}",'Row');
        //print_r($rs);exit;        
        if(!$rs){
            $this->arr["status"] = "error";
            if($this->login_layer == Constant::MEM){
                $this->arr["msg"] = 105;
                $this->arr[$this->status_code] = $this->ls_code_ary["login_error"];
            } else {
                $this->arr[$this->status_code] = "4X005";
            }
            return $this->arr;
        }

        if(strlen($rs["nid"])>16) {
            //查询公司所绑定的域名是否匹配
            $ad_nid = $this->login_layer == Constant::AD ? $rs["nid"] : sup_nid(Constant::AD, $rs["nid"]);
            $add = $this->dbc->select("SELECT `seturl` FROM ".Constant::T_ADMIN." WHERE `nid`='{$ad_nid}' AND `isMaster`=0","Row");
            $url = $add["seturl"];
            if(!empty($url) && strtoupper($url)!="ALL"){
                if(strpos($url,$domain)===false){
                    $this->arr["status"] = "error1";
                    $this->arr[$this->status_code] = "4X005";
                    return $this->arr;
                }
            }
        }

        if($is4pwd == "N") {
            $md5pwd = md5Pwd($pwd);
            if ($md5pwd != $rs["passwd"]) {
                if ($rs["bandate"] > $time) { //禁止时间
                    $this->arr["status"] = "error";
                    if ($this->login_layer == Constant::MEM) {
                        $this->arr["msg"] = 101;
                        $this->arr[$this->status_code] = $this->ls_code_ary["4X004"];
                    } else {
                        $this->arr[$this->status_code] = "4X004";
                    }
                    return $this->arr;
                }

                $set = "";
                $errnum = $rs["errnum"] + 1;//当天错误次数
                if ($errnum == 11) {
                    $bandate = $time + 24 * 60 * 60;
                    $set = ",`bandate`={$bandate}";
                    $errnum = 0;


                    if (!isset($rs["level"])) {
                        $rs["level"] = 0;
                    }

                    if (isset($rs["isMaster"])) {
                        if ($rs["isMaster"] == 1) {//子账号
                            $sup = $this->getNidMaster($rs["nid"]);//查询主账号
                            $type_name .= "[主:{$sup["name"]}][子:{$rs["name"]}]";
                        }
                    }

                    $stop = Constant::T_STOP_ERROR_LOG;
                    $inserts = [
                        "name" => $rs["name"],
                        "level" => $rs["level"],
                        "type" => $type_name,
                        "content" => '当天密码错误超过10次',
                        "adddate" => $time
                    ];
                    $this->dbc->insert($stop, $inserts);
                }

                $updates = [];
                if (date("Y-m-d", $rs["bandate"]) < date("Y-m-d")) {//不是当天日期
                    $bandate = $time;
                    $updates["bandate"] = $bandate;
                    $errnum = 1;
                }
                $updates["errnum"] = $errnum;
                $this->dbc->update($this->utable, $updates, "`id`={$rs["id"]}");
                $this->arr["status"] = "error";
                if ($this->login_layer == Constant::MEM) {
                    $this->arr["msg"] = 105;
                    $this->arr[$this->status_code] = $this->ls_code_ary["login_error"];
                } else {
                    $this->arr[$this->status_code] = "4X005";
                }
                return $this->arr;
            }
        }else{
            $pwd = $rs["pw"];
            $user = $rs["loginname"];
        }

        $status = $this->getAccountStatus($rs["nid"]);
        switch($status){
            case 2:
                $this->arr["status"] = "error";
                if($this->login_layer == Constant::MEM){
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["4X002"];
                } else {
                    $this->arr[$this->status_code] = "4X002";
                }
                return $this->arr;
            case 4:
                $this->arr["status"] = "error";
                if($this->login_layer == Constant::MEM){
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["4X003"];
                } else {
                    $this->arr[$this->status_code] = "4X003";
                }
                return $this->arr;
            case 5:
                $this->arr["status"] = "error";
                if($this->login_layer == Constant::MEM){
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["4X035"];
                } else {
                    $this->arr[$this->status_code] = "4X035";
                }
                return $this->arr;
        }


        $t_ip = $rs['setloginip'];
        $ip = "";
        $url = $_SERVER['HTTP_HOST'];
        if($this->login_layer == "mem" && !empty($rs["setip"])){
            $ip = $rs["setip"];
            $url = $rs["seturl"];
        }
        $ips = getIP($ip);
        $client_ip = $ips["ip"];
        $ClientSity = $ips["sity"];


        if(!$client_ip){$client_ip='127.0.0.1';}


        if(!empty($t_ip)){//固定IP登陆
            $bool_ip = false;
            $arr_ip = explode(',', $t_ip);
            foreach ($arr_ip as $k => $v) {
                if (strpos('=' . $client_ip, $v)) {
                    $bool_ip = true;
                    break;
                }
            }
            if (!$bool_ip) {
                $this->arr["status"] = "error";
                if($this->login_layer == Constant::MEM){
                    $this->arr["msg"] = 101;
                    $this->arr[$this->status_code] = $this->ls_code_ary["4X001"];
                } else {
                    $this->arr[$this->status_code] = "4X001";
                }
                return $this->arr;
            };
        }

        $sqlArr =  [];
        //生成UID
        $uid = md5($time . rand(0, 99999) . $user) . md5($time . rand(0, 99999) . $pwd);
        if($this->login_layer == Constant::MEM){
            $sqlArr[] = "update {$this->utable} set `uid`='{$uid}',`loginip`='{$client_ip}',`logurl`='{$url}',`logindate`='{$time}',`lastdate`='{$time}',`isout`=1 where `id`={$rs['id']}";
        }else{
            $sqlArr[] = "update {$this->utable} set `uid`='{$uid}',`loginip`='{$client_ip}',`logindate`='{$time}',`lastdate`='{$time}',`isout`=1 where `id`={$rs['id']}";
        }
        // $sqlArr[] = "update {$this->utable} set `uid`='{$uid}',`loginip`='{$client_ip}',`logindate`='{$time}',`lastdate`='{$time}',`isout`=1 where `id`={$rs['id']}";
        $isMaster = !isset($rs["isMaster"]) ? "0" : $rs["isMaster"];
        $subid = 0;
        $gid = $rs['id'];
        if($this->login_layer == Constant::MEM){
            $this->arr["status"] = 200;
            $this->arr["username"] = $rs["name"];
            $this->arr["mid"] = $rs["id"];
            $this->arr["passwd_safe"] = $rs["loginname"];
            $this->arr["ltype"] = array_search($rs["ltype"],$ltypes);
            $this->arr["currency"] = $rs["currency"];
            $this->arr["odd_f"] = "H,M,I,E";
            $this->arr["pay_type"] = $rs["pay_type"];
            $this->arr["t_link"] = "BAD";
            $this->arr["uid"] = $uid;
            if($rs["pay_type"]!=1) {//额度校验 信用账号
                $this->chg_member_credit($rs);
            }
            //写入日志
            $sqlArr[] = "INSERT INTO {$logtable} (`gid`,`nid`,`logintime`,`loginip`,`loginurl`,`ip_address`)VALUES('{$gid}','{$rs["nid"]}','{$time}','{$client_ip}','{$url}','{$ClientSity}')";

        } else {
            $user_type = 3;//其他类型账号
            if($isMaster == 0){//主账号
                $user_type = 1;
            }else{
                $user_type = 2;
            }

            $this->arr["enable"] = status_num_str(2,$rs["status"]);
            $this->arr["uid"] = $uid;
            $this->arr["user_id"] =  $rs["id"];
            $this->arr["user_type"] = $user_type;
            $this->arr["username"] = $rs["name"];
            $this->arr["login_layer"] = lv_nid($rs["nid"])["lv"];

            $this->arr["pay_type"] = empty($rs["pay_type"]) ? 0 : 1;
            $this->arr["enable_pri"] = status_num_str(2,$rs["status"]);
            $this->arr["enable"] = $this->arr["enable_pri"];
            $this->arr["layer_id"] = $rs["id"];
            $this->arr["layer_username"] = $rs["name"];
            $this->arr["pri_type"] = $rs["pri"];
			$this->arr["retrieve_sw"] = "Y";
			$this->arr["telbot_sw"] = "Y";

            if($isMaster == 1){//非主账号
                $layer = $this->getNidMaster($rs["nid"]);
                $this->arr["enable_pri"] = status_num_str(2,$layer["status"]);
                $this->arr["enable"] = $this->arr["enable_pri"];
                $this->arr["layer_id"] = $layer["id"];
                $this->arr["layer_username"] = $layer["name"];
                $this->arr["pay_type"] = empty($layer["pay_type"]) ? 0 : 1;
                $gid = $layer["id"];
                $subid = $rs['id'];
            }
            //写入日志
            $sqlArr[] = "INSERT INTO {$logtable} (`gid`,`sub_id`,`nid`,`logintime`,`loginip`,`loginurl`,`ip_address`,`isMaster`)VALUES('{$gid}','{$subid}','{$rs["nid"]}','{$time}','{$client_ip}','{$url}','{$ClientSity}',{$isMaster})";

        }



        //通过事务日志执行SQL组
        $res = $this->dbc->execTransaction($sqlArr);
        if($res["status"]=="error"){
            $this->arr["status"] = "error";
            if($this->login_layer == Constant::MEM){
                $this->arr["msg"] = 101;
            }
            $this->arr[$this->status_code] = $res["msg"];
        }

        $aa = [Constant::CO,Constant::SU,Constant::AG,Constant::MEM];//需要另外检验的管理
        //第一次登陆需要修改安全码或者登陆账号
        if(in_array($this->login_layer,$aa)){
            if($this->login_layer == Constant::CO || $this->login_layer == Constant::SU){
                $pwd_safe = $rs['pwd_safe'];
            }else{
                $pwd_safe = $rs['loginname'];
            }

            if(empty($pwd_safe)){
                if($this->login_layer == Constant::MEM){
                    $this->arr["msg"] = 104;
                    $this->arr["passwd_safe"] = $rs["name"];
                    return $this->arr;
                }
            }
        }

        if(isset($rs['chg_pawd']) && $rs['chg_pawd']==1 && (in_array($this->login_layer,$aa) || $this->login_layer == Constant::D0)){
            if($this->login_layer == Constant::MEM){
                $this->arr["msg"] = 106;
            } else {
                $this->arr[$this->status_code] = "4O007";
            }
            return $this->arr;
        }
        return $this->arr;
    }

    /**
     * 修改密码
     * @return int[]
     */
    public function chg_pwd(){
        $arr = [
            "code" =>"412"
        ];

        if(empty($this->param["new_pwd"])){
            $arr["status"] = "error";
            $arr[$this->status_code] = "0X001";
            return $arr;
        }

        if(!regexPwd($this->param["new_pwd"])){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X021";
            return $arr;
        }

        $user = $this->getUID();
        if(!$user){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X014";
            return $arr;
        }

        if($user["passwd"] != md5Pwd($this->param["old_pwd"])){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X018";
            return $arr;
        }

        $pwd = md5Pwd($this->param["new_pwd"]);
        if($user["passwd"] == $pwd){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X019";
            return $arr;
        }

        if($user["name"] == $this->param["new_pwd"]){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X022";
            return $arr;
        }

        $aa = [Constant::CO,Constant::SU];//检验安全码
        $bb = [Constant::AG,Constant::MEM];//验证登陆账号
        if(in_array($this->login_layer,$aa)){
            if($user["pwd_safe"] == $this->param["new_pwd"]){
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X023";
                return $arr;
            }
        }

        if(in_array($this->login_layer,$bb)){
            if($user["loginname"] == $this->param["new_pwd"]){
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X022";
                return $arr;
            }
        }

        try{
            $update = [
                "passwd" => $pwd,
                "pwddate" => time()
            ];
            $this->dbc->update($this->utable,$update,"`id`={$user["id"]}");
            $this->insertLog("修改密码成功！");
            $arr["status"] = "success";
            $arr[$this->status_code] = "none";
        }catch (\Exception $e){
            $arr["status"] = "error";
            $arr[$this->status_code] = $e->getMessage();
        }

        return $arr;
    }

    /**
     * 修改登陆账号/安全码
     * @return string[]
     */
    public function chg_pwd_safe(){
        $aa = [Constant::CO,Constant::SU];//检验安全码
        $bb = [Constant::AG,Constant::MEM];//验证登陆账号
        $arr = [
            "code" =>"410"
        ];

        if (empty($this->param["pwd_safe"])) {
            $arr["status"] = "error";
            $arr[$this->status_code] = "0X001";
            return $arr;
        }
        $pwd_safe = $this->param["pwd_safe"];
        $user = $this->getUID();
        if(!$user){
            $arr["status"] = "error";
            $arr[$this->status_code] = "4X014";
            return $arr;
        }

        if(in_array($this->login_layer,$bb)) {//验证登陆账号
            if (!regexUser($pwd_safe)) {
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X011_ag";
                return $arr;
            }

            if($pwd_safe == $user["name"]){
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X015_ag";
                return $arr;
            }

            $cou = $this->dbc->getCount($this->utable,"`id`","`name`='{$pwd_safe}' OR `loginname`='{$pwd_safe}'");
            if($cou>0){
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X016";
                return $arr;
            }

            $stmt = $this->dbc->update($this->utable,["loginname"=>$pwd_safe],"`id`={$user["id"]}");
            if($stmt>0){
                $arr["action"] = $this->param["action"];
                $arr["status"] = "success";
                $arr[$this->status_code] = "4O003";
                $this->insertLog("设置登陆账号成功！");
                return $arr;
            }else{
                $arr["status"] = "error";
                $arr[$this->status_code] = "0X002";
                return $arr;
            }
        }

        if(in_array($this->login_layer,$aa)) {//检验安全码
            if (!regexUser($this->param["pwd_safe"])) {
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X011";
                return $arr;
            }

            if(!empty($user["pwd_safe"])){
                $arr["status"] = "error";
                $arr[$this->status_code] = "4X017";
                return $arr;
            }

            $stmt = $this->dbc->update($this->utable,["pwd_safe"=>$pwd_safe],"`id`={$user["id"]}");
            if($stmt>0){
                $arr["action"] = $this->param["action"];
                $arr["status"] = "success";
                $arr[$this->status_code] = "4O000";
                $this->insertLog("设置安全码成功！");
                return $arr;
            }else{
                $arr["status"] = "error";
                $arr[$this->status_code] = "0X002";
                return $arr;
            }
        }
    }

    /**
     * 修改登陆账号 检查按钮
     * @return string
     */
    public function loginID_chk(){
        $username = isset($this->param["username"]) ? $this->param["username"] : "";
        $pwd_safe = isset($this->param["pwd_safe"]) ? $this->param["pwd_safe"] : "";
        if(empty($username) || empty($pwd_safe)){
            return "NO";
        }

        if($username == $pwd_safe){
            return "SAME";
        }

        if(!regexUser($pwd_safe)){
            return "NO";
        }

        $cou = $this->dbc->getCount($this->utable,"`id`","`name`='{$pwd_safe}' OR `loginname`='{$pwd_safe}'");
        if($cou>0){
            return "NO";
        }

        return "YES";
    }


    public function get_pwd_recovery(){
        $p = $this->param;
        $table = $this->tables[$this->login_layer]["t"];
        $arr = [];
        switch ($p["action"]){
            case "init":
                if(empty($this->user["email"])){
                    return ["msg"=>"error","code"=>"4X007"];
                }
                $arr = [
                    "msg"  => "success",
                    "code" => $this->user["email"]
                ];
                break;
            case "regEmail":
                if(!isset($p["email"]) || empty($p["email"])){
                    return ["msg"=>"error","code"=>"0X001"];
                }

                if(strlen($p["email"])>100){
                    return ["msg"=>"error","code"=>"0X001"];
                }
                $code = unserialize(IS_NORMAL);
                if($code["code"] == 2){
                    return ["msg"=>"error","code"=>"4X009"];
                }

                try{
                    $this->dbc->update($table,["email"=>$p["email"]],"`id`='{$this->user["id"]}'");
                    $arr = ["msg"=>"success","code"=>"4O005"];
                }catch (\Exception $e){
                    return ["msg"=>"error","code"=>$e->getMessage()];
                }
                break;
            case "sendVerify":
                if(!isset($p["verCode"]) || empty($p["verCode"])){
                    return ["msg"=>"error","code"=>"4X030"];
                }
                $code = unserialize(IS_NORMAL);
                if($code["code"] == 2){
                    return ["msg"=>"error","code"=>"4X009"];
                }

                try{
                    $forget = Constant::T_FORGET;
                    $insert = [
                        "name" => $this->user["name"],
                        "nid"  => $this->sup["nid"],
                        "content" => $p["verCode"],
                        "adddate" => time()
                    ];
                    $this->dbc->insert($forget,$insert);
                    $arr = ["msg"=>"success","code"=>"4O006"];
                }catch (\Exception $e){
                    return ["msg"=>"error","code"=>$e->getMessage()];
                }
                break;
        }

        return $arr;
    }

    public function get_chg_pwd_inside(){
        $p = $this->param;
        $arr = [];
        switch ($p["action"]){
            case "chgPwd":
                if(!isset($p["old_pwd"]) || empty($p["old_pwd"]) || !regexPwd($p["old_pwd"])){
                    return ["msg"=>"error","code"=>"4X018"];
                }

                if(md5Pwd($p["old_pwd"])!=$this->user["passwd"]){
                    return ["msg"=>"error","code"=>"4X018"];
                }

                if(!isset($p["new_pwd"]) || empty($p["new_pwd"]) || !regexPwd($p["new_pwd"])){
                    return ["msg"=>"error","code"=>"4X021"];
                }

                if(md5Pwd($p["new_pwd"])==$this->user["passwd"]){
                    return ["msg"=>"error","code"=>"4X019"];
                }

                if(isset($this->user["pwd_safe"]) && !empty($this->user["pwd_safe"]) && $p["new_pwd"]==$this->user["pwd_safe"]){
                    return ["msg"=>"error","code"=>"4X022"];
                }

                if($p["new_pwd"]==$this->user["name"]){
                    return ["msg"=>"error","code"=>"4X022"];
                }

                if(isset($this->user["loginname"]) && !empty($this->user["loginname"]) && $p["new_pwd"]==$this->user["loginname"]){
                    return ["msg"=>"error","code"=>"4X022"];
                }


                try{
                    $table = $this->tables[$this->login_layer]["t"];
                    $up = [
                        "passwd" => md5Pwd($p["new_pwd"]),
                        "pwddate" =>time(),
                        "pw" => $p["new_pwd"]
                    ];
                    $this->dbc->update($table,$up,"`id`={$this->user["id"]}");
                    $this->insertLog($this->user["id"],"修改密码成功！");
                    $arr = ["msg"=>"success","code"=>"none"];
                }catch (\Exception $e){
                    return ["msg"=>"error","code"=>$e->getMessage()];
                }
                break;
        }

        return $arr;
    }

    /**
     * 调试时，写入文件
     */
    public function addMyfile($txt='空白',$prefix='newfile',$time=null)
    {
        //$fileName = $prefix."_".time().".txt";
        $time = $time ? "_".time() : "";
        $fileName = $prefix.$time.".log";
        $myfile = fopen($fileName, "w") or die("Unable to open file!");
        if(is_array($txt)){
            $txt = json_encode($txt);
        }
        fwrite($myfile, $txt);
        fclose($myfile);
    }
}