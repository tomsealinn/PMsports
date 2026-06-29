<?php


class OverView extends Base
{
    private $betTable = "";
    private $betTable_p3 = "";
    private $adTable = "";
    private $rankTable = "";
    private $memTable = "";
    private $gAry = [];
    private $isHgid = ["FT","BS","OP"];//有上半id
    private $ks = [
        "early",//早盘
        "inplay",//滚球
        "outright",//冠军
        "parlay",//过关
        "started",//已开赛
        "today"//今日
    ];

    public function __construct($_p = [])
    {
        parent::__construct($_p);
        global $gtypes;
        $this->betTable = Constant::T_BET;
        $this->betTable_p3 = Constant::T_BET_P3;
        $this->adTable = Constant::T_ADMIN;
        $this->rankTable = Constant::T_RANK;
        $this->memTable  = Constant::T_MEMBER;
        $this->gAry = array_keys($gtypes);

    }

    /**
     * 账号统计
     * @return array
     */
    public function get_wagers_account(){
        global $ls_game_ary;
        $log = $this->over_view_log();
        $log.= "->注单统计";
        $this->insertLog($log);
        $smn = $this->son_nid_manger();
        $gid = $this->param["gid"];
        $_gtype = $gtype = strtoupper($this->param["gtype"]);
        $down_id = isset($this->param["down_id"]) ? strtoupper($this->param["down_id"]) : "ALL";
        $gold = isset($this->param["gold"]) ? $this->param["gold"] : 0;
        $acc_id = $this->param["acc_id"];
        $layer = $this->param["layer"];

        $where = "`b`.`hidden`=0 AND `b`.`gid`='{$gid}'  AND `b`.`bet_golds`>={$gold} ";
        $wtype = strtoupper($this->param["wtype"]);
        if($wtype != "MATCH"){
            $gs = ["FT","OP","BS"];
            if(!in_array($wtype,$gs)){
                $aa = ["_0","_1","_2","_3","_4","_5","_6","_7","_8","_9"];
                $wtype = str_replace($aa,'',$wtype);
                switch ($gtype){
                    case "BK":
                        $rpds = ["RPDC","RPDH"];
                        $pds = ["PDC","PDH"];
                        if(in_array($wtype,$pds)){
                            $wtype = "PD";
                        }

                        if(in_array($wtype,$rpds)){
                            $wtype = "RPD";
                        }
                        break;
                }
            }
            $rtype = strtoupper($this->param["rtype"]);

            $where.= " AND `b`.`rtype`='{$rtype}'";
            if($gtype != "FS"){
                $where.= " AND `b`.`gtype`='{$gtype}' AND `b`.`wtype`='{$wtype}'";
            }else{
                $where.= " AND `b`.`wtype`='FS'";
            }
        }



        if($down_id != "ALL") {
            $ds = explode(",",$down_id);
            $wid = "`id`={$down_id}";
            if(count($ds)>1){
                $wid = "`id` IN ({$down_id})";
            }
            switch ($this->login_layer) {
                case Constant::ADS:
                    $table = Constant::T_ADMIN;
                    if(count($ds)>1){
                        $ad = $this->dbc->select("SELECT `nid` FROM {$table} WHERE {$wid} AND {$where} AND `level`=1 AND `isMaster`=0");
                        if($ad){
                            $where .= " AND (";
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.= "`b`.`nid` LIKE '{$ad["nid"]}%' OR ";
                            }
                            $vv = rtrim($vv,"OR");
                            $where.= "{$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `nid` FROM {$table} WHERE {$wid} AND {$where} AND `level`=1 AND `isMaster`=0","Row");
                        if($ad){
                            $where .= " AND `b`.`nid` LIKE '{$ad["nid"]}%'";
                        }
                    }

                    break;
                case Constant::AG:
                    $table = Constant::T_MEMBER;
                    if(count($ds)>1) {
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where}");
                        if ($ad) {
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.= "'{$ad["name"]}',";
                            }
                            $vv = rtrim($vv,",");
                            $where .= " AND `b`.`m_name` IN ({$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where}","Row");
                        if ($ad) {
                            $where .= " AND `b`.`m_name`='{$ad["name"]}%'";
                        }
                    }
                    break;
                default:
                    $where1 = $where." AND `isMaster`=0";
                    $name = '`M_name`';
                    switch ($this->login_layer){
                        case Constant::AD:
                            $where1.= " AND `level`=4";
                            $name = '`d0_name`';
                            break;
                        case Constant::D0:
                            $where1.= " AND `level`=3";
                            $name = '`co_name`';
                            break;
                        case Constant::CO:
                            $where1.= " AND `level`=2";
                            $name = '`su_name`';
                            break;
                        case Constant::SU:
                            $where1.= " AND `level`=1";
                            $name = '`ag_name`';
                            break;
                    }
                    $table = Constant::T_RANK;
                    if(count($ds)>1) {
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where1} ");

                        if ($ad) {
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.="'{$v["name"]}',";
                            }
                            $vv = rtrim($vv,",");
                            $where .= " AND `b`.{$name} IN ({$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where1} ","Row");
                        if ($ad) {
                            $where .= " AND `b`.{$name}='{$ad["name"]}'";
                        }
                    }
                    break;
            }
        }

        if(is_numeric($acc_id) && $acc_id>0 && $layer!=Constant::ADS){
            switch ($layer){
                case Constant::AD:
                    $ad = $this->dbc->select("SELECT `nid` FROM {$this->adTable} WHERE `level`=1 AND `isMaster`=0 AND `id`={$acc_id}","Row");
                    $where.= " AND `b`.`nid` LIKE '{$ad["nid"]}_%'";
                    break;
                case Constant::MEM:
                    $mem = $this->dbc->select("SELECT `name` FROM {$this->memTable} WHERE `id`={$acc_id}","Row");
                    $where.= " AND `b`.`m_name`='{$mem["name"]}'";
                    break;
                default:
                    $level = 1;
                    $name = '`ag_name`';
                    switch ($layer){
                        case Constant::D0:
                            $level = 4;
                            $name = '`d0_name`';
                            break;
                        case Constant::CO:
                            $level = 3;
                            $name = '`co_name`';
                            break;
                        case Constant::SU:
                            $level = 2;
                            $name = '`su_name`';
                            break;
                        case Constant::AG:
                            $level = 1;
                            $name = '`ag_name`';
                            break;
                    }
                    $rk = $this->dbc->select("SELECT `name` FROM {$this->rankTable} WHERE {$level} AND `isMaster`=0 AND `id`={$acc_id}","Row");
                    $where.= " AND `b`.{$name}='{$rk["name"]}'";
                    break;
            }
        }

        $name = "";
        $sub_layer = "";
        $accTable = Constant::T_RANK;
        switch ($layer){
            case Constant::ADS:
                $name = "`d0_name`";
                $sub_layer = Constant::AD;
                $d = "adid";
                $du = "ad_user";
                $sd = "adsid";
                break;
            case Constant::AD:
                $name = "`d0_name`";
                $sub_layer = Constant::D0;
                $d = "did";
                $du = "d0_user";
                $sd = "adid";
                break;
            case Constant::D0:
                $name = "`co_name`";
                $sub_layer = Constant::CO;
                $d = "cid";
                $du = "co_user";
                $sd = "did";
                break;
            case Constant::CO:
                $name = "`su_name`";
                $sub_layer = Constant::SU;
                $d = "sid";
                $du = "su_user";
                $sd = "cid";
                break;
            case Constant::SU:
                $name = "`ag_name`";
                $sub_layer = Constant::AG;
                $d = "aid";
                $du = "ag_user";
                $sd = "sid";
                break;
            case Constant::AG:
                $name = "`m_name`";
                $accTable = Constant::T_MEMBER;
                $sub_layer = Constant::MEM;
                $d = "mid";
                $du = "mem_user";
                $sd = "aid";
                break;

        }

        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css="_tw";
                break;
            case "en-us":
                $css="_en";
                break;
        }
        $ary = [
            "status" => "666",
            "layer"  => $sub_layer,
            "subData"=> [],
            "SCOUNT" => 0,
            "SGOLD0" => 0,
            "wagersWtype" => "",
            "wagersRtype" => "",
            "type" => "",
            "gtype" => $gtype
        ];
        $field= "`b`.*,COUNT(`b`.`ID`) AS `COUNT`,SUM(`b`.`bet_golds`) AS `GOLD0`,`b`.{$name} AS `name`,`a`.`id`,`a`.`alias`,`b`.`nid`";
        if($wtype == "MATCH"){
            $ary["SVGOLD0"] = 0;
            $ary["SWIN_GOLD0"] = 0;
            $field.= ",SUM(IF(`b`.`isResult`=1,`b`.`valid_gold`,0)) AS `VGOLD0`,SUM(IF(`b`.`isResult`=1,`b`.`mem_result`,0)) AS `WIN_GOLD0`";
        }
//print_r("SELECT {$field} FROM {$this->betTable} AS `b` JOIN {$accTable} AS `a` ON `a`.`name` = `b`.{$name} WHERE {$where} AND `nid` LIKE '{$this->sup["nid"]}%' GROUP BY `b`.{$name}");exit;
        $bet = $this->dbc->select("SELECT {$field} FROM {$this->betTable} AS `b` JOIN {$accTable} AS `a` ON `a`.`name` = `b`.{$name} WHERE {$where} AND `a`.`nid` LIKE '{$this->sup["nid"]}%' GROUP BY `b`.{$name}");

        if($bet) {
            $bs = new Bet($this->param);
            $xml = $bs->get_bet_wagers($bet[0],"N",'',"Y");
            if($_gtype == "FS"){ //球员进球
                $league = $bet[0]["league{$css}"];
                $les = explode(" - ",$league);
                $ary["wagersWtype"] = str_replace($les[0]." - ","",$league);
            }else{
                $ary["wagersWtype"] = getXmlNode($xml,"wtype");
            }

            $ary["wagersRtype"] = getXmlNode($xml,"result");
            $ary["type"] = $bet[0]["chose_team"];
            switch ($layer){
                case Constant::ADS:
                    $arr = [];
                    foreach ($bet as $v){
                        $isOK = "N";
                        if($smn === false){
                            $isOK = "Y";
                        }else{
                            $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                            if(in_array($nid,$smn)){
                                $isOK = "Y";
                            }
                        }
                        if($isOK == "Y") {
                            $nid = sup_nid(Constant::AD, $v["nid"]);
                            $ad = $this->dbc->select("SELECT `id`,`name`,`alias` FROM {$this->adTable} WHERE `nid`='{$nid}' AND `isMaster`=0", "Row");
                            if (!isset($arr[$nid])) {
                                $arr[$nid] = [
                                    "ID0" => $ad["id"],
                                    "NAME0" => $ad["name"],
                                    "ALIAS0" => $ad["alias"],
                                    "COUNT" => 0,
                                    "GOLD0" => 0,
                                    "ACTION0" => "adid={$ad["id"]}&ad_user={$ad["name"]}",
                                    "UPPER0" => "adsid={$this->sup["id"]}"
                                ];
                                if ($wtype == "MATCH") {
                                    $arr[$nid]["VGOLD0"] = 0;
                                    $arr[$nid]["WIN_GOLD0"] = 0;
                                }
                            }

                            $arr[$nid]["COUNT"] += $v["COUNT"];
                            $arr[$nid]["GOLD0"] += $v["GOLD0"];

                            $ary["SCOUNT"] += $v["COUNT"];
                            $ary["SGOLD0"] += $v["GOLD0"];

                            if ($wtype == "MATCH") {
                                $arr[$nid]["VGOLD0"] += $v["VGOLD0"];
                                $arr[$nid]["WIN_GOLD0"] += $v["WIN_GOLD0"];
                                $ary["SVGOLD0"] += $v["VGOLD0"];
                                $ary["SWIN_GOLD0"] += $v["WIN_GOLD0"];
                            }
                        }

                    }

                    $ary["subData"] = array_values($arr);
                    break;
                default:
                    $arr = [];
                    foreach ($bet as $v){
                        $isOK = "N";
                        if($smn === false){
                            $isOK = "Y";
                        }else{
                            $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                            if(in_array($nid,$smn)){
                                $isOK = "Y";
                            }
                        }

                        if($isOK == "Y") {
                            if (!isset($arr[$v["name"]])) {
                                $arr[$v["name"]] = [
                                    "ID0" => $v["id"],
                                    "NAME0" => $v["name"],
                                    "ALIAS0" => $v["alias"],
                                    "COUNT" => 0,
                                    "GOLD0" => 0,
                                    "ACTION0" => "{$d}={$v["id"]}&{$du}={$v["name"]}",
                                    "UPPER0" => "{$sd}={$acc_id}"
                                ];
                                if ($wtype == "MATCH") {
                                    $arr[$v["name"]]["VGOLD0"] = 0;
                                    $arr[$v["name"]]["WIN_GOLD0"] = 0;
                                }
                            }

                            $arr[$v["name"]]["COUNT"] += $v["COUNT"];
                            $arr[$v["name"]]["GOLD0"] += $v["GOLD0"];

                            $ary["SCOUNT"] += $v["COUNT"];
                            $ary["SGOLD0"] += $v["GOLD0"];

                            if ($wtype == "MATCH") {
                                $arr[$v["name"]]["VGOLD0"] += $v["VGOLD0"];
                                $arr[$v["name"]]["WIN_GOLD0"] += $v["WIN_GOLD0"];
                                $ary["SVGOLD0"] += $v["VGOLD0"];
                                $ary["SWIN_GOLD0"] += $v["WIN_GOLD0"];
                            }
                        }
                    }
                    $ary["subData"] = array_values($arr);
                    break;
            }

        }
        return $ary;
    }

    /**
     * 根据赛事显示注单
     * @return array|string[]
     */
    public function get_allbet_wager(){
        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $smn = $this->son_nid_manger();
        $log = $this->over_view_log();
        $log.= "->赛事页";
        $this->insertLog($log);
        $w_r = new Wtype_Rtype();
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $gtype = strtoupper($this->param["gtype"]);
        $gidm = $this->param["gidm"];
        if($this->param["symbol"] == "match"){
            $where = "`hidden`=0 AND `gtype`='{$gtype}' AND `gidm`='{$gidm}'";
            $field = "`wtype`,`rtype`,`showtype`,`gidm`,`gid`,`ptype{$css}` AS `ptype`,COUNT(`ID`) AS `count`,ROUND(SUM(`bet_golds`),1) AS `gold`";
        }else{
            $point = $this->get_percentage_point();
            $where = "`hidden`=0 AND `gtype`='{$gtype}' AND `gidm`='{$gidm}' AND ";
            $where.= $this->get_where();
            $field = "`wtype`,`rtype`,`showtype`,`gidm`,`gnum_h`,`gid`,`ptype{$css}` AS `ptype`,COUNT(`ID`) AS `count`,ROUND(SUM(`bet_golds`*{$point}/100),1) AS `gold`";
        }

        if($smn === false) {
            $rs = $this->dbc->select("SELECT {$field},`nid` FROM {$this->betTable} WHERE {$where} GROUP BY `gid`,`wtype`,`rtype`");
        }else{
            $rs = $this->dbc->select("SELECT {$field},`nid` FROM {$this->betTable} WHERE {$where} GROUP BY `gid`,`wtype`,`rtype`,`m_name`");
        }
        if(!$rs){ return $ary;}
        $match = $this->get_match($gidm);
        if($match == "no"){ return $ary;}
        $unsetAry = ["team_h","team_c","midfield","live","game_over","game_cancel","cancel_type","lastScore"];
        $arr = [];
        $arr["concede_w3"] = "";
        $arr["league_count"] = 0;
        $arr["league_gold"] = 0;
        $arr["gtype"] = $gtype;
        foreach ($unsetAry as $v){
            $arr[$v] = isset($match[$v]) ? $match[$v] : "";
            unset($match[$v]);
        }
        $arr["is_OT"] = isset($match["is_OT"]) ? $match["is_OT"] : false;unset($match["is_OT"]);
        $arr["m_gid"] = $match["gid"];unset($match["gid"]);
        $arr["league_name"] = $match["league"];unset($match["league"]);
        $arr["session"] = $match;
        $h = [];
        $c = [];

        foreach ($rs as $v){
            switch ($v["wtype"]){
                case "T"://单双处理
                    $eo = ["ODD","EVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "EO";
                    }
                    break;
                case "HT":
                    $eo = ["HODD","HEVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "HEO";
                    }
                    break;
                case "RT":
                    $eo = ["RODD","REVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "REO";
                    }
                    break;
                case "HRT":
                    $eo = ["HRODD","HREVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "HREO";
                    }
                    break;
                case "SP":
                    $pg = ["PGFH","PGFC","PGFN","PGLH","PGLC","PGLN"];//最先/最後進球
                    $os = ["OSFH","OSFC","OSFN","OSLH","OSLC","OSLN"];  //最先/最後越位
                    $st = ["STFH","STFC","STFN","STLH","STLC","STLN"];  //最先/最後替補球員
                    $cn = ["CNFH","CNFC","CNFN","CNLH","CNLC","CNLN"];  //第一顆/最後一顆角球
                    $cd = ["CDFH","CDFC","CDFN","CDLH","CDLC","CDLN"];  //第一張/最後一張卡=>首個/最後罰牌
                    $rc = ["RCFH","RCFC","RCLH","RCLC"];
                    $yc = ["YCFH","YCFC","YCLH","YCLC"];  //第一張/最後一張黃卡
                    $ga = ["GAFH","GAFC","GALH","GALC"];  //有失球/沒有失球

                    if(in_array($v["rtype"],$pg)){
                        $v["wtype"] = "PG";
                    }else if(in_array($v["rtype"],$os)){
                        $v["wtype"] = "OS";
                    }else if(in_array($v["rtype"],$st)){
                        $v["wtype"] = "ST";
                    }else if(in_array($v["rtype"],$cn)){
                        $v["wtype"] = "CN";
                    }else if(in_array($v["rtype"],$cd)){
                        $v["wtype"] = "CD";
                    }else if(in_array($v["rtype"],$rc)){
                        $v["wtype"] = "RC";
                    }else if(in_array($v["rtype"],$yc)){
                        $v["wtype"] = "YC";
                    }else if(in_array($v["rtype"],$ga)){
                        $v["wtype"] = "GA";
                    }
                    break;
                case "MOUA":
                case "MOUB":
                case "MOUC":
                case "MOUD":
                    $v["wtype"] = "MOUALL";
                    break;
                case "RMUA":
                case "RMUB":
                case "RMUC":
                case "RMUD":
                    $v["wtype"] = "RMUALL";
                    break;
                case "DUA":
                case "DUB":
                case "DUC":
                case "DUD":
                    $v["wtype"] = "DUALL";
                    break;
                case "RDUA":
                case "RDUB":
                case "RDUC":
                case "RDUD":
                    $v["wtype"] = "RDUALL";
                    break;
                case "OUEA":
                case "OUEB":
                case "OUEC":
                case "OUED":
                    $v["wtype"] = "OUEALL";
                    break;
                case "RUEA":
                case "RUEB":
                case "RUEC":
                case "RUED":
                    $v["wtype"] = "RUEALL";
                    break;
                case "OUPA":
                case "OUPB":
                case "OUPC":
                case "OUPD":
                    $v["wtype"] = "OUPALL";
                    break;
                case "RUPA":
                case "RUPB":
                case "RUPC":
                case "RUPD":
                    $v["wtype"] = "RUPALL";
                    break;
                case "OUTA":
                case "OUTB":
                case "OUTC":
                case "OUTD":
                    $v["wtype"] = "OUTALL";
                    break;
                case "RUTA":
                case "RUTB":
                case "RUTC":
                case "RUTD":
                    $v["wtype"] = "RUTALL";
                    break;
            }
            if($v["wtype"] == "FS"){
                if(!isset($wtypes[$v["wtype"]])){
                    $wtypes[$v["wtype"]]=[
                        "wtype" => "SFS",
                        "wtype_count" => 0,
                        "wtype_gold" => 0,
                        "onerows" => []
                    ];
                }

                $sfsTable = Constant::S_SP;
                $sfs = $this->dbc->select("SELECT `sfs_id`,`team_id`,`team_tw` AS `team` FROM {$sfsTable} WHERE `gid`='{$v["gid"]}' AND `rtype`='{$v["rtype"]}' AND `gid`='{$v["gid"]}' ","Row");
                $sfsAry = ["H19","H20","H204","C19","C20","C204"];
                $sfsH = ["H19","H20","H204"];
                $key = array_search($sfs["sfs_id"],$sfsAry);
                if(in_array($sfs["sfs_id"],$sfsH)){
                    if(!isset($h[$v["rtype"]])){
                        $h[$v["rtype"]] = [
                            "player_h" => $sfs["team"],
                            "h" => [
                                [
                                    "gid" => $v["gid"]-$key,
                                    "rtype" => "H_19",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-1),
                                    "rtype" => "H_20",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-2),
                                    "rtype" => "H_204",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                            ]
                        ];
                    }
                }else{
                    if(!isset($c[$v["rtype"]])){
                        $c[$v["rtype"]] = [
                            "player_c" => $sfs["team"],
                            "c" => [
                                [
                                    "gid" => $v["gid"]-($key-3),
                                    "rtype" => "C_19",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-4),
                                    "rtype" => "C_20",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-5),
                                    "rtype" => "C_204",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                            ],
                        ];
                    }
                }
                if($smn===false) {
                    switch ($sfs["sfs_id"]) {
                        case "H19":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][0]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][0]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][0]["gold"] = $v["gold"];

                            break;
                        case "H20":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][1]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][1]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][1]["gold"] = $v["gold"];
                            break;
                        case "H204":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][2]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][2]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][2]["gold"] = $v["gold"];
                            break;

                        case "C19":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][0]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][0]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][0]["gold"] = $v["gold"];
                            break;
                        case "C20":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][1]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][1]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][1]["gold"] = $v["gold"];
                            break;
                        case "C204":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][2]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][2]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][2]["gold"] = $v["gold"];
                            break;
                    }

                    $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                    $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                    $arr["league_count"] += $v["count"];
                    $arr["league_gold"] += $v["gold"];
                    $arr["wtype"] = $wtypes;
                }else{
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        switch ($sfs["sfs_id"]) {
                            case "H19":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][0]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][0]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][0]["gold"] = $v["gold"];

                                break;
                            case "H20":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][1]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][1]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][1]["gold"] = $v["gold"];
                                break;
                            case "H204":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][2]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][2]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][2]["gold"] = $v["gold"];
                                break;

                            case "C19":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][0]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][0]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][0]["gold"] = $v["gold"];
                                break;
                            case "C20":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][1]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][1]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][1]["gold"] = $v["gold"];
                                break;
                            case "C204":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][2]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][2]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][2]["gold"] = $v["gold"];
                                break;
                        }
                        $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                        $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                        $arr["league_count"] += $v["count"];
                        $arr["league_gold"] += $v["gold"];

                    }
                }
                $arr["wtype"] = $wtypes;
            } else {
                if($smn === false) {
                    if(!isset($wtypes[$v["wtype"]])){
                        $_wtype = $v["wtype"];
                        switch ($gtype){
                            case "BK":
                                $rts = ["RPD","PD"];
                                $r_bk = $w_r->getBK();
                                if($v["wtype"]=="PD"){
                                    $pdh = $r_bk["r"]["PDH"];
                                    $pdc = $r_bk["r"]["PDC"];
                                    if(in_array($v["rtype"],$pdh)){
                                        $_wtype = "PDH";
                                    }elseif(in_array($v["rtype"],$pdc)){
                                        $_wtype = "PDC";
                                    }
                                }else{
                                    $pdh = $r_bk["RE"]["RPDH"];
                                    $pdc = $r_bk["RE"]["RPDC"];
                                    if(in_array($v["rtype"],$pdh)){
                                        $_wtype = "RPDH";
                                    }elseif(in_array($v["rtype"],$pdc)){
                                        $_wtype = "RPDC";
                                    }
                                }
                                break;
                        }
                        $gs = ["FT","OP","BS"];
                        if(!in_array($gtype,$gs)){
                            if(strlen($v["gnum_h"])==5){
                                $_wtype .= "_0";
                            }else{
                                $fir = substr($v["gnum_h"],0,1);
                                $_wtype .= "_{$fir}";
                            }
                        }
                        $wtypes[$v["wtype"]]=[
                            "wtype" => $_wtype,
                            "wtype_count" => 0,
                            "wtype_gold" => 0,
                            "gid" => []
                        ];
                    }

                    $gids_key = $v["wtype"]."^".$v["gid"];
                    if(!isset($gids[$gids_key])){
                        $gids[$gids_key] = [
                            "gid" => $v["gid"],
                            "ptype" => $v["ptype"],
                            "rtype" => []
                        ];
                    }


                    $rtype_key = $v["wtype"] . "^" . $v["gid"] . "^" . $v["rtype"];
                    if (!isset($rtype[$rtype_key])) {
                        $rtype[$rtype_key] = [
                            "rtype" => $v["rtype"],
                            "count" => $v["count"],
                            "gold" => $v["gold"]
                        ];
                    }

                    $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                    $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                    $arr["league_count"] += $v["count"];
                    $arr["league_gold"] += $v["gold"];
                    $gids[$gids_key]["rtype"][$rtype_key] = $rtype[$rtype_key];
                    $wtypes[$v["wtype"]]["gid"][$gids_key] = $gids[$gids_key];
                    $arr["wtype"][$v["wtype"]] = $wtypes[$v["wtype"]];
                }else{
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        if(!isset($wtypes[$v["wtype"]])){
                            $_wtype = $v["wtype"];
                            switch ($gtype){
                                case "BK":
                                    $rts = ["RPD","PD"];
                                    $r_bk = $w_r->getBK();
                                    if($v["wtype"]=="PD"){
                                        $pdh = $r_bk["r"]["PDH"];
                                        $pdc = $r_bk["r"]["PDC"];
                                        if(in_array($v["rtype"],$pdh)){
                                            $_wtype = "PDH";
                                        }elseif(in_array($v["rtype"],$pdc)){
                                            $_wtype = "PDC";
                                        }
                                    }else{
                                        $pdh = $r_bk["RE"]["RPDH"];
                                        $pdc = $r_bk["RE"]["RPDC"];
                                        if(in_array($v["rtype"],$pdh)){
                                            $_wtype = "RPDH";
                                        }elseif(in_array($v["rtype"],$pdc)){
                                            $_wtype = "RPDC";
                                        }
                                    }
                                    break;
                            }
                            $gs = ["FT","OP","BS"];
                            if(!in_array($gtype,$gs)){
                                if(strlen($v["gnum_h"])==5){
                                    $_wtype .= "_0";
                                }else{
                                    $fir = substr($v["gnum_h"],0,1);
                                    $_wtype .= "_{$fir}";
                                }
                            }
                            $wtypes[$v["wtype"]]=[
                                "wtype" => $_wtype,
                                "wtype_count" => 0,
                                "wtype_gold" => 0,
                                "gid" => []
                            ];
                        }

                        $gids_key = $v["wtype"]."^".$v["gid"];
                        if(!isset($gids[$gids_key])){
                            $gids[$gids_key] = [
                                "gid" => $v["gid"],
                                "ptype" => $v["ptype"],
                                "rtype" => []
                            ];
                        }
                        $rtype_key = $v["wtype"] . "^" . $v["gid"] . "^" . $v["rtype"];
                        if (!isset($rtype[$rtype_key])) {
                            $rtype[$rtype_key] = [
                                "rtype" => $v["rtype"],
                                "count" => $v["count"],
                                "gold" => $v["gold"]
                            ];
                        }

                        $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                        $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                        $arr["league_count"] += $v["count"];
                        $arr["league_gold"] += $v["gold"];
                        $gids[$gids_key]["rtype"][$rtype_key] = $rtype[$rtype_key];
                        $wtypes[$v["wtype"]]["gid"][$gids_key] = $gids[$gids_key];
                        $arr["wtype"][$v["wtype"]] = $wtypes[$v["wtype"]];
                    }
                }


            }

        }
        //print_r((time()-$time)."--");
        foreach ($arr["wtype"] as $k => $v){
            if(isset($v["gid"])) {
                foreach ($v["gid"] as $kk => $vv) {
                    $arr["wtype"][$k]["gid"][$kk]["rtype"] = array_values($arr["wtype"][$k]["gid"][$kk]["rtype"]);
                }
                $arr["wtype"][$k]["gid"] = array_values($arr["wtype"][$k]["gid"]);
            } else if (isset($v["onerows"])){
                $h = array_values($h);
                $c = array_values($c);
                $cou = count($h)>count($c) ? count($h) : count($c);
                $onerows = [];
                for($i=0;$i<$cou;$i++){
                    $hh = [];
                    $cc = [];
                    if(!isset($h[$i])){
                        $cc = $c[$i];
                        $hh = [
                            "player_h" => "",
                            "h" => [
                                [
                                    "gid" => $cc["c"][0]["gid"]-3,
                                    "rtype" => "H_19",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $cc["c"][0]["gid"]-2,
                                    "rtype" => "H_20",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $cc["c"][0]["gid"]-1,
                                    "rtype" => "H_204",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                            ],
                        ];
                    }else{
                        $hh = $h[$i];
                    }

                    if(!isset($c[$i])){
                        $hh = $h[$i];
                        $cc = [
                            "player_c" => "",
                            "c" => [
                                [
                                    "gid" => $hh["h"][0]["gid"]+3,
                                    "rtype" => "C_19",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $hh["h"][0]["gid"]+4,
                                    "rtype" => "C_20",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $hh["h"][0]["gid"]+5,
                                    "rtype" => "C_204",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                            ],
                        ];
                    }else{
                        $cc = $c[$i];
                    }

                    $onerows[] = [
                        "player_h" => $hh["player_h"],
                        "player_c" => $cc["player_c"],
                        "h" => [
                            [
                                "gid" => $hh["h"][0]["gid"],
                                "rtype" => "H_19",
                                "pos" => $hh["h"][0]["pos"],
                                "count" => $hh["h"][0]["count"],
                                "gold" => $hh["h"][0]["gold"]
                            ],
                            [
                                "gid" => $hh["h"][1]["gid"],
                                "rtype" => "H_20",
                                "pos" => $hh["h"][1]["pos"],
                                "count" => $hh["h"][1]["count"],
                                "gold" => $hh["h"][1]["gold"]
                            ],
                            [
                                "gid" => $hh["h"][2]["gid"],
                                "rtype" => "H_204",
                                "pos" => $hh["h"][2]["pos"],
                                "count" => $hh["h"][2]["count"],
                                "gold" => $hh["h"][2]["gold"]
                            ],
                        ],
                        "c" => [
                            [
                                "gid" => $cc["c"][0]["gid"],
                                "rtype" => "C_19",
                                "pos" => $cc["c"][0]["pos"],
                                "count" => $cc["c"][0]["count"],
                                "gold" => $cc["c"][0]["gold"]
                            ],
                            [
                                "gid" => $cc["c"][1]["gid"],
                                "rtype" => "C_20",
                                "pos" => $cc["c"][1]["pos"],
                                "count" => $cc["c"][1]["count"],
                                "gold" => $cc["c"][1]["gold"]
                            ],
                            [
                                "gid" => $cc["c"][2]["gid"],
                                "rtype" => "C_204",
                                "pos" => $cc["c"][2]["pos"],
                                "count" => $cc["c"][2]["count"],
                                "gold" => $cc["c"][2]["gold"]
                            ],
                        ],
                    ];
                }
                $arr["wtype"][$k]["onerows"] = $onerows;
            }

        }
        $arr["wtype"] = array_values($arr["wtype"]);
        //print_r((time()-$time)."--");exit;
        return $arr;
    }

    /**
     * 根据赛事显示注单 - 已开赛
     * @return array|string[]
     */
    public function get_started_allbet_wager(){
        $time1 = time();
        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $w_r = new Wtype_Rtype();
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $gtype = strtoupper($this->param["gtype"]);
        $session = strtoupper($this->param["session"]);
        $market = strtoupper($this->param["market"]);
        $gidm = $this->param["gidm"];
        $smn = $this->son_nid_manger();
        $point = $this->get_percentage_point();
        $where = "`hidden`=0 AND `gtype`='{$gtype}' AND `gidm`='{$gidm}' AND ";
        $where.= $this->get_where();
        $field = "`wtype`,`rtype`,`showtype`,`gidm`,`gnum_h`,`gid`,`ptype{$css}` AS `ptype`,COUNT(`ID`) AS `count`,ROUND(SUM(`bet_golds`*{$point}/100),1) AS `gold`,`nid`";
        //print_r("SELECT {$field} FROM {$this->betTable} WHERE {$where} GROUP BY `gid`,`wtype`,`rtype`");exit;
        if($smn === false){
            $rs = $this->dbc->select("SELECT {$field} FROM {$this->betTable} WHERE {$where} GROUP BY `gid`,`wtype`,`rtype`");
        }else{
            $rs = $this->dbc->select("SELECT {$field} FROM {$this->betTable} WHERE {$where} GROUP BY `gid`,`wtype`,`rtype`,`m_name`");
        }
        if(!$rs){ return $ary;}
        $match = $this->get_match($gidm);
        if($match == "no"){ return $ary;}
        $unsetAry = ["team_h","team_c","midfield","live","game_over","game_cancel","cancel_type","lastScore"];
        $arr = [];
        $arr["concede_w3"] = "";
        $arr["league_count"] = 0;
        $arr["league_gold"] = 0;
        $arr["gtype"] = $gtype;
        foreach ($unsetAry as $v){
            $arr[$v] = isset($match[$v]) ? $match[$v] : "";
            unset($match[$v]);
        }
        $arr["is_OT"] = isset($match["is_OT"]) ? $match["is_OT"] : false;unset($match["is_OT"]);
        $arr["m_gid"] = $match["gid"];unset($match["gid"]);
        $arr["league_name"] = $match["league"];unset($match["league"]);
        $arr["session"] = $match;
        $h = [];
        $c = [];

        $re_wtype = [
            "RE" => 'R',"ROU" => 'OU',"HRE" => 'HR',"HROU" => 'HOU',"RM" => 'M',"HRM" => 'HM',"RT" => 'T',"RF" => 'F',"RPD" => 'PD',
            "HRPD" => 'HPD',"AROU" => 'AOU',"BROU" => 'BOU',"CROU" => 'COU',"DROU" => 'DOU',"EROU" => 'EOU',"FROU" => 'FOU',
            "ARE" => 'AR',"BRE" => 'BR',"CRE" => 'CR',"DRE" => 'DR',"ERE" => 'ER',"FRE" => 'FR',
            "ARM" => 'AM',"BRM" => 'BM', "CRM" => 'CM',"DRM" => 'DM',"ERM" => 'EM',"FRM" => 'FM',
            "HRT" => 'HT',"RWM" => 'WM',"RDC" => 'DC',"RWE" => 'WE',"RWB" => 'WB',"RTS" => 'TS',
            "ROUH" => 'OUH',"ROUC" => 'OUC',"HRUH" => 'HOUH',"HRUC" => 'HOUC',"HREO" => 'HEO',
            "RCS" => 'CS',"RWN" => 'WN',"RHG" => 'HG',"RMG" => 'MG',"RSB" => 'SB',"RT3G" => 'T3G',"RT1G" => 'T1G',
            "ROT" => 'OT',"RMPG" => 'MPG',"RMTS" => 'MTS',"RDG" => 'DG',"RDS" => 'DS',
        ];
        foreach ($rs as $v){
            $wtype1 = $v["wtype"];
            switch ($v["wtype"]){
                case "T"://单双处理
                    $eo = ["ODD","EVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "EO";
                    }
                    break;
                case "HT":
                    $eo = ["HODD","HEVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "HEO";
                    }
                    break;
                case "RT":
                    $eo = ["RODD","REVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "REO";
                    }
                    break;
                case "HRT":
                    $eo = ["HRODD","HREVEN"];
                    if(in_array($v["rtype"],$eo)){
                        $v["wtype"] = "HREO";
                    }
                    break;
                case "SP":
                    $pg = ["PGFH","PGFC","PGFN","PGLH","PGLC","PGLN"];//最先/最後進球
                    $os = ["OSFH","OSFC","OSFN","OSLH","OSLC","OSLN"];  //最先/最後越位
                    $st = ["STFH","STFC","STFN","STLH","STLC","STLN"];  //最先/最後替補球員
                    $cn = ["CNFH","CNFC","CNFN","CNLH","CNLC","CNLN"];  //第一顆/最後一顆角球
                    $cd = ["CDFH","CDFC","CDFN","CDLH","CDLC","CDLN"];  //第一張/最後一張卡=>首個/最後罰牌
                    $rc = ["RCFH","RCFC","RCLH","RCLC"];
                    $yc = ["YCFH","YCFC","YCLH","YCLC"];  //第一張/最後一張黃卡
                    $ga = ["GAFH","GAFC","GALH","GALC"];  //有失球/沒有失球

                    if(in_array($v["rtype"],$pg)){
                        $v["wtype"] = "PG";
                    }else if(in_array($v["rtype"],$os)){
                        $v["wtype"] = "OS";
                    }else if(in_array($v["rtype"],$st)){
                        $v["wtype"] = "ST";
                    }else if(in_array($v["rtype"],$cn)){
                        $v["wtype"] = "CN";
                    }else if(in_array($v["rtype"],$cd)){
                        $v["wtype"] = "CD";
                    }else if(in_array($v["rtype"],$rc)){
                        $v["wtype"] = "RC";
                    }else if(in_array($v["rtype"],$yc)){
                        $v["wtype"] = "YC";
                    }else if(in_array($v["rtype"],$ga)){
                        $v["wtype"] = "GA";
                    }
                    break;
                case "MOUA":
                case "MOUB":
                case "MOUC":
                case "MOUD":
                case "RMUA":
                case "RMUB":
                case "RMUC":
                case "RMUD":
                    $v["wtype"] = "MOUALL";
                    break;
                case "DUA":
                case "DUB":
                case "DUC":
                case "DUD":
                case "RDUA":
                case "RDUB":
                case "RDUC":
                case "RDUD":
                    $v["wtype"] = "DUALL";
                    break;
                case "OUEA":
                case "OUEB":
                case "OUEC":
                case "OUED":
                case "RUEA":
                case "RUEB":
                case "RUEC":
                case "RUED":
                    $v["wtype"] = "OUEALL";
                    break;
                case "OUPA":
                case "OUPB":
                case "OUPC":
                case "OUPD":
                case "RUPA":
                case "RUPB":
                case "RUPC":
                case "RUPD":
                    $v["wtype"] = "OUPALL";
                    break;
                case "OUTA":
                case "OUTB":
                case "OUTC":
                case "OUTD":
                case "RUTA":
                case "RUTB":
                case "RUTC":
                case "RUTD":
                    $v["wtype"] = "OUTALL";
                    break;
                default:
                    $v["wtype"] = isset($re_wtype[$v["wtype"]]) ? $re_wtype[$v["wtype"]] : $v["wtype"];
                    break;
            }
            if($v["wtype"] == "FS"){
                if(!isset($wtypes[$v["wtype"]])){
                    $wtypes[$v["wtype"]]=[
                        "wtype" => "SFS",
                        "wtype_count" => 0,
                        "wtype_gold" => 0,
                        "onerows" => []
                    ];
                }

                $sfsTable = Constant::S_SP;
                $sfs = $this->dbc->select("SELECT `sfs_id`,`team_id`,`team_tw` AS `team` FROM {$sfsTable} WHERE `gid`='{$v["gid"]}' AND `rtype`='{$v["rtype"]}' AND `gid`='{$v["gid"]}' ","Row");
                $sfsAry = ["H19","H20","H204","C19","C20","C204"];
                $sfsH = ["H19","H20","H204"];
                $key = array_search($sfs["sfs_id"],$sfsAry);
                if(in_array($sfs["sfs_id"],$sfsH)){
                    if(!isset($h[$v["rtype"]])){
                        $h[$v["rtype"]] = [
                            "player_h" => $sfs["team"],
                            "h" => [
                                [
                                    "gid" => $v["gid"]-$key,
                                    "rtype" => "H_19",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-1),
                                    "rtype" => "H_20",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-2),
                                    "rtype" => "H_204",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                            ]
                        ];
                    }
                }else{
                    if(!isset($c[$v["rtype"]])){
                        $c[$v["rtype"]] = [
                            "player_c" => $sfs["team"],
                            "c" => [
                                [
                                    "gid" => $v["gid"]-($key-3),
                                    "rtype" => "C_19",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-4),
                                    "rtype" => "C_20",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                                [
                                    "gid" => $v["gid"]-($key-5),
                                    "rtype" => "C_204",
                                    "pos" => "",
                                    "count" => 0,
                                    "gold" => 0
                                ],
                            ],
                        ];
                    }
                }

                if($smn === false) {
                    switch ($sfs["sfs_id"]) {
                        case "H19":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][0]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][0]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][0]["gold"] = $v["gold"];

                            break;
                        case "H20":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][1]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][1]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][1]["gold"] = $v["gold"];
                            break;
                        case "H204":
                            $h[$v["rtype"]]["player_h"] = $sfs["team"];
                            $h[$v["rtype"]]["h"][2]["pos"] = $v["rtype"];
                            $h[$v["rtype"]]["h"][2]["count"] = $v["count"];
                            $h[$v["rtype"]]["h"][2]["gold"] = $v["gold"];
                            break;

                        case "C19":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][0]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][0]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][0]["gold"] = $v["gold"];
                            break;
                        case "C20":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][1]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][1]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][1]["gold"] = $v["gold"];
                            break;
                        case "C204":
                            $c[$v["rtype"]]["player_c"] = $sfs["team"];
                            $c[$v["rtype"]]["c"][2]["pos"] = $v["rtype"];
                            $c[$v["rtype"]]["c"][2]["count"] = $v["count"];
                            $c[$v["rtype"]]["c"][2]["gold"] = $v["gold"];
                            break;
                    }
                    $wtypes[$v["wtype"]]["wtype_count"]+= $v["count"];
                    $wtypes[$v["wtype"]]["wtype_gold"]+= $v["gold"];
                    $arr["league_count"]+= $v["count"];
                    $arr["league_gold"]+= $v["gold"];
                }else{ //子账号管理下线
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        switch ($sfs["sfs_id"]) {
                            case "H19":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][0]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][0]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][0]["gold"] = $v["gold"];

                                break;
                            case "H20":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][1]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][1]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][1]["gold"] = $v["gold"];
                                break;
                            case "H204":
                                $h[$v["rtype"]]["player_h"] = $sfs["team"];
                                $h[$v["rtype"]]["h"][2]["pos"] = $v["rtype"];
                                $h[$v["rtype"]]["h"][2]["count"] = $v["count"];
                                $h[$v["rtype"]]["h"][2]["gold"] = $v["gold"];
                                break;

                            case "C19":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][0]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][0]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][0]["gold"] = $v["gold"];
                                break;
                            case "C20":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][1]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][1]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][1]["gold"] = $v["gold"];
                                break;
                            case "C204":
                                $c[$v["rtype"]]["player_c"] = $sfs["team"];
                                $c[$v["rtype"]]["c"][2]["pos"] = $v["rtype"];
                                $c[$v["rtype"]]["c"][2]["count"] = $v["count"];
                                $c[$v["rtype"]]["c"][2]["gold"] = $v["gold"];
                                break;
                        }
                        $wtypes[$v["wtype"]]["wtype_count"]+= $v["count"];
                        $wtypes[$v["wtype"]]["wtype_gold"]+= $v["gold"];
                        $arr["league_count"]+= $v["count"];
                        $arr["league_gold"]+= $v["gold"];
                    }
                }


                $arr["wtype"] = $wtypes;
            } else {
                if(!isset($wtypes[$v["wtype"]])){
                    $_wtype = $v["wtype"];
                    switch ($gtype){
                        case "BK":
                            $rts = ["RPD","PD"];
                            $r_bk = $w_r->getBK();
                            if($v["wtype"]=="PD"){
                                $pdh = $r_bk["r"]["PDH"];
                                $pdc = $r_bk["r"]["PDC"];
                                if(in_array($v["rtype"],$pdh)){
                                    $_wtype = "PDH";
                                }elseif(in_array($v["rtype"],$pdc)){
                                    $_wtype = "PDC";
                                }
                            }else{
                                $pdh = $r_bk["RE"]["RPDH"];
                                $pdc = $r_bk["RE"]["RPDC"];
                                if(in_array($v["rtype"],$pdh)){
                                    $_wtype = "RPDH";
                                }elseif(in_array($v["rtype"],$pdc)){
                                    $_wtype = "RPDC";
                                }
                            }
                            break;
                        case "TN":
                            if($_wtype == "RPD3"){$_wtype = "PD3";}
                            if($_wtype == "RPD5"){$_wtype = "PD5";}
                            break;
                    }
                    $gs = ["FT","OP","BS"];
                    if(!in_array($gtype,$gs)){
                        if(strlen($v["gnum_h"])==5){
                            $_wtype .= "_0";
                        }else{
                            $fir = substr($v["gnum_h"],0,1);
                            $_wtype .= "_{$fir}";
                        }
                    }
                    $wtypes[$v["wtype"]]=[
                        "wtype" => $_wtype,
                        "wtype_count" => 0,
                        "wtype_gold" => 0,
                        "wtype_rb" => []
                    ];
                }
                $rb = $v["showtype"]=="live" ? "RB" : "PL";

                if (!isset($wtypes[$v["wtype"]]["wtype_rb"][$rb])) {
                    $wtypes[$v["wtype"]]["wtype_rb"][$rb] = [
                        "wtype_rb" => $rb,
                        "real_wtype"=>$wtype1,
                        "gid" => []
                    ];
                }


                $gids_key = $v["wtype"]."^".$rb."^".$v["gid"];
                if(!isset($gids[$gids_key])){
                    $gids[$gids_key] = [
                        "gid" => $v["gid"],
                        "ptype" => $v["ptype"],
                        "rtype" => []
                    ];
                }

                if($smn === false) {
                    $rtype_key = $v["wtype"] . "^" . $rb . "^" . $v["gid"] . "^" . $v["rtype"];
                    if (!isset($rtype[$rtype_key])) {
                        $rtype[$rtype_key] = [
                            "rtype" => $v["rtype"],
                            "count" => $v["count"],
                            "gold" => $v["gold"]
                        ];
                    }

                    $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                    $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                    $arr["league_count"] += $v["count"];
                    $arr["league_gold"] += $v["gold"];
                    $gids[$gids_key]["rtype"][$rtype_key] = $rtype[$rtype_key];
                    $wtypes[$v["wtype"]]["wtype_rb"][$rb]["gid"][$gids_key] = $gids[$gids_key];
                }else{
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        $rtype_key = $v["wtype"] . "^" . $rb . "^" . $v["gid"] . "^" . $v["rtype"];
                        if (!isset($rtype[$rtype_key])) {
                            $rtype[$rtype_key] = [
                                "rtype" => $v["rtype"],
                                "count" => $v["count"],
                                "gold" => $v["gold"]
                            ];
                        }

                        $wtypes[$v["wtype"]]["wtype_count"] += $v["count"];
                        $wtypes[$v["wtype"]]["wtype_gold"] += $v["gold"];
                        $arr["league_count"] += $v["count"];
                        $arr["league_gold"] += $v["gold"];
                        $gids[$gids_key]["rtype"][$rtype_key] = $rtype[$rtype_key];
                        $wtypes[$v["wtype"]]["wtype_rb"][$rb]["gid"][$gids_key] = $gids[$gids_key];
                    }
                }
                $arr["wtype"][$v["wtype"]] = $wtypes[$v["wtype"]];
            }

        }

        foreach ($arr["wtype"] as $k => $v){
            if (isset($v["onerows"])){
                $h = array_values($h);
                $c = array_values($c);
                $cou = count($h)>count($c) ? count($h) : count($c);
                $onerows = [];
                for($i=0;$i<$cou;$i++){
                    $hh = [];
                    $cc = [];
                    if(!isset($h[$i])){
                        $cc = $c[$i];
                        $hh = [
                            "player_h" => "",
                            "h" => [
                                [
                                    "gid" => $cc["c"][0]["gid"]-3,
                                    "rtype" => "H_19",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $cc["c"][0]["gid"]-2,
                                    "rtype" => "H_20",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $cc["c"][0]["gid"]-1,
                                    "rtype" => "H_204",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                            ],
                        ];
                    }else{
                        $hh = $h[$i];
                    }

                    if(!isset($c[$i])){
                        $hh = $h[$i];
                        $cc = [
                            "player_c" => "",
                            "c" => [
                                [
                                    "gid" => $hh["h"][0]["gid"]+3,
                                    "rtype" => "C_19",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $hh["h"][0]["gid"]+4,
                                    "rtype" => "C_20",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                                [
                                    "gid" => $hh["h"][0]["gid"]+5,
                                    "rtype" => "C_204",
                                    "pos" => "",
                                    "count" => "",
                                    "gold" => ""
                                ],
                            ],
                        ];
                    }else{
                        $cc = $c[$i];
                    }

                    $onerows[] = [
                        "player_h" => $hh["player_h"],
                        "player_c" => $cc["player_c"],
                        "h" => [
                            [
                                "gid" => $hh["h"][0]["gid"],
                                "rtype" => "H_19",
                                "pos" => $hh["h"][0]["pos"],
                                "count" => $hh["h"][0]["count"],
                                "gold" => $hh["h"][0]["gold"]
                            ],
                            [
                                "gid" => $hh["h"][1]["gid"],
                                "rtype" => "H_20",
                                "pos" => $hh["h"][1]["pos"],
                                "count" => $hh["h"][1]["count"],
                                "gold" => $hh["h"][1]["gold"]
                            ],
                            [
                                "gid" => $hh["h"][2]["gid"],
                                "rtype" => "H_204",
                                "pos" => $hh["h"][2]["pos"],
                                "count" => $hh["h"][2]["count"],
                                "gold" => $hh["h"][2]["gold"]
                            ],
                        ],
                        "c" => [
                            [
                                "gid" => $cc["c"][0]["gid"],
                                "rtype" => "C_19",
                                "pos" => $cc["c"][0]["pos"],
                                "count" => $cc["c"][0]["count"],
                                "gold" => $cc["c"][0]["gold"]
                            ],
                            [
                                "gid" => $cc["c"][1]["gid"],
                                "rtype" => "C_20",
                                "pos" => $cc["c"][1]["pos"],
                                "count" => $cc["c"][1]["count"],
                                "gold" => $cc["c"][1]["gold"]
                            ],
                            [
                                "gid" => $cc["c"][2]["gid"],
                                "rtype" => "C_204",
                                "pos" => $cc["c"][2]["pos"],
                                "count" => $cc["c"][2]["count"],
                                "gold" => $cc["c"][2]["gold"]
                            ],
                        ],
                    ];
                }
                $arr["wtype"][$k]["onerows"] = $onerows;
            } else {
                if(isset($arr["wtype"][$k]["wtype_rb"]["RB"])){
                    foreach ($arr["wtype"][$k]["wtype_rb"]["RB"]["gid"] as $kk => $vv) {
                        $arr["wtype"][$k]["wtype_rb"]["RB"]["gid"][$kk]["rtype"] = array_values($arr["wtype"][$k]["wtype_rb"]["RB"]["gid"][$kk]["rtype"]);
                    }
                    $arr["wtype"][$k]["wtype_rb"]["RB"]["gid"] = array_values($arr["wtype"][$k]["wtype_rb"]["RB"]["gid"]);
                }

                if(isset($arr["wtype"][$k]["wtype_rb"]["PL"])) {
                    foreach ($arr["wtype"][$k]["wtype_rb"]["PL"]["gid"] as $kk => $vv) {
                        $arr["wtype"][$k]["wtype_rb"]["PL"]["gid"][$kk]["rtype"] = array_values($arr["wtype"][$k]["wtype_rb"]["PL"]["gid"][$kk]["rtype"]);
                    }
                    $arr["wtype"][$k]["wtype_rb"]["PL"]["gid"] = array_values($arr["wtype"][$k]["wtype_rb"]["PL"]["gid"]);
                }

                $arr["wtype"][$k]["wtype_rb"] = array_values($arr["wtype"][$k]["wtype_rb"]);
            }

        }
        $arr["wtype"] = array_values($arr["wtype"]);
        $time = time() - $time1;
        return $arr;
    }

    /**
     * 冠军列表
     * @return string[]
     */
    public function get_league_wagers_fs(){
        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $log = $this->over_view_log();
        $this->insertLog($log);
        $smn = $this->son_nid_manger();
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $gtype = strtoupper($this->param["gtype"]);
        $point = $this->get_percentage_point();
        $where = "`hidden`=0 AND `gtype`='{$gtype}' AND ";
        $where.= $this->get_where();
        $filed = "ROUND(SUM(`bet_golds`*{$point}/100),1) AS `gold`,COUNT(`ID`) AS `count`";
        $filed.= ",`lid`,`gid`,`rtype`,`nid`";

        $rs = $this->dbc->select("SELECT {$filed} FROM {$this->betTable} WHERE {$where} GROUP BY `lid`,`rtype`,`gid`");
        if(!$rs){
            return $ary;
        }
        $sfsTable = Constant::S_SP;
        $arr = [
            "league" => []
        ];
        $count = 0;
        foreach ($rs as $v){
            $isOK = "N";
            if($smn === false){
                $isOK = "Y";
            }else{
                $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                if(in_array($nid,$smn)){
                    $isOK = "Y";
                }
            }
            if($isOK == "Y") {
                $count++;
                if (!isset($game[$v["lid"]])) {
                    $game[$v["lid"]] = [
                        "lid" => $v["lid"],
                        "all_count" => 0,
                        "all_gold" => 0,
                        "league_name" => ""
                    ];
                }

                $game[$v["lid"]]["all_count"] += $v["count"];
                $game[$v["lid"]]["all_gold"] += $v["gold"];

                $s = $this->dbs->select("SELECT `id`,`rtype`,`gid`,`datetime`,`league{$css}` AS `league`,`teamsname{$css}` AS `teamsname`,`team{$css}` AS `team` FROM {$sfsTable} WHERE `lid`='{$v["lid"]}' AND `gid`='{$v["gid"]}' AND `rtype`='{$v["rtype"]}'", "Row");
                if ($s) {
                    $game[$v["lid"]]["league_name"] = $s["league"];
                    if (!isset($match[$v["gid"]])) {
                        $match[$s["gid"]] = [
                            "gid" => $s["gid"],
                            "name" => $s["teamsname"],
                            "date" => date("Y-m-d", $s["datetime"]),
                            "time" => date("H:i:s", $s["datetime"]),
                            "count" => 0,
                            "gold" => 0,
                        ];
                    }

                    $match[$s["gid"]]["count"] += $v["count"];
                    $match[$s["gid"]]["gold"] += $v["gold"];
                    $match[$s["gid"]]["rtype"][] = [
                        "rtype" => $s["rtype"],
                        "teamid" => $s["id"],
                        "player" => $s["team"],
                        "wager_count" => $v["count"],
                        "wager_gold" => $v["gold"]
                    ];
                    //print_R(array_values($match));exit;
                    $game[$v["lid"]]["game"][0][0] = $match[$s["gid"]];
                }
                $arr["league"][$v["lid"]] = $game[$v["lid"]];
            }
        }
        if($count==0){
            $arr = $ary;
        }
        return $arr;
    }

    /**
     * wmc窗口 注单查询
     * @return array
     */
    public function get_wmc_list_bet(){
        global $ls_ag_ary,$ls_game_ary,$bet_result,$bet_status,$ls_account_ary,$bet_p3_wtype,$artjson,$sport_tables;
        $maxid = isset($this->param["sel_maxid"]) && is_numeric($this->param["sel_maxid"]) ? $this->param["sel_maxid"] : 0;
        $smn = $this->son_nid_manger();
        $m_gid = [];
        $ary = [
            "maxid" => $maxid,
            "wagers"=> []
        ];
        $where = "`nid` LIKE '{$this->sup["nid"]}%' AND `hidden`=0 AND `isResult`=0 AND `ID`>{$maxid}";
        $gtype = isset($this->param["gtype"]) ? strtoupper($this->param["gtype"]) : "ALL";
        if($gtype != "ALL"){
            if($gtype == "FS"){
                $where.= " AND `wtype`='FS' AND `gnum_c`=0";
            }else{
                $where.= " AND `gtype`='{$gtype}'";
            }

            if($gtype == "FS"){
                $where.= " AND `gnum_c`=0 AND `showtype`='fs'";
            }else{
                $where.= " AND `gnum_c`>0";
            }
        }

        $max = $this->dbc->select("SELECT MAX(`ID`) AS `maxid` FROM {$this->betTable} WHERE {$where}","Row");
        if($max){
            $ary["maxid"]=!empty($max["maxid"]) ? $max["maxid"] : $maxid;
            if($maxid>0) {
                $rs = $this->dbc->select("SELECT * FROM {$this->betTable} WHERE {$where}");
                if ($rs) {
                    $ut = new Util_game();
                    $bs = new Bet($this->param);
                    $wagers = [];
                    $count = 0;
                    foreach ($rs as $v) {
                        $isOK = "N";
                        if($smn === false){
                            $isOK = "Y";
                        }else{
                            $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                            if(in_array($nid,$smn)){
                                $isOK = "Y";
                            }
                        }
                        if($isOK == "Y") {
                            $count++;
                            $arr = [];
                            $arr["TID"] = substr($v["ticket_id"], 2);
                            $arr["DATE"] = date("m-d-Y", $v["bet_time"]);
                            $arr["TIME"] = date("H:i:s", $v["bet_time"]);
                            $arr["SRV_IP"] = $v["bet_ip"];
                            $arr["NAME0"] = $v["m_name"];
                            $arr["ALIAS0"] = null;
                            $arr["M_TYPE"] = $v["ltype"];
                            $arr["IN_RADIO"] = $v["mem_turn_rate"];
                            $arr["ODDF_TYPE"] = $ls_ag_ary["oddf_" . $v["odd_f_type"]];
                            $arr["GOLD"] = number_format($v["bet_golds"], 1);
                            $arr["GT"] = $ls_ag_ary["str_{$v["gtype"]}"];
                            if ($v["gnum_c"] == 0 && $v["showtype"] == "fs") {
                                $arr["GTYPE"] = "FS";
                            } else {
                                $arr["GTYPE"] = $v["gtype"];
                            }

                            if ($v["showtype"] == "live") {
                                $arr["MARKET"] = "rb";
                            } else {
                                if ($v["m_date"] > date("Y-m-d")) {
                                    $arr["MARKET"] = "fu";
                                } else {
                                    $arr["MARKET"] = "ft";
                                }
                            }
                            if (strtoupper($v["wtype"]) != "P3") {
                                $xml = $bs->get_bet_wagers($v, "N", '', "Y");
                                $wagers_type = getXmlNode($xml, "wtype");
                                $league = getXmlNode($xml, "league");
                                $team_h = getXmlNode($xml, "team_h_show");
                                $team_c = getXmlNode($xml, "team_c_show");
                                $team_h_ratio = getXmlNode($xml, "team_h_ratio");
                                $team_c_ratio = getXmlNode($xml, "team_c_ratio");
                                $score = getXmlNode($xml, "score");
                                $ioratio = $this->toHkOdds(getXmlNode($xml, "ioratio"));
                                $result = getXmlNode($xml, "result");
                                $spread = "";
                                if ($ut->checkWtypeIsOU($v["wtype"]) || $v["wtype"] == "W3") {//大小、3项让球
                                    $result = getXmlNode($xml, "rtype_name");
                                    $spread = getXmlNode($xml, "spread_name");
                                }
                                $arr["WAGERS_TYPE"] = $wagers_type;
                                $tname0 = "{$league}<br>";
                                if ($arr["GTYPE"] == "FS") {
                                    $tname1 = "";
                                } else {
                                    $tname1 = "<li class=\"re_betdetail_liMini\">[{$v["gnum_h"]}] vs [{$v["gnum_c"]}]</li>";
                                }

                                if ($v["showtype"] == "live") {
                                    $arr["MARKET"] = "rb";
                                } else {
                                    if ($v["m_date"] > date("Y-m-d")) {
                                        $arr["MARKET"] = "fu";
                                    } else {
                                        $arr["MARKET"] = "ft";
                                    }
                                }
                                $tname2 = "";
                                if ($v["wtype"] != "FS") {
                                    $tname2 = "<li>{$team_h} ";
                                    if (!empty($team_h_ratio) || is_numeric($team_h_ratio)) {
                                        $tname2 .= "<tt class=\"word_red\">{$team_h_ratio}</tt> ";
                                    }
                                    $tname2 .= "v  {$team_c} ";
                                    if (!empty($team_c_ratio) || is_numeric($team_c_ratio)) {
                                        $tname2 .= "<tt class=\"word_red\">{$team_c_ratio}</tt>";
                                    }

                                    $tname2 .= "<tt class=\"word_green\"></tt>";
                                    $tname2 .= "<tt class=\"word_blue\">{$score}</tt>";
                                    $tname2 .= "</li>";
                                }

                                $tname3 = "<li class=\"re_betdetail_liBold\">{$result} ";
                                $tname3 .= "<tt class=\"word_red\">{$spread}</tt> ";
                                $tname3 .= "@ <tt class=\"word_red\">{$ioratio}</tt>";
                                $tname3 .= "</li>";
                                $tname3 .= "<li class=\"re_betdetail_liMini\">{$wagers_type}</li>";
                                $tname = $tname0 . $tname1 . $tname2 . $tname3;
                                $arr["TNAME"] = $tname;

                                if ($v["status"] == 0 && $v["cancel"] == 0) {//注单有效
                                } else {
                                    $arr["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$bet_status[$v["status"]]}</font>";
                                    $arr["CANCEL_APN"] = "";
                                    $arr["CANCEL_DIS"] = "style='display:none'";
                                    $arr["WIN_GOLD"] = $bet_status[$v["status"]];
                                    $arr["WIN_GOLD_CLASS"] = "word_red";
                                    $arr["GOLD"] = "<s>" . number_format($arr["GOLD"], 1) . "</s>";
                                }

                                $arr["BALL_ACT"] = "";
                                $arr["CANCEL_MSG"] = "";
                                switch ($v["danger"]) {
                                    case 3:
                                        $arr["BALL_ACT"] = "<font class=\"word_green txtBold\">{$ls_account_ary["today_wagers_A"]}</font>";
                                        break;
                                    case 2:
                                        $arr["BALL_ACT"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                                        $arr["WIN_GOLD"] = $ls_account_ary["today_wagers_R"];
                                        $arr["WIN_GOLD_CLASS"] = "word_red";
                                        $arr["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                                        $arr["CANCEL_DIS"] = "style='display:none'";
                                        break;
                                    case 1:
                                        $arr["BALL_ACT"] = "<font class=\"word_orange txtBold\">{$ls_account_ary["today_wagers_N"]}</font>";
                                        break;
                                }
                                $strong = "N";
                                if ($v["strong"] == "H") {
                                    if ($v["chose_team"] == "H") {
                                        $strong = "Y";
                                    } else {
                                        $strong = "N";
                                    }
                                } else {
                                    if ($v["chose_team"] == "C") {
                                        $strong = "Y";
                                    } else {
                                        $strong = "N";
                                    }
                                }
                                $arr["STRONG"] = $strong;

                                $CON = "";
                                if (!empty($team_h_ratio) || is_numeric($team_h_ratio)) {
                                    $CON = $team_h_ratio;
                                } else if (!empty($team_c_ratio) || is_numeric($team_c_ratio)) {
                                    $CON = $team_c_ratio;
                                }
                                $arr["CON"] = $CON;
                                $arr["BET_TYPE"] = $v["chose_team"];
                                $arr["TEAM_H"] = $team_h;
                                $arr["TEAM_C"] = $team_c;
                                $arr["NUM_H"] = $v["gnum_h"];
                                $arr["NUM_C"] = $v["gnum_c"];
                                $arr["ORDER_TYPE"] = $result;
                                $arr["ORDER_CON"] = $spread;
                                $arr["LEAGUE"] = $v["lid"];
                            }

                            $arr["ARESULT"] = $v["ag_point"];
                            $arr["LIST_PMSG"] = "none";
                            switch ($this->login_layer) {
                                case Constant::ADS:
                                case Constant::AD:
                                    $arr["ADRESULT"] = (100 - $v["d0_point"] - $v["co_point"] - $v["su_point"] - $v["ag_point"]);
                                case Constant::D0:
                                    $arr["D0RESULT"] = $v["d0_point"];
                                case Constant::CO:
                                    $arr["CRESULT"] = $v["co_point"];
                                case Constant::SU:
                                    $arr["SRESULT"] = $v["su_point"];
                                    break;
                            }
                            /*过滤部分 - start*/

                            switch ($v["showtype"]) {
                                case "live":
                                    $arr["MARKET"] = "rb";
                                    break;
                                case "today":
                                    if ($v["m_date"] > date("Y-m-d")) {
                                        $arr["MARKET"] = "fu";
                                    }
                                    break;
                                case "fs":
                                    if ($v["gnum_c"] > 0) {
                                        if ($v["m_date"] > date("Y-m-d")) {
                                            $arr["MARKET"] = "fu";
                                        }
                                    }
                                    break;
                            }

                            $downlines = $this->get_downline();
                            $lv = lv_nid($this->sup["nid"]);
                            switch ($lv["lv"]) {
                                case Constant::ADS:
                                case Constant::AD:
                                    $name = $v["d0_name"];
                                    break;
                                case Constant::D0:
                                    $name = $v["co_name"];
                                    break;
                                case Constant::CO:
                                    $name = $v["su_name"];
                                    break;
                                case Constant::SU:
                                    $name = $v["ag_name"];
                                    break;
                                case Constant::AG:
                                    $name = $v["m_name"];
                                    break;
                            }
                            $downline = array_search($name, array_column($downlines, "name"));
                            $arr["DOWNLINE"] = $downline;
                            if (!isset($m_gid[$v["gid"]])) {
                                $m_gid[$v["gid"]] = $v["gid"];
                                if ($gtype == "ALL") {
                                    if ($v["gnum_c"] > 0 && $v["showtype"] != "fs") {
                                        $matchTable = $sport_tables[$v["gtype"]]["table"];
                                    }
                                } else {
                                    $matchTable = $sport_tables[$gtype]["table"];
                                }
                                if (isset($matchTable)) {
                                    $match = $this->dbs->select("SELECT `gid` FROM {$matchTable} WHERE `gidm`='{$v["gidm"]}' AND `master`='Y'", "Row");
                                    if ($match) {
                                        $m_gid[$v["gid"]] = $match["gid"];
                                    }
                                }

                            }
                            $arr["_EVENT"] = $m_gid[$v["gid"]];
                            /*过滤部分 - end*/
                            if (strtoupper($v["wtype"]) == "P3") {
                                $p3 = $this->dbc->select("SELECT COUNT(`ID`) AS `cou`,SUM(IF(`rb`='Y',1,0)) AS `RB`,`gid` FROM {$this->betTable_p3} WHERE `p3id`={$v["ID"]}", "Row");
                                $cou = $p3["cou"];
                                $isRB = $p3["RB"] >= 1 ? "Y" : "N";
                                $arr["_EVENT"] = $p3["gid"];
                                $arr["WAGERSTYPE"] = $bet_p3_wtype[$isRB];
                                $arr["TNAME"] = "<li class=\"word_bold\">{$arr["WAGERSTYPE"]} ({$cou} {$artjson["ART_today_in"]} 1)</li>";
                                if ($isRB == "Y") {
                                    $game["BALL_ACT"] = "<font class=\"word_green txtBold\">{$ls_account_ary["today_wagers_A"]}</font>";
                                }
                                $arr["TEAM_H"] = "";
                                $arr["TEAM_C"] = "";
                                $arr["NUM_H"] = "";
                                $arr["NUM_C"] = "";
                                $arr["ORDER_TYPE"] = "";
                                $arr["ORDER_CON"] = "";
                                $arr["BALL_ACT"] = "";
                                $arr["LEAGUE"] = 0;
                                $arr["RPWAGERSTYPE"] = $arr["TNAME"];
                                $arr["SHOWTEXT_LEAGUE"] = null;
                                $arr["SHOWTEXT_TEAM_NUM"] = null;
                                $arr["SHOWTEXT_TEAM"] = null;
                                $arr["SHOWTEXT_ORDER_TYPE_IORATIO"] = null;
                            } else {
                                $arr["WAGERSTYPE"] = $wagers_type;
                                $arr["RPWAGERSTYPE"] = "";
                                $arr["SHOWTEXT_LEAGUE"] = $tname0;
                                $arr["SHOWTEXT_TEAM_NUM"] = $tname1;
                                $arr["SHOWTEXT_TEAM"] = $tname2;
                                $arr["SHOWTEXT_ORDER_TYPE_IORATIO"] = $tname3;
                            }
                            $arr["SITE"] = "";
                            $wagers[] = $arr;
                        }
                    }
                    if($count == 0){
                        $wagers = [];
                    }
                    $ary["wagers"] = $wagers;
                }
            }
        }
        $this->insertLog("注单弹窗[实时注单]查询");
        return $ary;
    }

    public function get_history_data(){
        global $weekAry;
        $ary = [
            "history" => [],
            "qtime"   => [],
            "status" => 200,
            "total" => [
                "GOLD" => "-",
                "VGOLD" => "-",
                "WINLOSS" => "-"
            ],
            "type" => "history_data"
        ];
        $nid = $this->user["nid"];
        $total_gold = 0;
        $total_vgold = 0;
        $total_winloss = 0;
        $xmls = "";
        $dateBar = "";
        $num = 0;
        $mid = $this->param["mid"];
        $mem = $this->dbc->select("SELECT `nid`,`name` FROM {$this->memTable} WHERE `id`={$mid} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");

        $wh = "`m_name`='{$mem["name"]}' AND `isResult`=1 AND `hidden`=0";
        for($i=0;$i<=7;$i++){
            if($i==0) {
                $date = date("Y-m-d");
            } else {
                $date = date("Y-m-d",strtotime("-{$i} day"));
            }
            $dateBar.=$date."|";
            $num++;
            //startdate  enddate
            if(empty($this->param["startdate"]) || (!empty($this->param["startdate"]) && $this->param["startdate"]<=$date && $date<=$this->param["enddate"])) {
                switch ($this->langx) {
                    case "en-us":
                        $w = date("w", strtotime($date));
                        $date_name = $weekAry["en-us"][$w];
                        break;
                    default:
                        $w = date("w", strtotime($date));
                        $date_name = $weekAry["zh-cn"][$w];
                        break;
                }

                $arr = [
                    "DATE" => $date,
                    "DATE_NAME" => date("m-d", strtotime($date)),
                    "ACTION_DATE" => "",
                    "GOLD" => "-",
                    "VGOLD" => "-",
                    "WEEK" => $date_name,
                    "WINLOSS" => "-",
                    "WINLOSS_CLS" => "word_paleBlack"
                ];

                //print_r("SELECT SUM(`bet_golds`) AS `gold`, SUM(`valid_gold`) AS `vgold`,SUM(`mem_result`) AS `winloss` FROM {$this->bet_table} WHERE `isResult`=1 AND `m_date`='{$ary["date"]}' AND `nid`='{$nid}'");exit;
                if(!$mem){

                } else {
                    $where = "";
                    if (isset($this->param["selGtype"]) && strtoupper($this->param["selGtype"]) != "ALL") {
                        $gtype = strtoupper($this->param["selGtype"]);
                        $where = " AND `gtype`='{$gtype}'";
                    }
                    //SUM(IF(`pay_type`=1 AND `mem_result`>=0,`mem_result`+`mem_result`,`mem_result`))
                    //print_r("SELECT SUM(`bet_golds`) AS `gold`, SUM(`valid_gold`) AS `vgold`,SUM(`mem_result`) AS `winloss` FROM {$this->betTable} WHERE {$wh} AND `nid` LIKE '{$nid}%' {$where}");exit;
                    $rs = $this->dbc->select("SELECT SUM(`bet_golds`) AS `gold`, SUM(`valid_gold`) AS `vgold`,SUM(`mem_result`) AS `winloss` FROM {$this->betTable} WHERE {$wh} AND `m_date`='{$arr["DATE"]}' AND `nid` LIKE '{$nid}%' {$where}", "Row");
                    if ($rs) {
                        $total_gold += $rs["gold"];
                        $total_vgold += $rs["vgold"];
                        $total_winloss += $rs["winloss"];

                        $arr["date_class"] = "his_list";
                        $arr["GOLD"] = empty($rs["gold"]) ? "-" : number_format(round($rs["gold"], 2),0) ;
                        $arr["VGOLD"] = empty($rs["vgold"]) ? "-" : number_format(round($rs["vgold"], 2),0);
                        $arr["WINLOSS"] = empty($rs["winloss"]) ? "-" : number_format(round($rs["winloss"], 2),2);
                        if ($rs["winloss"] > 0) {
                            $arr["WINLOSS_CLS"] = "word_paleGreen";
                        } else {
                            $arr["WINLOSS_CLS"] = "word_paleRed";
                        }
                    }
                }
                $ary["history"][] = $arr;

            }
        }
        $dateBar = rtrim($dateBar,"|");
        $total_gold = empty($total_gold) ? "-" : number_format($total_gold,0);
        $total_vgold = empty($total_vgold) ? "-" : number_format($total_vgold,0);
        $total_winloss = empty($total_winloss) ? "-" : number_format($total_winloss,2);
        $winloss_class = $total_winloss=="-" ? "word_paleBlack" : ($total_winloss>0 ? "word_paleGreen" : "word_paleRed");
        $ary["total"] = [
            "GOLD" => $total_gold,
            "VGOLD" => $total_vgold,
            "WINLOSS" => $total_winloss
        ];
        $ary["mem"] = ['name'=>$mem['name']];

        return $ary;
    }

    public function get_history_view(){
        global $weekAry;
        $gtype = empty($this->param["selGtype"]) ? "ALL" : strtoupper($this->param["selGtype"]);
        $selDate = empty($this->param["selDate"]) ? date("Y-m-d") : $this->param["selDate"];
        $ary = [
            "allDateShow" => "9月16日 星期五|9月15日 星期四|9月14日 星期三|9月13日 星期二|9月12日 星期一|9月11日 星期日|9月10日 星期六|9月9日 星期五|9月8日 星期四",
            "allDateValue" => "2022-09-16|2022-09-15|2022-09-14|2022-09-13|2022-09-12|2022-09-11|2022-09-10|2022-09-09|2022-09-08",
            "selDate" => $selDate,
            "selGtype" => $gtype,
            "status" => "200",
            "type" => "history_view"
        ];

        $allDateShow = "";
        $allDateValue = "";
        for($i=0;$i<=7;$i++){
            if($i==0) {
                $date = date("Y-m-d");
            } else {
                $date = date("Y-m-d",strtotime("-{$i} day"));
            }
            $allDateValue.=$date."|";
            $num++;

            switch ($this->langx) {
                case "en-us":
                    $allDateShow .= date("m-d", strtotime($date));
                    $w = date("w", strtotime($date));
                    $allDateShow .= " " . $weekAry["en-us"][$w];
                    break;
                default:
                    $allDateShow .= date("m月d日", strtotime($date));
                    $w = date("w", strtotime($date));
                    $allDateShow .= " " . $weekAry["zh-cn"][$w];
                    break;
            }

            $allDateShow.= "|";

        }

        $ary["allDateValue"] = rtrim($allDateValue,"|");
        $ary["allDateShow"] = rtrim($allDateShow,"|");

        $mid = $this->param["mid"];
        $mem = $this->dbc->select("SELECT `nid`,`name` FROM {$this->memTable} WHERE `id`={$mid} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");
        if($mem) {
            $today_gmt = date("Y-m-d");
            $where = "`nid` LIKE '{$this->sup["nid"]}%' AND `isResult`=1 AND `hidden`=0 AND `m_name`='{$mem["name"]}'";
            if (strtoupper($gtype) != "ALL") {
                $gtype = strtoupper($this->param["gtype"]);
                $where .= " AND `gtype`='{$gtype}'";
            }

            if (isset($this->param["today_gmt"]) && strtoupper($this->param["today_gmt"]) != "ALL") {
                $today_gmt = $this->param["today_gmt"];
                $where .= " AND `m_date`='{$today_gmt}'";
            }

            $rs = $this->dbc->select("SELECT * FROM {$this->betTable} WHERE {$where} ORDER BY `bet_time` DESC");

            if ($rs) {
                $ary["wagers"] = $this->get_bet_list($rs, "Y");
            }
        }
        $ary["mem"] = ['name'=>$mem['name']];
        return $ary;
    }

    public function get_today_wagers(){
        $ary = [
            "amount_gold" => "0",
            "count" => 0,
            "status"=>"200",
            "type" => "today_wagers",
            "wagers" => []
        ];

        $mid = $this->param["mid"];
        $gtype = empty($this->param["selGtype"]) ? "ALL" : strtoupper($this->param["selGtype"]);
        $mem = $this->dbc->select("SELECT `nid`,`name` FROM {$this->memTable} WHERE `id`={$mid} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");
        if(!$mem){ return $ary; }
        $where = "`m_name`='{$mem["name"]}' AND `isResult`=0 AND `hidden`=0";
        if($gtype!="ALL"){
            $where .= " AND `gtype`='{$gtype}'";
        }
        $cs = "";
        switch ($this->param["langx"]){
            case "zh-tw":
                $cs = "_tw";
                break;
            case "en-us":
                $cs = "_en";
                break;
        }
        $rs = $this->dbc->select("SELECT * FROM {$this->betTable} WHERE {$where} ORDER BY `bet_time` DESC,`id` DESC");
        $ary["mem"] = ['name'=>$mem['name']];
        $ary["count"] = count($rs);
        $bet_golds = array_column($rs,"bet_golds");
        $ary["amout_gold"] = number_format(array_sum($bet_golds),2);

        $wagers = [];
        if($ary["count"]>0){
            $wagers = $this->get_bet_list($rs,"N");
        }
        $ary["wagers"] = $wagers;
        return $ary;
    }

    /**
     * 注单列表处理
     * @param $rs
     * @param string $isResult Y:结算注单,N:未结算注单
     * @return string
     */
    public function get_bet_list($rs,$isResult="N"){
        global $ls_ary,$ls_account_ary,$artjson,$bet_status;
        $wagers = [];
        foreach($rs as $k => $v){
            $ticket_id = $v["ticket_id"];
            $gtype = strtoupper($v["gtype"]);
            $rtype = $v["rtype"];
            $wtype = $v["wtype"];
            $showtype = $v["showtype"];
            $ms_name = "";
            $ballact = 0;
            $danger = $v["danger"];

            $addtime = date("H:i:s",$v["bet_time"]);
            $oddf_type_name = $ls_ary["oddf_".$v["odd_f_type"]];
            $gtype_name = $artjson["ATR_ball_".strtolower($gtype)];
            $arr = [];
            $arr["ADDTIME"] = $addtime;
            $arr["BALL_ACT_CLASS"] = null;
            $arr["BALL_ACT_RET"] = null;
            $arr["BET_TYPE"] = "";
            $arr["BET_WTYPE"] = "";
            $arr["CANCEL_APN"] = "";
            $arr["CANCEL_LINE"] = "";
            $arr["DATE"] = date("Y-m-d",$v["bet_time"]);
            $arr["GOLD"] = $v["bet_golds"];
            $arr["GOLD_CLASS"] = "";
            $arr["GTYPE"] = "{$gtype_name}";
            $arr["IORATIO"] = "";
            $arr["LEAGUE"] = "";
            $arr["ODDF_TYPE"] = "({$oddf_type_name})";
            $arr["ORG_SCORE"] = "";
            $arr["PNAME"] = "";
            $arr["RATIO"] = "";
            $arr["RESULT"] = "";
            $arr["SCORE"] = "";
            $arr["TEAM_C"] = "";
            $arr["TEAM_C_RATIO"] = "";
            $arr["TEAM_H"] = "";
            $arr["TEAM_H_RATIO"] = "";
            $arr["WID"] = $ticket_id;

            if(strtoupper($wtype) == "P3"){//过关
                $bet_wtype = "P";
                $ball_act_class = "";
                $ball_act_ret = "";
                $ddd = "";
                $ddd1 = "";
                $ddd2 = "";
                $arr["WTYPE"] = "";
                $p3 = $this->dbc->select("SELECT * FROM {$this->betTable_p3} WHERE `p3id`={$v["ID"]}");
                foreach ($p3 as $vv){
                    $sub = [];
                    if($vv["rb"]=="Y"){
                        $bet_wtype = "RP3";
                    }

                    if($vv["dg"] == "Y"){
                        switch ($danger){
                            case 1://待确认
                                $ball_act_class = "word_orange";
                                $ball_act_ret = $ls_account_ary["today_wagers_N"];
                                $ddd = "N";
                                break;
                            case 2:
                                $ddd1 = "R";
                                $ball_act_class = "word_red";
                                $ball_act_ret = $ls_account_ary["today_wagers_R"];
                                break;
                            case 3:
                                $ddd2 = "A";
                                $ball_act_class = "word_green";
                                $ball_act_ret = $ls_account_ary["today_wagers_A"];
                                break;
                        }
                    }
                    $arr["WAGERS_SUB"][] = $this->get_bet_wagers($vv,$sub,$isResult,"P3");
                }
                $arr["BET_WTYPE"] = $bet_wtype;

                if($bet_wtype == "RP3"){
                    if($ddd1=="R"){
                        $arr["MAIN_BALL_ACT_CLASS"] = "word_red";
                        $arr["MAIN_BALL_ACT_RET"] = $ls_account_ary["today_wagers_R"];
                        $arr["BALL_ACT_RET"] = "word_red";
                        $arr["MAIN_ACT_RET"] = $ls_account_ary["today_wagers_R"];
                    }else if($ddd == "N"){
                        $arr["MAIN_BALL_ACT_CLASS"] = "word_orange";
                        $arr["MAIN_BALL_ACT_RET"] = $ls_account_ary["today_wagers_N"];
                        $arr["BALL_ACT_RET"] = "word_orange";
                        $arr["MAIN_ACT_RET"] = $ls_account_ary["today_wagers_N"];
                    }else if($ddd2=="A"){
                        $arr["MAIN_BALL_ACT_CLASS"] = "word_orange";
                        $arr["MAIN_BALL_ACT_RET"] = $ls_account_ary["today_wagers_A"];
                        $arr["BALL_ACT_RET"] = "word_orange";
                        $arr["MAIN_ACT_RET"] = $ls_account_ary["today_wagers_A"];
                    } else{
                        $arr["MAIN_BALL_ACT_CLASS"] = "";
                        $arr["MAIN_BALL_ACT_RET"] = "";
                        $arr["BALL_ACT_RET"] = "";
                        $arr["MAIN_ACT_RET"] = "";
                    }

                }else{
                    $arr["MAIN_BALL_ACT_CLASS"] = "";
                    $arr["MAIN_BALL_ACT_RET"] = "";
                    $arr["BALL_ACT_RET"] = "";
                    $arr["MAIN_ACT_RET"] = "";
                }

            }else{
                $bet_wtype = strtoupper($wtype);
                $arr["BET_WTYPE"] = $bet_wtype;
                $arr = array_merge($arr,$this->get_bet_wagers($v,$arr,$isResult));
                if($v["dg"]=="Y"){
                    $ballact = 1;
                    $arr["DG"] = $v["dg"];
                    $arr["DG_STR"] = $ls_account_ary["today_wagers_A"];
                }

            }

            if($isResult=="Y"){
                if($v["status"]>0){
                    $arr["WIN_GOLD"] = 0;
                    $arr["RESULT"] = $bet_status[$v["status"]];
                }else{
                    $mem_result = round($v["mem_result"],2);
                    $arr["WIN_GOLD"] = $mem_result;
                    if($v["mem_result"] == 0){
                        $arr["RESULT"] = $bet_status[0];
                    }
                }

            }else{
                $arr["WIN_GOLD"] = $v["win_gold"];
                $arr["DELAYSEC"] = $v["delaysec"];
                $arr["BALLACT"] = $ballact;
            }
            $wagers[] = $arr;
        }
        return $wagers;
    }

    /**
     * 英文队名/联赛名 → 简体中文(取 db_sports.name_cn_cache, 与 H5 前台同源)。
     * 外接赛事(世界杯/外围盘)注单的队名/联赛名以英文存库, 旧版后台直接显示英文。
     * 已是中文(不含英文字母)或查无结果时原样返回; 请求内静态缓存避免重复查询。
     */
    private function nameToCn($s){
        static $cache = [];
        $s = (string)$s;
        if($s === "") return $s;
        if(!preg_match('/[A-Za-z]/', $s)) return $s; // 已是中文/无需翻译
        if(array_key_exists($s,$cache)) return $cache[$s];
        $cn = "";
        try{
            $row = $this->dbs->select("SELECT `name_cn` FROM `name_cn_cache` WHERE `name_en`='".addslashes($s)."' LIMIT 1","Row");
            if($row && !empty($row["name_cn"])) $cn = $row["name_cn"];
        }catch(\Exception $e){ $cn = ""; }
        $out = ($cn !== "") ? $cn : $s;
        $cache[$s] = $out;
        return $out;
    }

    /**
     * 外接盘口(api_v2 下注的世界杯/外围赛事)在旧版 d0/代理后台的玩法名称与选项修正。
     * 旧系统 CS="零失球", 但新功能用 CS 表示"正确比分"(rtype 存比分如 4:4); BTS/ML/DC/DNB/
     * SP/OU/OE 等也存在语义差异或旧版 FT 未涵盖。仅当 rtype 命中新功能编码时才覆盖, 旧注单不受影响。
     * @return array|null  ['name'=>玩法中文, 'result'=>选项中文] 或 null(不覆盖)
     */
    private function extMarketCn($wtype,$rtype,$spread,$team_h,$team_c,$betstr=""){
        $wt = strtoupper((string)$wtype);
        $rt = strtoupper(trim((string)$rtype));
        $sp = ($spread !== null && $spread !== "") ? (string)$spread : "";
        $side = function($r) use ($team_h,$team_c){
            if($r==="H") return $team_h;
            if($r==="C") return $team_c;
            if($r==="D") return "和局";
            return "";
        };
        $isScore = (bool)preg_match('/^\d+\s*[:\-]\s*\d+$/', $rt);
        $score = str_replace(["-"," "], [":",""], $rt);
        switch($wt){
            case "CS":
                if(!$isScore) return null;
                return ["name"=>"正确比分","result"=>$score];
            case "HT_CS":
                if(!$isScore) return null;
                return ["name"=>"上半场正确比分","result"=>$score];
            case "BTS":
                if($rt!=="Y" && $rt!=="N") return null;
                return ["name"=>"双方进球","result"=>($rt==="Y"?"是":"否")];
            case "HT_BTS":
                if($rt!=="Y" && $rt!=="N") return null;
                return ["name"=>"上半场双方进球","result"=>($rt==="Y"?"是":"否")];
            case "ML":
                if(!in_array($rt,["H","C","D"],true)) return null;
                return ["name"=>"独赢","result"=>$side($rt)];
            case "HT_ML":
                if(!in_array($rt,["H","C","D"],true)) return null;
                return ["name"=>"半场独赢","result"=>$side($rt)];
            case "DNB":
                if(!in_array($rt,["H","C"],true)) return null;
                return ["name"=>"和局退款","result"=>$side($rt)];
            case "DC":
                $dc=["HD"=>$team_h." / 和局","CD"=>$team_c." / 和局","HC"=>$team_h." / ".$team_c];
                if(!isset($dc[$rt])) return null;
                return ["name"=>"双重机会","result"=>$dc[$rt]];
            case "SP":
                if(!in_array($rt,["H","C"],true)) return null;
                // 显示「剩余赛事」让球线: 取下注时冻结在 betstr 的尾部让球数(让0 / +x / -x);
                // 取不到时回退到全场 spread。结算仍用 spread 全场线, 不受影响。
                $spShow = $sp;
                if(is_string($betstr) && $betstr !== "" && preg_match('/(让0|[+\-][0-9.]+)\s*$/u',$betstr,$bm)){
                    $spShow = $bm[1];
                }
                return ["name"=>"让球","result"=>trim($side($rt)." ".$spShow)];
            case "HT_SP":
                if(!in_array($rt,["H","C"],true)) return null;
                return ["name"=>"上半场让球","result"=>trim($side($rt)." ".$sp)];
            case "OU":
                if(!in_array($rt,["OVER","UNDER"],true)) return null;
                return ["name"=>"大小","result"=>trim(($rt==="OVER"?"大":"小")." ".$sp)];
            case "HT_OU":
                if(!in_array($rt,["OVER","UNDER"],true)) return null;
                return ["name"=>"上半场大小","result"=>trim(($rt==="OVER"?"大":"小")." ".$sp)];
            case "OE":
                if(!in_array($rt,["ODD","EVEN"],true)) return null;
                return ["name"=>"单双","result"=>($rt==="ODD"?"单":"双")];
            case "CORNERS":
                if(!in_array($rt,["OVER","UNDER"],true)) return null;
                return ["name"=>"角球大小","result"=>trim(($rt==="OVER"?"大":"小")." ".$sp)];
        }
        return null;
    }

    /**
     * 注单处理
     * @param $v
     * @param $wagers
     * @param $isResult Y:结算注单,N:未结算注单
     * @param string $p_wtype
     * @param string $isAD Y:后台显示 N:前台显示
     * @return string
     */
    /**
     * 显示层：欧洲小数赔率 → 香港(亚洲)赔率 = 小数 − 1。
     * 仅用于后台面板展示；bet.ioratio 存储值与 common/Result.php、settle_bets.php
     * 结算公式一律保持欧洲小数赔率不变，故派彩金额完全不受影响。
     * 非数值或 ≤1 的值原样返回（避免对空值/特殊行做错误换算）。
     */
    private function toHkOdds($v){
        if (!is_numeric($v)) return $v;
        $d = (float)$v;
        if ($d <= 1.0) return $v;
        return number_format($d - 1, 2, '.', '');
    }

    public function get_bet_wagers($v,$wagers,$isResult="N",$p_wtype='',$isAD="N"){
        global $ls_game_ary,$ls_account_ary;
        $cs = "";
        switch ($this->param["langx"]){
            case "zh-tw":
                $cs = "_tw";
                break;
            case "en-us":
                $cs = "_en";
                break;
        }

        $ut = new Util_game();
        $gtype = $v["gtype"];
        $rtype = $v["rtype"];
        $wtype = $v["wtype"];
        $_wtype = $v["wtype"];
        $showtype = $v["showtype"];
        $_chose_team = $v["chose_team"];
        $danger = $v["danger"];
        $spread = $v["spread"];
        $date = $v["m_date"];
        $imp = $v["important"];
        $ptype = $v["ptype{$cs}"];

        $ms_name = "";


        $league = $this->nameToCn(($v["league{$cs}"] !== null && $v["league{$cs}"] !== "") ? $v["league{$cs}"] : $v["league"]);
        $team_h = $this->nameToCn(($v["team_h{$cs}"] !== null && $v["team_h{$cs}"] !== "") ? $v["team_h{$cs}"] : $v["team_h"]);
        $team_c = $this->nameToCn(($v["team_c{$cs}"] !== null && $v["team_c{$cs}"] !== "") ? $v["team_c{$cs}"] : $v["team_c"]);
        if($gtype != "FT"){
            $msAry = explode("-",$team_h);
            if(isset($msAry[1])){
                $msStr1 = "- ".$msAry[1];
                $team_h = rtrim(str_replace($msStr1,"",$team_h));
                $team_c = rtrim(str_replace($msStr1,"",$team_c));
            }
        }

        if($imp=="Y"){
            $team_h = rtrim(str_replace($ptype,"",$team_h));
            $team_c = rtrim(str_replace($ptype,"",$team_c));
        }

        $msStr = $v["ms"];
        if($gtype != "FT" && !empty($ms)) {
            $ms = explode('_', $msStr)[1];
            $ms_str = $ls_game_ary[$gtype . "_game_" . $ms . "_set"];
            if (!empty($ms_str)) {
                if ($ms_str != $gtype . "_game_" . $ms . "_set") {
                    $ms_name = "- {$ms_str}";
                }
            }
        }



        $wtype_name = $ut->getWtypeName($showtype,$gtype,$wtype,$rtype,$msStr,$team_h,$team_c,$imp,$ptype,false);

        $score = "";
        $scs = explode(":",$v["score"]);
        if(count($scs)==2){
            $score = "({$scs[0]} - {$scs[1]})";
        }

        if($wtype=="SP") {
            $wtype = $ut->changeRtypetoWtypeSP($rtype);
        }

$strong = strtoupper($v["strong"]);
       // $strong = $v["strong"];
        if(strtoupper($_chose_team)=="N") {
            $_chose_team = "H";
        }
        $strObj = [
            "H_Y" => "H",
            "C_N" => "H",
            "C_Y" => "C",
            "H_N" => "C"
        ];
        $strong = isset($strObj[$_chose_team."_".$strong]) ? $strObj[$_chose_team."_".$strong] : $strong;
        $ratio = $spread;
        $conObj = $ut->getConcedeStr($wtype,$strong,$ratio,false);

        $_rtype = strtolower($rtype);
        $newRtype = $ut->switchTeamName($wtype,$rtype);
        if(!empty($newRtype)){
            $_rtype = $newRtype;
        }

        if(strtoupper($gtype)=="BS" && $ut->checkWtypeIsWM($_wtype)){
            $chose_team = $ls_game_ary[$_rtype."_".strtolower($gtype)];
        }else if(!isset($ls_game_ary[$_rtype])){
            $Ftype="_F_RF_DC_RDC_";
            if (strpos($Ftype,"_".strtoupper($_wtype)."_")!==false){
                $f1=strtoupper(substr(str_replace(strtoupper($_wtype),"",strtoupper($rtype)),0,1));
                $f2=strtoupper(substr(str_replace(strtoupper($_wtype),"",strtoupper($rtype)),1,1));
                $chose_team = "";
                if($f1=="N"){
                    $chose_team.= $ls_game_ary["mn"];
                }else{
                    $choose = $team_h;
                    if($f1 == "C"){
                        $choose = $team_c;
                    }
                    $chose_team.= $choose;
                }
                $chose_team .= " / ";
                if ($f2=="N"){
                    $chose_team.= $ls_game_ary["mn"];
                }else{
                    $choose = $team_h;
                    if($f2 == "C"){
                        $choose = $team_c;
                    }
                    $chose_team.= $choose;
                }
            }else{
                $tmp_type = substr($_chose_team,-1,1);
                $choose = $team_h;
                if(strtoupper($tmp_type) == "C"){
                    $choose = $team_c;
                }
                $chose_team = $choose;
            }
        } else {
            $chose_team = $ls_game_ary[$_rtype];
            $chose_team = preg_replace("/\*TEAM_H\*/is", $team_h, $chose_team);
            $chose_team = preg_replace("/\*TEAM_C\*/is", $team_c, $chose_team);
        }

        $tmp_team = "";
        $get_team = $ut->getTeamWM(strtoupper($_rtype));
        if(!empty($get_team)){
            $tmp_team = $team_h;
            if($get_team == "c"){
                $tmp_team = $team_c;
            }
        }

        $result = $tmp_team.$chose_team;


        if(!$ut->checkWtypeIsOU($wtype) && $wtype!="W3"){
        }else{//大小处理
            $_abs = "";
            if($_wtype=="W3"){
                $chose = $_chose_team;
                if(strtoupper($chose)=="N") $chose="H";

                if(strtoupper($strong)==strtoupper($chose)){
                    $_abs = "-";
                }else{
                    $_abs = "+";
                }
            }
            $rtype_name = $result;
            $spread_name = $_abs.$spread;
            $result .=  " ".$_abs.$spread;

            $wagers["RTYPE_NAME"] = $rtype_name;
            $wagers["SPREAD_NAME"] = $spread_name;
        }

        // 外接盘口玩法名称/选项修正(世界杯等 api_v2 注单)。$_wtype 为原始 wtype(SP 在上方可能已被改写)。
        $extM = $this->extMarketCn($_wtype,$rtype,$spread,$team_h,$team_c,$v["betstr"] ?? "");
        if($extM !== null){
            $wtype_name = $extM["name"];
            if($extM["result"] !== ""){ $result = $extM["result"]; }
        }



        $ball_act_class = "";
        $ball_act_ret = "";
        switch ($danger){
            case 1://待确认
                $ball_act_class = "word_orange";
                $ball_act_ret = $ls_account_ary["today_wagers_N"];
                break;
            case 2:
                $ball_act_class = "word_red";
                $ball_act_ret = $ls_account_ary["today_wagers_R"];
                break;
            case 3:
                $ball_act_class = "word_green";
                $ball_act_ret = $ls_account_ary["today_wagers_A"];
                break;
        }


        if(strtoupper($p_wtype) == "P3"){
            $date = date("m-d",strtotime($date));
            $wagers["DATE"] = $date;
            $wagers["WTYPE_SUB"] = $wtype_name;
            $wagers["MS_SUB"] = $ms_name;
            $wagers["LEAGUE"] = $league;
            $wagers["TEAM_H"] = $team_h;
            $wagers["TEAM_C"] = $team_c;
            $wagers["TEAM_H_RATIO"] = $conObj["bet_finish_con"];
            $wagers["TEAM_C_RATIO"] = $conObj["bet_finish_con_c"];
			
			if(strlen($conObj["bet_finish_con"])>0){
				if($_chose_team=='H'){
					$_strong="-";
				}else{
					$_strong="+";
				}
			}else{
				if($_chose_team=='H'){
					$_strong="+";
				}else{
					$_strong="-";
				}
			}
			$wagers["BET_RATIO"] = (strlen($conObj["bet_finish_con"])>0)?" ".$_strong.$conObj["bet_finish_con"]:" ".$_strong.$conObj["bet_finish_con_c"];
            $wagers["RATIO"] = "";
            $wagers["ORG_SCORE"] = "";
            $wagers["SCORE"] = $score;
            $wagers["RESULT"] = $result;
            $wagers["PNAME"] = $ptype;
            $wagers["IORATIO"] = $this->toHkOdds($v["ioratio"]);
            $wagers["P_WTYPE"]= $_wtype;
            $wagers["P_BALL_ACT_CLASS"] = $ball_act_class;
            $wagers["P_BALL_ACT_RET"] = $ball_act_ret;
        }elseif(strtoupper($wtype)=="FS"){
            $wagers["W_MS"] = $ms_name;
            $wagers["WTYPE"] = $wtype_name;
            $wagers["LEAGUE"] = $league;
            $wagers["TEAM_H"] = "";
            $wagers["TEAM_C"] = "";
            $wagers["TEAM_H_RATIO"] = "";
            $wagers["TEAM_C_RATIO"] = "";
			if(strlen($conObj["bet_finish_con"])>0){
				if($_chose_team=='H'){
					$_strong="-";
				}else{
					$_strong="+";
				}
			}else{
				if($_chose_team=='H'){
					$_strong="+";
				}else{
					$_strong="-";
				}
			}
			$wagers["BET_RATIO"] = (strlen($conObj["bet_finish_con"])>0)?" ".$_strong.$conObj["bet_finish_con"]:" ".$_strong.$conObj["bet_finish_con_c"];
            $wagers["RATIO"] = "";
            $wagers["ORG_SCORE"] = "";
            $wagers["SCORE"] = "";
            $wagers["RESULT"] = $result;
            $wagers["PNAME"] = "";
            $wagers["IORATIO"] = $this->toHkOdds($v["ioratio"]);
            $wagers["BALL_ACT_CLASS"] = "";
            $wagers["BALL_ACT_RET"] = "";
        }else{
            $wagers["W_MS"] = $ms_name;
            $wagers["WTYPE"] = $wtype_name;
            $wagers["LEAGUE"] = $league;

            $wagers["TEAM_H"] = $team_h;
            $wagers["TEAM_C"] = $team_c;
			
			$wagers["TEAM_H_RATIO"] = $conObj["bet_finish_con"];
            $wagers["TEAM_C_RATIO"] = $conObj["bet_finish_con_c"];
			if (strlen($conObj["bet_finish_con"]) > 0 && preg_match('/\d/', $conObj["bet_finish_con"])) {  

    if ($_chose_team == 'H') {  

        $_strong = "-";  

    } else {  

        $_strong = "+";  

    }  

    $wagers["BET_RATIO"] = " $_strong" . $conObj["bet_finish_con"];  

} elseif (strlen($conObj["bet_finish_con_c"]) > 0 && preg_match('/\d/', $conObj["bet_finish_con_c"])) {  

    if ($_chose_team == 'H') {  

        $_strong = "+";  

    } else {  

        $_strong = "-";  

    }  

    $wagers["BET_RATIO"] = " $_strong" . $conObj["bet_finish_con_c"];  

}//$wagers["BET_RATIO"] = (strlen($conObj["bet_finish_con"])>0)?" ".$_strong.$conObj["bet_finish_con"]:" ".$_strong.$conObj["bet_finish_con_c"];
            $wagers["RATIO"] = "";
            $wagers["RATIO"] = "";
            $wagers["ORG_SCORE"] = "";
            $wagers["SCORE"] = $score;
            $wagers["RESULT"] = $result;
            $wagers["PNAME"] = $ptype;
            
    // 显示为香港(亚洲)赔率 = 小数 − 1（存储/结算仍为小数，派彩不变）
    $wagers["IORATIO"] = $this->toHkOdds($v["ioratio"]);
 

	
            $wagers["BALL_ACT_CLASS"] = $ball_act_class;
            $wagers["BALL_ACT_RET"] = $ball_act_ret;
        }
        if($isResult=="Y"){
            $resultAry = $this->getInball($v,$team_h,$team_c,$wtype_name,$isAD);
            $wagers["GTYPE_TAG"] = $gtype;
            $wagers["RESULT_TEAM"] = $resultAry["team"];
            $wagers["RESULT_DATA"] = $resultAry["data"];
        }

        return $wagers;
    }

    /**
     * 赛果处理
     * @param $v
     * @param $home 主队名
     * @param $away 客队名
     * @param $wtype_name 下注类型
     * @param string $isAD "Y":后台显示 "N":前台显示
     * @return string[]
     */
    public function getInball($v,$home,$away,$wtype_name,$isAD="N"){
        global $ls_game_ary,$artjson;
        $ug = new Util_game();
        $wtype_name = rtrim($wtype_name);
        $inball = $v["inball"];
        $wtype = strtoupper($v["wtype"]);
        $gtype = strtoupper($v["gtype"]);
        $ary = [
            "team" => "",
            "data" => ""
        ];

        //显示上半场比分
        $retime1H = str_replace(["场","場"],"",$ls_game_ary["retime1H"]);
        $retime2H = str_replace(["场","場"],"",$ls_game_ary["retime2H"]);
        if($ug->checkWtypeIsHalf_util($wtype)){
            $ary["data"] = "({$ls_game_ary["retime1H"]} {$inball})";
            if($isAD == "Y"){

                $ary["data"] = "({$retime1H} : {$inball})";
            }
            return $ary;
        }

        //显示下半场比分
        if($wtype == "RTS2"){
            $ary["data"] = "({$ls_game_ary["retime2H"]} {$inball})";
            if($isAD == "Y"){
                $ary["data"] = "({$retime2H} : {$inball})";
            }
            return $ary;
        }
        //是否为15分钟盘口
        $m15 = [
            "AM","BM","CM","DM","EM","FM","ARM","BRM","CRM","DRM","ERM","FRM",
            "AR","BR","CR","DR","ER","FR","ARE","BRE","CRE","DRE","ERE","FRE",
            "AOU","BOU","COU","DOU","EOU","FOU","AROU","BROU","CROU","DROU","EROU","FROU",
        ];
        if(in_array($wtype,$m15)){
            $ary["data"] = $wtype_name . " : " . $inball;
            if($isAD == "Y"){
                $ary["data"] = "({$ary["data"]})";
            }
            return $ary;
        }

        //冠军显示
        if($wtype == "FS" && !empty($inball)){
            $cs = "";
            $leg204= "任何时间";
            switch ($cs){
                case "en_us":
                    $cs = "_en";
                    $leg204 = "Anytime";
                    break;
                case "zh-tw":
                    $cs = "_tw";
                    $leg204= "任何時間";
                    break;
            }

            $sfsTable = Constant::S_SP;

            $ins = explode("|",$inball);
            $ins0 = str_replace(["H","C"],"",$ins[0]);
            $sgid = $ins[1];
            $where = "`sgid`='{$sgid}' AND `sfs_id` LIKE '%{$ins0}'";
            if(strtoupper($ins0)=="FS"){//冠军
                $where = "`gid`='{$sgid}' AND `sfs_id`='FS'";
            }
            $fs = $this->dbc->select("SELECT `team{$cs}` AS `team` FROM {$sfsTable} WHERE {$where} AND `result`='Y' AND `win`='Y'");

            switch ($ins0){
                case "19":
                    $data = $ls_game_ary["showRtype_pgf"]." : ";
                    break;
                case "20":
                    $data = $ls_game_ary["showRtype_pgl"]." : ";
                    //print_r("SELECT `team{$cs}` AS `team` FROM {$sfsTable} WHERE `gid`='{$v["gid"]}' AND `sfs_id` LIKE '%{$ins}' AND `result`='Y' AND `win`='Y'");exit;
                    break;
                case "204":
                    $data = $leg204.": ";
                    break;
                default:
                    $data = $ls_game_ary["showRtype_fs"]." : ";
                    break;
            }

            if($fs){
                foreach ($fs as $ff){
                    $data.=$ff["team"].";";
                }
                $ary["data"] = rtrim($data,";");
                if($isAD == "Y"){
                    $ary["data"] = "({$ary["data"]})";
                }
            }
            return $ary;
        }

        //网球 第某盘 第某局
        $tn_inball_ary = [
            "RFA01","RFA02","RFA03","RFA04","RFA05","RFA06","RFA07","RFA08","RFA09","RFA10","RFA11","RFA12","RFA13",
            "RFB01","RFB02","RFB03","RFB04","RFB05","RFB06","RFB07","RFB08","RFB09","RFB10","RFB11","RFB12","RFB13",
            "RFC01","RFC02","RFC03","RFC04","RFC05","RFC06","RFC07","RFC08","RFC09","RFC10"
            ,"RFC11","RFC12","RFC13","RFC14","RFC15","RFC16","RFC17","RFC18","RFC19","RFC20"
            ,"RFC21","RFC22","RFC23","RFC24","RFC25","RFC26","RFC27","RFC28","RFC29","RFC30"
            ,"RFC31","RFC32","RFC33","RFC34","RFC35","RFC36","RFC37","RFC38","RFC39","RFC40"
            ,"RFC41","RFC42","RFC43","RFC44","RFC45","RFC46","RFC47","RFC48","RFC49","RFC50",

            "RFD01","RFD02","RFD03","RFD04","RFD05","RFD06","RFD07","RFD08","RFD09","RFD10","RFD11","RFD12","RFD13",

            "RFE01","RFE02","RFE03","RFE04","RFE05","RFE06","RFE07","RFE08","RFE09","RFE10"
            ,"RFE11","RFE12","RFE13","RFE14","RFE15","RFE16","RFE17","RFE18","RFE19","RFE20"
            ,"RFE21","RFE22","RFE23","RFE24","RFE25","RFE26","RFE27","RFE28","RFE29","RFE30"
            ,"RFE31","RFE32","RFE33","RFE34","RFE35","RFE36","RFE37","RFE38","RFE39","RFE40"
            ,"RFE41","RFE42","RFE43","RFE44","RFE45","RFE46","RFE47","RFE48","RFE49","RFE50"
        ];

        if(in_array($wtype,$tn_inball_ary)){
            $nwtype = substr($wtype,0,3);
            $numw = substr($wtype,3,2);
            $instr = "";
            switch ($nwtype){
                case "RFA":
                    $instr.= $ls_game_ary["TN_game_a_set_{$numw}"];
                    break;
                case "RFB":
                    $instr.= $ls_game_ary["TN_game_b_set_{$numw}"];
                    break;
                case "RFC":
                    $instr.= $ls_game_ary["TN_game_c_set_{$numw}"];
                    break;
                case "RFD":
                    $instr.= $ls_game_ary["TN_game_d_set_{$numw}"];
                    break;
                case "RFE":
                    $instr.= $ls_game_ary["TN_game_e_set_{$numw}"];
                    break;
            }
            $arr = explode("|",$inball);
            $instr = str_replace(" - ","",$instr);
            $instr.= " : ";
            switch ($arr[1]){
                case "H":
                    $instr.= $home;
                    break;
                case "C":
                    $instr.= $away;
                    break;
                default:
                    $instr.= $ls_game_ary["ART_chgid_btn_cancel"];
                    break;
            }
            $ary["data"] = "({$instr})";
            return $ary;
        }

        $sk_inball_ary = [
            "F01","F02",
            "RF01","F02","F03","F04","F05","F06","F07","F08","F09","F10",
            "RF11","F12","F13","F14","F15","F16","F17","F18","F19","F20",
            "RF21","F22","F23","F24","F25","F26","F27","F28","F29","F30",
            "RF31","F32","F33","F34","F35"
        ];
        if(in_array($wtype,$sk_inball_ary)){
            $ary["data"] = $ls_game_ary["SK_".$wtype];
            $arr = explode("|",$inball);
            if(isset($arr[1])) {
                switch ($arr[1]){
                    case "H":
                        $ary["team"] = $home;
                        break;
                    case "C":
                        $ary["team"] = $away;
                        break;
                }
                $ary["data"] .= " : ".$ary["team"];
            }

            return $ary;
        }

        //和比分无关
        $n_inball_ary = [
            "BH","SP","F2G","F3G","FG","T1G","RT1G","T3G","RT3G","TK","PA","RCD","OG","OT","ROT","MW","MQ","RPS","RPF","RTW",
            "ARG","BRG","CRG","DRG","ERG","FRG","GRG","HRG","IRG","JRG","KRG","LRG","MRG","NRG","ORG",
            "RPXA","RPXB","RPXC","RPXD","RPXE","RPXF","RPXG","RPXH","RPXI","RPXJ","RPXK","RPXL","RPXM","RPXN","RPXO",
            "RNBA","RNBB","RNBC","RNBD","RNBE","RNBF","RNBG","RNBH","RNBI","RNBJ","RNBK","RNBL","RNBM","RNBN","RNBO",
            "RNC1","RNC2","RNC3","RNC4","RNC5","RNC6","RNC7","RNC8","RNC9",
            "RNCA","RNCB","RNCC","RNCD","RNCE","RNCF","RNCG","RNCH","RNCI",
            "RNCJ","RNCK","RNCL","RNCM","RNCN","RNCO","RNCP","RNCQ","RNCR",
            "RNCS","RNCT","RNCU",
            "RSHA","RSHB","RSHC","RSHD","RSHE","RSHF","RSHG","RSHH","RSHI","RSHJ","RSHK","RSHL","RSHM","RSHN","RSHO",
        ];
        if(in_array($wtype,$n_inball_ary)){
            $arr = explode("|",$inball);
            if(isset($arr[1])) {
                switch ($wtype) {
                    case "BH"://落后反超获胜
                    case "SP":
                        switch (strtoupper($arr[1])) {
                            case "HOME":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $home;
                                break;
                            case "AWAY":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $away;
                                break;
                            default:
                                $ary["team"] = $ls_game_ary["rpgln"];//无
                                $ary["data"] = $wtype_name . " : " . $ls_game_ary["rpgln"];
                                break;
                        }
                        break;
                    case "F2G"://先进2球的一方
                    case "F3G"://先进3球的一方
                        switch (strtoupper($arr[1])) {
                            case "H":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $home;
                                break;
                            case "C":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $away;
                                break;
                            default:
                                $ary["team"] = $ls_game_ary["f2gn"];//两队都没有
                                $ary["data"] = $wtype_name . " : " . $ls_game_ary["f2gn"];
                                break;
                        }
                        break;
                    case "FG"://首个进球方式
                        $a = strtolower($arr[1]);
                        $ary["team"] = $ls_game_ary["fg{$a}"];
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "T1G"://首个进球时间
                    case "RT1G":
                        $a = strtolower($arr[1]);
                        $ary["team"] = $ls_game_ary["t1g{$a}"];
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "T3G"://首个进球时间 -3项
                    case "RT3G":
                        $a = strtolower($arr[1]);
                        $ary["team"] = $ls_game_ary["t3g{$a}"];
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "TK"://开球球队
                        switch (strtoupper($arr[1])) {
                            case "H":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "C":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;
                    case "PA"://点球荣获（除开点球大战)
                    case "RCD"://红卡(球员)
                        switch (strtoupper($arr[1])) {
                            case "Y":
                                $ary["team"] = $ls_game_ary["tsy"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "N":
                                $ary["team"] = $ls_game_ary["tsn"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;
                    case "OG"://乌龙球
                    case "OT"://加时赛
                    case "ROT":
                    case "RPS"://点球大战
                        switch (strtoupper($arr[1])) {
                            case "Y":
                                $ary["team"] = $ls_game_ary["tsy"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "N":
                                $ary["team"] = $ls_game_ary["tsn"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;
                    case "MW"://胜出方法
                        $a = strtolower($arr[1]);
                        $ary["team"] = $ls_game_ary["mw{$a}"];
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "MQ"://晋级方法
                        $a = strtolower($arr[1]);
                        $aa = ["*TEAM_H*","*TEAM_C*"];
                        $bb = [$home,$away];
                        $ary["team"] = str_replace($aa,$bb,$ls_game_ary["mq{$a}"]);
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "RPF"://点球大战 - 最后结束回合
                        $a = strtolower($arr[1]);
                        $ary["team"] = $ls_game_ary["rpf{$a}"];
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "RTW"://点球大战 - 净胜球数
                        $a = strtolower($arr[1]);
                        $aa = ["*TEAM_H*","*TEAM_C*"];
                        $bb = [$home,$away];
                        $ary["team"] = str_replace($aa,$bb,$ls_game_ary["rtw{$a}"]);
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "ARG"://第一个进球
                    case "BRG"://第二个进球
                    case "CRG"://第三个进球
                    case "DRG"://第四个进球
                    case "ERG"://第五个进球
                    case "FRG"://第六个进球
                    case "GRG"://第七个进球
                    case "HRG"://第八个进球
                    case "IRG"://第九个进球
                    case "JRG"://第十个进球
                    case "KRG"://第十一个进球
                    case "LRG"://第十二个进球
                    case "MRG"://第十三个进球
                    case "NRG"://第十四个进球
                    case "ORG"://第十五个进球
                        switch (strtoupper($arr[1])) {
                            case "H":
                                $ary["team"] = $home;
                                break;
                            case "C":
                                $ary["team"] = $away;
                                break;
                            default:
                                $ary["team"] = $ls_game_ary["argn"];
                                break;
                        }
                        $ary["data"] = $wtype_name . " : " . $ary["team"];
                        break;
                    case "RPXA"://点球大战 - 第一回合
                    case "RPXB"://点球大战 - 第二回合
                    case "RPXC"://点球大战 - 第三回合
                    case "RPXD"://点球大战 - 第四回合
                    case "RPXE"://点球大战 - 第五回合
                    case "RPXF"://点球大战 - 第六回合
                    case "RPXG"://点球大战 - 第七回合
                    case "RPXH"://点球大战 - 第八回合
                    case "RPXI"://点球大战 - 第九回合
                    case "RPXJ"://点球大战 - 第十回合
                    case "RPXK"://点球大战 - 第十一回合
                    case "RPXL"://点球大战 - 第十二回合
                    case "RPXM"://点球大战 - 第十三回合
                    case "RPXN"://点球大战 - 第十四回合
                    case "RPXO"://点球大战 - 第十五回合
                        $a = str_replace("RPX","",$wtype);
                        switch ($arr[0]){
                            case "RSH{$a}":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "RSC{$a}":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            default:
                                $ary["team"] = $ls_game_ary["rpx{$a}n"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;
                    case "RSHA"://第一个点球大战
                    case "RSHB"://第二个点球大战
                    case "RSHC"://第三个点球大战
                    case "RSHD"://第四个点球大战
                    case "RSHE"://第五个点球大战
                    case "RSHF"://第六个点球大战
                    case "RSHG"://第七个点球大战
                    case "RSHH"://第八个点球大战
                    case "RSHI"://第九个点球大战
                    case "RSHJ"://第十个点球大战
                    case "RSHk"://第十一个点球大战
                    case "RSHL"://第十二个点球大战
                    case "RSHM"://第十三个点球大战
                    case "RSHN"://第十四个点球大战
                    case "RSHO"://第十五个点球大战
                        $a = str_replace("RSH","",$wtype);
                        switch ($arr[0]){
                            case "RSH{$a}":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "RSC{$a}":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            default:
                                $ary["team"] = $ls_game_ary["rsh{$a}n"];
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;

                    case "RNBA"://第一张罚牌
                    case "RNBB"://第二张罚牌
                    case "RNBC"://第三张罚牌
                    case "RNBD"://第四张罚牌
                    case "RNBE"://第五张罚牌
                    case "RNBF"://第六张罚牌
                    case "RNBG"://第七张罚牌
                    case "RNBH"://第八张罚牌
                    case "RNBI"://第九张罚牌
                    case "RNBJ"://第十张罚牌
                    case "RNBK"://第十一张罚牌
                    case "RNBL"://第十二张罚牌
                    case "RNBM"://第十三张罚牌
                    case "RNBN"://第十四张罚牌
                    case "RNBO"://第十五张罚牌
                    case "RNC1"://第一個角球
                    case "RNC2"://第二個角球
                    case "RNC3"://第三個角球
                    case "RNC4"://第四個角球
                    case "RNC5"://第五個角球
                    case "RNC6"://第六個角球
                    case "RNC7"://第七個角球
                    case "RNC8"://第八個角球
                    case "RNC9"://第九個角球
                    case "RNCA"://第十個角球
                    case "RNCB"://第十一個角球
                    case "RNCC"://第十二個角球
                    case "RNCD"://第十三個角球
                    case "RNCE"://第十四個角球
                    case "RNCF"://第十五個角球
                    case "RNCG"://第十六個角球
                    case "RNCH"://第十七個角球
                    case "RNCI"://第十八個角球
                    case "RNCJ"://第十九個角球
                    case "RNCK"://第二十個角球
                    case "RNCL"://第二十一個角球
                    case "RNCM"://第二十二個角球
                    case "RNCN"://第二十三個角球
                    case "RNCO"://第二十四個角球
                    case "RNCP"://第二十五個角球
                    case "RNCQ"://第二十六個角球
                    case "RNCR"://第二十七個角球
                    case "RNCS"://第二十八個角球
                    case "RNCT"://第二十九個角球
                    case "RNCU"://第三十個角球
                        switch (strtoupper($arr[1])) {
                            case "H":
                                $ary["team"] = $home;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                            case "C":
                                $ary["team"] = $away;
                                $ary["data"] = $wtype_name . " : " . $ary["team"];
                                break;
                        }
                        break;

                }
            }
            if($isAD == "Y"){$ary["data"] = "({$ary["data"]})";}
            return $ary;
        }

        $msStr = $v["ms"];
        $ms_name = "";
        $cs = "";
        switch ($this->param["langx"]){
            case "zh-tw":
                $cs = "_tw";
                break;
            case "en-us":
                $cs = "_en";
                break;
        }
        if($gtype != "FT" && !empty($ms)) {
            $ms = explode('_', $msStr)[1];
            $ms_str = $ls_game_ary[$gtype . "_game_" . $ms . "_set"];
            if (!empty($ms_str)) {
                if ($ms_str != $gtype . "_game_" . $ms . "_set") {
                    $ms_name = "{$ms_str}";
                }
            }
        }else{
            if(!empty($v["ptype_id"])){
                $ms_name = str_replace("-","",$v["ptype{$cs}"])." : ";
            }
        }

        $inballAry = explode("@",$inball);
        if(count($inballAry)==1){
            $inball = str_replace(":"," - ",$inball);
            $ary["data"] = "{$ms_name} {$inball}";
            if($isAD == "Y"){
                if(empty($ms_name)) {$ms_name = $artjson["ART_game_fulltime"];}
                str_replace(":","",$ms_name);
                $ary["data"] = "({$ms_name} : {$inball})";
            }
        }else{
            $i0 = str_replace(":"," - ",$inballAry[0]);
            $i1 = str_replace(":"," - ",$inballAry[1]);
            /*switch (strtoupper($arr[1])) {
                case "HOME":
                    $ary["team"] = $home;
                    $ary["data"] = $wtype_name . ":" . $home;
                    break;
                case "AWAY":
                    $ary["team"] = $away;
                    $ary["data"] = $wtype_name . ":" . $away;
                    break;
                default:
                    $ary["team"] = $ls_game_ary["rpgln"];//无
                    $ary["data"] = $wtype_name . ":" . $ls_game_ary["rpgln"];
                    break;
            }*/
            $arr = explode("|",$i1);
            if(count($arr)==1){
                $ary["data"] = $ms_name.$i0." ({$ls_game_ary["retime1H"]} $i1)";
                if($isAD == "Y"){
                    if(empty($ms_name)) {$ms_name = $artjson["ART_game_fulltime"]." : ";}
                    $ary["data"] = "({$ms_name}{$i0}) ({$retime1H} : {$i1})";
                }
            }else{
                switch (strtoupper($arr[0])){
                    case "PGF":
                    case "PGL":
                        $wtype_name = $ls_game_ary["showRtype_".strtolower($arr[0])];
                        switch (strtoupper($arr[1])) {
                            case "HOME":
                                $str = $wtype_name . " : " . $home;
                                break;
                            case "AWAY":
                                $str = $wtype_name . " : " . $away;
                                break;
                            default:
                                $str = $wtype_name . " : " . $ls_game_ary["rpgln"];
                                break;
                        }
                        $ary["data"] = $ms_name.$i0." ({$str})";
                        if($isAD == "Y"){
                            if(empty($ms_name)) {$ms_name = $artjson["ART_game_fulltime"]." : ";}
                            $ary["data"] = "({$ms_name}{$i0}) ($str)";
                        }
                        break;
                    default:
                        $ary["data"] = $ms_name.$i0." ({$ls_game_ary["retime1H"]} $i1)";
                        if($isAD == "Y"){
                            if(empty($ms_name)) {$ms_name = $artjson["ART_game_fulltime"]." : ";}
                            $ary["data"] = "({$ms_name}{$i0}) ({$retime1H} : {$i1})";
                        }
                        break;

                }

            }

        }
        return $ary;

    }

    public function get_wagers_list_bet(){
        global $ls_ary,$artjson,$ls_game_ary,$bet_status,$ls_account_ary,$bet_result,$ls_ag_ary,$result_status;
        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $log = $this->over_view_log();
        $log.= "->注单列表";
        $this->insertLog($log);
        $smn = $this->son_nid_manger();
        $_gtype = $gtype = strtoupper($this->param["gtype"]);
        $layer = $this->param["layer"];
        $gid = $this->param["gid"];
        $acc_id = $this->param["acc_id"];
        $where = "`gid`={$gid}";
        $where.= $this->hidden_layer();
        $wtype = $this->param["wtype"];
        if(strtoupper($wtype) != "MATCH"){
            $gs = ["FT","OP","BS"];
            if(!in_array($wtype,$gs)){
                $aa = ["_0","_1","_2","_3","_4","_5","_6","_7","_8","_9"];
                $wtype = str_replace($aa,'',$wtype);
                switch ($gtype){
                    case "BK":
                        $rpds = ["RPDC","RPDH"];
                        $pds = ["PDC","PDH"];
                        if(in_array($wtype,$pds)){
                            $wtype = "PD";
                        }

                        if(in_array($wtype,$rpds)){
                            $wtype = "RPD";
                        }
                        break;
                }
            }

            $rtype = $this->param["rtype"];
            $where.=" AND `rtype`='{$rtype}'";

            if($gtype == "FS"){
                $where.= " AND `wtype`='FS'";
            } else {
                $where.= " AND `gtype`='{$gtype}' AND `wtype`='{$wtype}'";
            }
        }else{
            $where.= " AND `gtype`='{$gtype}'";
        }

        if(is_numeric($acc_id) && $acc_id>0 && $layer!=Constant::ADS) {
            $accTable = Constant::T_RANK;
            switch ($layer) {
                case Constant::AD:
                    $ads = $this->dbc->select("SELECT `nid` FROM {$this->adTable} WHERE `id`={$acc_id} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");
                    if(!$ads){ return $ary; }
                    $where.= " AND `nid` LIKE '{$ads["nid"]}%'";
                    break;
                case Constant::MEM:
                    $mem = $this->dbc->select("SELECT `name` FROM {$this->memTable} WHERE `id`={$acc_id} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");
                    if(!$mem){ return $ary; }
                    $where.= " AND `m_name`='{$mem["name"]}'";
                    break;
                default:
                    $rank = $this->dbc->select("SELECT `name` FROM {$this->rankTable} WHERE `id`={$acc_id} AND `nid` LIKE '{$this->sup["nid"]}%'","Row");
                    if(!$rank){ return $ary; }
                    $name = "`ag_name`";
                    switch ($layer){
                        case Constant::D0:
                            $name = "`d0_name`";
                            break;
                        case Constant::CO:
                            $name = "`co_name`";
                            break;
                        case Constant::SU:
                            $name = "`su_name`";
                            break;
                        case Constant::AG:
                            $name = "`ag_name`";
                            break;
                    }
                    $where.= " AND {$name}='{$rank["name"]}'";
                    break;
            }
        }
        //print_r("SELECT * FROM {$this->betTable} WHERE {$where} ORDER BY `bet_time` DESC");exit;
        //注单查询
        $bet = $this->dbc->select("SELECT * FROM {$this->betTable} WHERE {$where} ORDER BY `bet_time` DESC");
        if(!$bet){ return $ary;}
        $ary = [
            "total_page" => 1,
            "page" => 1,
            "WCOUNT" => 0,
            "SGOLD0" => 0,
            "row0" => [],
            "UPPER0" => "",
            "UPPER"  => ""
        ];
        $edit_bet_layer = $this->edit_bet_layer();
        $ary["HEADER"] = $edit_bet_layer["td_head"];
        if(strtoupper($wtype) == "MATCH"){
            $ary["SVGOLD0"] = 0;
            $ary["SWIN_GOLD0"] = 0;
        }
        $arrMem = [];
        $ut = new Util_game();
        $bs = new Bet($this->param);
        foreach ($bet as $v){
            $isOK = "N";
            if($smn === false){
                $isOK = "Y";
            }else{
                $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                if(in_array($nid,$smn)){
                    $isOK = "Y";
                }
            }

            if($isOK == "Y") {
                $arr = [];
                $ary["WCOUNT"]++;
                $ary["SGOLD0"] += $v["bet_golds"];
                $td_content = "";
                $style = "style='display: inline-block;padding: 6px 0px;font-size: 14px;margin: 0 2px;cursor:pointer'";
                if (count($edit_bet_layer["td_content"]) > 0) {
                    $arr["BETTIME"] = date("Y-m-d H:i:s", $v["bet_time"]);
                    $arr["WTYPE"] = $v["wtype"];
                    $arr["GTYPE"] = $v["gtype"];
                    $arr["RTYPE"] = $v["rtype"];
                    foreach ($edit_bet_layer["td_content"] as $tk => $tv) {
                        $str_tk = "<a id='{$tk}_{$v["ID"]}' class='word_red word_bold500' {$style}>{$tv}</a> / ";
                        switch ($tk) {
                            case "manage"://注单处理
                                $select = "<select id=\"manage_{$v["ID"]}\" class='word_blue word_bold500 txtc' style='border: 0px;margin: 2px 2px 0px 2px;padding: 6px 0px;BACKGROUND-COLOR: transparent;'>";
                                foreach ($result_status[$this->langx] as $kk => $vv) {
                                    $selected = "";
                                    if ($kk == $v["status"]) {
                                        $selected = "selected";
                                    }
                                    if ($kk == 0) {
                                        $value = "正常注单";
                                        switch ($this->langx) {
                                            case "zh-tw":
                                                $value = "正常註單";
                                                break;
                                            case "en-us":
                                                $value = "Normal";
                                                break;
                                        }
                                        $select .= "<option style='color: #000000' value =\"{$kk}\" {$selected}>{$value}</option>";
                                    } else {
                                        $select .= "<option style='color: #000000' value =\"{$kk}\" {$selected}>{$vv}</option>";
                                    }

                                }
                                $select .= "</select>";
                                $td_content = rtrim($td_content, " / ");
                                $td_content .= "<br>";
                                $td_content .= $select;
                                break;
                            case "swap"://对调
                                if (count($ut->get_wtype_swap($v["wtype"], $v["rtype"], $v["gtype"])) > 0) {//允许对调
                                    $td_content .= $str_tk;
                                }
                                break;
                            case "hidden"://隐藏/显示
                                if ($v["hidden"] == 1) {
                                    $td_content .= "<a id='{$tk}_{$v["ID"]}' class='word_red word_bold500' {$style}>显示</a> / ";
                                } else {
                                    $td_content .= $str_tk;
                                }
                                break;

                            default:
                                $td_content .= $str_tk;
                                break;
                        }

                    }
                    $td_content = rtrim($td_content, " / ");
                }
                $arr["TD_CONTENT"] = $td_content;
                $arr["ID"] = $v["ID"];
                $arr["GOLD1"] = number_format($v["bet_golds"], 1);

                $name = $v["m_name"];
                if (!isset($arrMem[$name])) {
                    $arrMem[$name] = [];
                    $arrMem[$name] = $this->dbc->select("SELECT * FROM {$this->memTable} WHERE `name`='{$name}'", "Row");
                    $ary["UPPER0"] = "mid={$arrMem[$name]["id"]}&mem_user={$name}";
                    $ag = $this->dbc->select("SELECT `id` FROM {$this->rankTable} WHERE `name`='{$v["ag_name"]}'", "Row");
                    $ary["UPPER"] = "aid={$ag["id"]}";
                }
                $m = $arrMem[$name];
                if (strtoupper($wtype) == "MATCH") {
                    $ary["SVGOLD0"] += $v["isResult"] == 1 ? $v["valid_gold"] : 0;
                    $ary["SWIN_GOLD0"] += $v["isResult"] == 1 ? $v["mem_result"] : 0;
                    $arr["VGOLD"] = number_format($v["valid_gold"], 1);
                }
                $arr["ALIAS0"] = $m["alias"];
                $arr["DATETIME"] = date("Y-m-d H:i:s", $v["bet_time"]);
                $arr["DATE"] = date("m-d-Y", $v["bet_time"]);
                $arr["TIME"] = date("H:i:s", $v["bet_time"]);
                $arr["WAGERS_ID"] = substr($v["ticket_id"], 2);
                $arr["SRV_IP"] = $v["bet_ip"];
                $arr["NAME0"] = $v["m_name"];
                $arr["M_TYPE"] = $v["ltype"];
                $arr["G_TIME"] = date("m-d-Y H:i:s", $v["datetime"]);
                $arr["GOLD"] = number_format($v["bet_golds"], 1);
                $arr["K_WIN_GOLD"] = number_format($v["win_gold"], 1);
                $arr["WIN_GOLD_CLASS"] = "word_red";
                $arr["WIN_GOLD"] = "未结算";

                $arr["ODDF_TYPE"] = $ls_ag_ary["oddf_" . $v["odd_f_type"]];
                $arr["TID"] = $arr["WAGERS_ID"];
                $arr["GT"] = $ls_ag_ary["str_{$v["gtype"]}"];
                $arr["FS_DIS"] = "";
                if ($v["wtype"] == "FS" || $v["wtype"] == "SP") {
                    $arr["FS_DIS"] = "hide_item";
                }
                $arr["DIS_GT"] = "hide_item";
                $isResult = $v["isResult"] == 1 ? "Y" : "N";
                $xml = $bs->get_bet_wagers($v, $isResult, '', "Y");
                $wagers_type = getXmlNode($xml, "wtype");
                $league = getXmlNode($xml, "league");
                $team_h = getXmlNode($xml, "team_h_show");
                $team_c = getXmlNode($xml, "team_c_show");
                $team_h_ratio = getXmlNode($xml, "team_h_ratio");
                $team_c_ratio = getXmlNode($xml, "team_c_ratio");
                $score = getXmlNode($xml, "score");
                $ioratio = $this->toHkOdds(getXmlNode($xml, "ioratio"));
                $result = getXmlNode($xml, "result");
                $spread = "";
                if ($ut->checkWtypeIsOU($v["wtype"]) || $v["wtype"] == "W3") {//大小、3项让球
                    $result = getXmlNode($xml, "rtype_name");
                    $spread = getXmlNode($xml, "spread_name");
                }
                $arr["WAGERS_TYPE"] = $wagers_type;
                $tname = "<li>{$league}</li>";
                
				
				if ($v["wtype"] != "FS") {
                    $tname .= "<li>{$team_h}  v  {$team_c} <tt class=\"word_green\"></tt> <tt class=\"word_blue\">{$score}</tt></li>";
                }
				$tname .= "<li class=\"re_betdetail_liBold\">{$result} <tt class=\"word_red\"> ";
				/*if (!empty($team_h_ratio) || is_numeric($team_h_ratio)) {
					$tname .= "+{$team_h_ratio}";
				}
				if (!empty($team_c_ratio) || is_numeric($team_c_ratio)) {
					$tname .= "-{$team_c_ratio}";
				}*/
				
				if(strlen($team_h_ratio)>0){
				//print_r($v);
					if($v["chose_team"]=='H'){
						$_strong="-";
					}else{
						$_strong="+";
					}
					$tname .= $_strong.$team_h_ratio;
				}else{
					if($v["chose_team"]=='H'){
						$_strong="+";
					}else{
						$_strong="-";
					}
					$tname .= $_strong.$team_c_ratio;
				}
				$tname .=  " </tt> @ <tt class=\"word_red\">{$ioratio}</tt></li>";
                $tname .= "<li class=\"re_betdetail_liMini\">{$wagers_type}</li>";
				
                $arr["TNAME"] = $tname;
                $arr["TNAME_P"] = [];
                $arr["IS_P"] = "";
                $arr["RESULT_WL"] = "";

                if ($v["status"] == 0 && $v["cancel"] == 0) {//注单有效
                    if ($v["isResult"] == 1) {
                        $arr["WIN_GOLD"] = number_format($v["mem_result"], 1);
                        $result_data = str_replace($ls_game_ary["showtype_live"], "", getXmlNode($xml, "result_data"));
                        $arr["RESULT_WL"] = "{$bet_result[$v["result"]]}<br>{$result_data}";
                        switch ($v["result"]) {
                            case "L":
                            case "HL":
                                $arr["WIN_GOLD_CLASS"] = $arr["RESULT_WL_CLASS"] = "word_red";
                                break;
                            case "W":
                            case "HW":
                                $arr["WIN_GOLD_CLASS"] = $arr["RESULT_WL_CLASS"] = "word_green";
                                break;
                            default:
                                $arr["WIN_GOLD"] = $bet_result[$v["result"]];
                                $arr["RESULT_WL_CLASS"] = "";
                                $arr["WIN_GOLD_CLASS"] = "";
                                break;
                        }

                    }

                } else {
                    $arr["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$bet_status[$v["status"]]}</font>";
                    $arr["CANCEL_APN"] = "";
                    $arr["CANCEL_DIS"] = "style='display:none'";
                    $arr["WIN_GOLD"] = $bet_status[$v["status"]];
                    $arr["WIN_GOLD_CLASS"] = "word_red";
                    $arr["GOLD"] = "<s>" . number_format($v["bet_golds"], 1) . "</s>";
                }

                $arr["BALL_ACT"] = "";
                $arr["CANCEL_MSG"] = "";
                switch ($v["danger"]) {
                    case 3:
                        $arr["BALL_ACT"] = "<font class=\"word_green txtBold\">{$ls_account_ary["today_wagers_A"]}</font>";
                        break;
                    case 2:
                        $arr["BALL_ACT"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                        $arr["WIN_GOLD"] = $ls_account_ary["today_wagers_R"];
                        $arr["WIN_GOLD_CLASS"] = "word_red";
                        $arr["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                        $arr["CANCEL_DIS"] = "style='display:none'";
                        break;
                    case 1:
                        $arr["BALL_ACT"] = "<font class=\"word_orange txtBold\">{$ls_account_ary["today_wagers_N"]}</font>";
                        break;
                }
                $strong = "N";
                if ($v["strong"] == "H") {
                    if ($v["chose_team"] == "H") {
                        $strong = "Y";
                    } else {
                        $strong = "N";
                    }
                } else {
                    if ($v["chose_team"] == "C") {
                        $strong = "Y";
                    } else {
                        $strong = "N";
                    }
                }
                $arr["STRONG"] = $strong;

                $CON = "";
                if (!empty($team_h_ratio) || is_numeric($team_h_ratio)) {
                    $CON = $team_h_ratio;
                } else if (!empty($team_c_ratio) || is_numeric($team_c_ratio)) {
                    $CON = $team_c_ratio;
                }

                $arr["LEAGUE"] = $league;
                $arr["TEAM_H"] = $team_h;
                $arr["TEAM_C"] = $team_c;
                $arr["NUM_H"] = $v["gnum_h"];
                $arr["NUM_C"] = $v["gnum_c"];
                $arr["IORATIO"] = $ioratio;
                $arr["CON"] = $CON;
                $arr["SCORE"] = $score;
                $arr["DIF_SCORE"] = "";
                $arr["ORDER_TYPE"] = $result;
                $arr["ORDER_CON"] = $spread;


                $arr["BET_TYPE"] = $v["chose_team"];
                $arr["IN_RADIO"] = $v["mem_turn_rate"];
                $arr["ARESULT"] = number_format($v["ag_point"] / 100, 2);
                $arr["LIST_PMSG"] = "none";
                switch ($this->login_layer) {
                    case Constant::ADS:
                    case Constant::AD:
                        $arr["ADRESULT"] = number_format((100 - $v["d0_point"] - $v["co_point"] - $v["su_point"] - $v["ag_point"]) / 100, 2);
                    case Constant::D0:
                        $arr["D0RESULT"] = number_format($v["d0_point"] / 100, 2);
                    case Constant::CO:
                        $arr["CRESULT"] = number_format($v["co_point"] / 100, 2);
                    case Constant::SU:
                        $arr["SRESULT"] = number_format($v["su_point"] / 100, 2);
                        break;
                }

                $ary["row0"][] = $arr;
            }
        }
        if(strtoupper($wtype) == "MATCH"){
            $ary["SVGOLD0"] = number_format($ary["SVGOLD0"],1);
            if($ary["SWIN_GOLD0"]<0){
                $ary["SWIN_GOLD0"] = "<span class='word_lightpink'>".number_format($ary["SWIN_GOLD0"],1)."</span>";
            }else if($ary["SWIN_GOLD0"] > 0){
                $ary["SWIN_GOLD0"] = "<span class='word_lightGreen'>".number_format($ary["SWIN_GOLD0"],1)."</span>";
            }else{
                $ary["SWIN_GOLD0"] = number_format($ary["SWIN_GOLD0"],1);
            }

        }
        $ary["SGOLD0"] = number_format($ary["SGOLD0"],1);
        if($ary["WCOUNT"] == 0){
            return [
                "code" => "no_data",
                "msg" => "no data!!",
                "status" => "error"
            ];
        }
        return $ary;
    }

    /**
     * 过关注单列表
     * @return array|string[]
     */
    public function get_wagers_list_bet_parlay(){
        global $ls_ary,$artjson,$ls_game_ary,$bet_status,$ls_account_ary,$bet_p3_wtype,$bet_result,$result_status;
        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $log = $this->over_view_log();
        $log.="注单列表";
        $this->insertLog($log);
        $gtype = strtoupper($this->param["gtype"]);
        $smn = $this->son_nid_manger();
        $point = $this->get_percentage_point();
        $where = "`gtype`='{$gtype}'";
        $where.= $this->hidden_layer()." AND ";
        $where.= $this->get_where();
        $sql = "SELECT *,ROUND(`bet_golds`*{$point}/100,1) AS `gold` FROM {$this->betTable} WHERE {$where} ORDER BY `m_date` ASC,`bet_time` ASC";
        $rs = $this->dbc->select($sql);
        if(!$rs){  return $ary;}

        $ut = new Util_game();
        $bet = new Bet($this->param);
        $arr = [
            "WCOUNT" => 0,
            "GOLD"   => 0,
            "WGOLD"  => 0,
            "row0"   => [],
        ];
        $edit_bet_layer = $this->edit_bet_layer();
        $arr["HEADER"] = $edit_bet_layer["td_head"];
        foreach ($rs as $v){
            $isOK = "N";
            if($smn === false){
                $isOK = "Y";
            }else{
                $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                if(in_array($nid,$smn)){
                    $isOK = "Y";
                }
            }
            if($isOK == "Y") {
                $arr["WCOUNT"]++;
                $game = [];
                $td_content = "";
                $style = "style='display: inline-block;padding: 6px 0px;font-size: 14px;margin: 0 2px;cursor:pointer'";
                if (count($edit_bet_layer["td_content"]) > 0) {
                    $game["BETTIME"] = date("Y-m-d H:i:s", $v["bet_time"]);
                    $game["WTYPE"] = $v["wtype"];
                    $game["GTYPE"] = $v["gtype"];
                    $game["RTYPE"] = $v["rtype"];
                    $game["ID"] = $v["ID"];
                    foreach ($edit_bet_layer["td_content"] as $tk => $tv) {
                        $str_tk = "<a id='{$tk}_{$v["ID"]}' class='word_red word_bold500' {$style}>{$tv}</a> / ";
                        switch ($tk) {
                            case "manage"://注单处理
                                $select = "<select id=\"manage_{$v["ID"]}\" class='word_blue word_bold500 txtc' style='border: 0px;margin: 2px 2px 0px 2px;padding: 6px 0px;BACKGROUND-COLOR: transparent;'>";
                                foreach ($result_status[$this->langx] as $kk => $vv) {
                                    $selected = "";
                                    if ($kk == $v["status"]) {
                                        $selected = "selected";
                                    }
                                    if ($kk == 0) {
                                        $value = "正常注单";
                                        switch ($this->langx) {
                                            case "zh-tw":
                                                $value = "正常註單";
                                                break;
                                            case "en-us":
                                                $value = "Normal";
                                                break;
                                        }
                                        $select .= "<option style='color: #000000' value =\"{$kk}\" {$selected}>{$value}</option>";
                                    } else {
                                        $select .= "<option style='color: #000000' value =\"{$kk}\" {$selected}>{$vv}</option>";
                                    }

                                }
                                $select .= "</select>";
                                $td_content = rtrim($td_content, " / ");
                                $td_content .= "<br>";
                                $td_content .= $select;
                                break;
                            case "swap"://对调
                                if (count($ut->get_wtype_swap($v["wtype"], $v["rtype"], $v["gtype"])) > 0) {//允许对调
                                    $td_content .= $str_tk;
                                }
                                break;
                            case "hidden"://隐藏/显示
                                if ($v["hidden"] == 1) {
                                    $td_content .= "<a id='{$tk}_{$v["ID"]}' class='word_red word_bold500' {$style}>显示</a> / ";
                                } else {
                                    $td_content .= $str_tk;
                                }
                                break;

                            default:
                                $td_content .= $str_tk;
                                break;
                        }

                    }
                }
                $game["TD_CONTENT"] = $td_content;
                $game["ID"] = $v["ID"];
                $game["GOLD1"] = number_format($v["bet_golds"], 1);

                $game["TID"] = str_replace("P3", "", $v["ticket_id"]);
                $game["DATE"] = date("m-d-Y", $v["bet_time"]);
                $game["TIME"] = date("H:i:s", $v["bet_time"]);
                $game["DATETIME"] = date("Y-m-d H:i:s", $v["bet_time"]);
                $game["GT"] = $ls_ary["gtype_" . strtolower($gtype)];
                $game["SRV_IP"] = $v["bet_ip"];
                $game["M_TYPE"] = $v["ltype"];
                $game["IN_RADIO"] = $v["mem_turn_rate"];
                $game["ODDF_TYPE"] = $ls_ary["oddf_" . $v["odd_f_type"]];

                $mem = $this->dbc->select("SELECT `name`,`alias` FROM {$this->memTable} WHERE `nid`='{$v["nid"]}'", "Row");
                $game["NAME0"] = $mem["name"];
                $game["ALIAS0"] = $mem["alias"];


                $game["WIN_GOLD_CLASS"] = "word_black word_bold";
                $game["delTag"] = "N";
                $game["CANCEL_MSG"] = "";
                $game["SETTLED"] = "N";
                $game["BALL_ACT"] = "";
                $game["FROM"] = "totalbet_parlay";

                $game["IS_P"] = "单式过关";
                $game["TNAME"] = "单式过关 (3 串 1 )";
                $game["WAGERS_TYPE"] = "单式过关";

                if ($v["status"] == 0 && $v["cancel"] == 0) {//注单有效
                    $arr["GOLD"] += $v["gold"];
                    $arr["WGOLD"] += $v["win_gold"];
                    $game["GOLD"] = number_format($v["gold"], 1);
                    $game["WIN_GOLD"] = number_format($v["win_gold"], 1);

                    $p3 = $this->dbc->select("SELECT * FROM {$this->betTable_p3} WHERE `p3id`={$v["ID"]}");
                    if ($p3) {
                        $cou = count($p3);
                        $game["TNAME_P"] = [];
                        $isRB = "N";
                        $isDanger = "N";
                        foreach ($p3 as $v3) {
                            $ary3 = [];
                            $xml = $bet->get_bet_wagers($v3, 0, 'P3', "Y");
                            $wagers_type = getXmlNode($xml, "wtype_sub");
                            $league = getXmlNode($xml, "league");
                            $team_h = getXmlNode($xml, "team_h_show");
                            $team_c = getXmlNode($xml, "team_c_show");
                            $team_h_ratio = getXmlNode($xml, "team_h_ratio");
                            $team_c_ratio = getXmlNode($xml, "team_c_ratio");
                            $score = getXmlNode($xml, "score");
                            $ioratio = $this->toHkOdds(getXmlNode($xml, "ioratio"));
                            $result = getXmlNode($xml, "result");
                            $spread = "";
                            $strong = "N";
                            if ($v3["strong"] == "H") {
                                if ($v3["chose_team"] == "H") {
                                    $strong = "Y";
                                } else {
                                    $strong = "N";
                                }
                            } else {
                                if ($v3["chose_team"] == "C") {
                                    $strong = "Y";
                                } else {
                                    $strong = "N";
                                }
                            }
                            $CON = "";
                            if (!empty($team_h_ratio) || is_numeric($team_h_ratio)) {
                                $CON = $team_h_ratio;
                            } else if (!empty($team_c_ratio) || is_numeric($team_c_ratio)) {
                                $CON = $team_c_ratio;
                            }

                            if ($ut->checkWtypeIsOU($v3["wtype"]) || $v3["wtype"] == "W3") {//大小、3项让球
                                $result = getXmlNode($xml, "rtype_name");
                                $spread = getXmlNode($xml, "spread_name");
                            }
                            if (count($edit_bet_layer["td_content"]) > 0) {
                                $ary3["WTYPE"] = $v3["wtype"];
                                $ary3["GTYPE"] = $v3["gtype"];
                                $ary3["RTYPE"] = $v3["rtype"];
                                $ary3["ID"] = $v3["ID"];
                            }
                            $ary3["WAGERS_TYPE"] = $wagers_type;
                            $ary3["LEAGUE"] = $league;
                            $ary3["G_TIME"] = date("m-d-Y H:i:s", $v3["datetime"]);
                            $ary3["NUM_H"] = $v3["gnum_h"];
                            $ary3["NUM_C"] = $v3["gnum_c"];
                            $ary3["TEAM_H"] = $team_h;
                            $ary3["TEAM_C"] = $team_c;
                            $ary3["ORDER_TYPE"] = $result;
                            $ary3["test"] = $result;
                            $ary3["ORDER_CON"] = $spread;
                            $ary3["CON"] = $CON;
                            $ary3["IORATIO"] = $ioratio;
                            $ary3["STRONG"] = $strong;
                            $ary3["SCORE"] = $score;
                            $ary3["DIF_SCORE"] = "";
                            $ary3["DATE"] = date("m-d", strtotime($v3["m_date"]));
                            $ary3["RESULT_WL"] = "注单平局<br>(全场 :   )";
                            $ary3["BET_TYPE"] = $v3["chose_team"];
                            if ($v3["status"] == 0 && $v3["cancel"] == 0) {//注单有效
                                if ($v3["isResult"] == 1) {
                                    $result_data = str_replace($ls_game_ary["showtype_live"], "", getXmlNode($xml, "result_data"));
                                    $ary3["GAME_SCORE"] = "({$result_data})";
                                    $ary3["RESULT_WL"] = "{$bet_result[$v3["result"]]}<br>{$result_data}";
                                    switch ($v3["result"]) {
                                        case "L":
                                        case "HL":
                                            $ary3["RESULT_WL_CLASS"] = "word_red";
                                            break;
                                        case "W":
                                        case "HW":
                                            $ary3["RESULT_WL_CLASS"] = "word_green";
                                            break;
                                        default:
                                            $ary3["RESULT_WL_CLASS"] = "";
                                            break;
                                    }
                                }

                            } else {
                                $ary3["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$bet_status[$v3["status"]]}</font>";
                                $ary3["CANCEL_APN"] = "";
                                $ary3["CANCEL_DIS"] = "style='display:none'";
                            }

                            switch ($v3["danger"]) {
                                case 3:
                                    $ary3["BALL_ACT"] = "<font class=\"word_green txtBold\">{$ls_account_ary["today_wagers_A"]}</font>";
                                    break;
                                case 2:
                                    $ary3["BALL_ACT"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                                    $ary3["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$ls_account_ary["today_wagers_R"]}</font>";
                                    $ary3["CANCEL_DIS"] = "style='display:none'";
                                    break;
                                case 1:
                                    $ary3["BALL_ACT"] = "<font class=\"word_orange txtBold\">{$ls_account_ary["today_wagers_N"]}</font>";
                                    break;
                            }


                            $ary3["RESULT_DATA"] = null;
                            $ary3["DEL_CLASS"] = "";

                            if ($v3["rb"] == "Y") {
                                $isRB = "Y";
                            }
                            $game["TNAME_P"][] = $ary3;
                        }
                        $game["WAGERS_TYPE"] = $artjson["ART_today_parlay"];
                        $game["IS_P"] = $bet_p3_wtype[$isRB];
                        $game["TNAME"] = "{$game["IS_P"]} ({$cou} {$artjson["ART_today_in"]} 1)";
                        if ($isRB == "Y") {
                            $game["BALL_ACT"] = "<font class=\"word_green txtBold\">{$ls_account_ary["today_wagers_A"]}</font>";
                        }
                        $game["RESULT_WL"] = "{$bet_result[$v["result"]]}";
                    }
                } else {
                    $game["delTag"] = "Y";
                    $game["CANCEL_MSG"] = "<font class=\"word_red txtBold\">{$bet_status[$v["status"]]}</font>";
                    $game["CANCEL_APN"] = "";
                    $game["CANCEL_DIS"] = "style='display:none'";
                    $game["WIN_GOLD"] = $bet_status[$v["status"]];
                    $game["WIN_GOLD_CLASS"] = "word_red";
                    $game["GOLD"] = "<s>" . number_format($v["GOLD"], 1) . "</s>";
                }
                $arr["row0"][] = $game;
            }
        }
        $arr["GOLD"] = number_format($arr["GOLD"],1);
        $arr["WGOLD"] = number_format($arr["WGOLD"],1);
        if($arr["WCOUNT"]==0){
            $arr = [
                "code" => "no_data",
                "msg" => "no data!!",
                "status" => "error"
            ];
        }
        return $arr;
    }

    /**
     * 注单列表
     * @return string[]
     */
    public function get_league_wager(){

        $ary = [
            "code" => "no_data",
            "msg" => "no data!!",
            "status" => "error"
        ];
        $log = $this->over_view_log();
        $this->insertLog($log);
        $arr = $this->get_match_league_wager();
        if($arr=="no"){
            return $ary;
        }

        return $arr;
    }

    public function over_view_log(){
        global $sport_tables;
        $wtype = isset($this->param["wtype"]) ? strtoupper($this->param["wtype"]) : "";
        if($wtype == "MATCH"){
            $str = "操盘->赛程";
        } else {
            $str = "即时注单->";
            $gtype = strtoupper($this->param["gtype"]);
            $session = isset($this->param["session"]) ? strtoupper($this->param["session"]) : "";
            switch ($session) {
                case "RB":
                    $str .= "滚球";
                    break;
                case "FU":
                    $str .= "早餐";
                    break;
                case "PL":
                    $str .= "已开赛";
                    break;
                case "P":
                    $str .= "过关";
                    break;
                case "FS":
                    $str .= "冠军";
                    break;
                case "FT":
                    $str .= "今日";
                    break;
            }
            $str .= "[{$sport_tables[$gtype]["name"]}]";
        }
        return $str;
    }



    /**
     * 对应赛事查询
     * @return array|null
     */
    public function get_match_league_wager(){
        $smn = $this->son_nid_manger();
        $gtype = strtoupper($this->param["gtype"]);
        $session = strtoupper($this->param["session"]);
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $table = $this->get_match_table($gtype);
        if($this->param["symbol"]=="match"){
            $gidm = $this->param["gidm"];
            $where = "`hidden`=0 AND `gtype`='{$gtype}' AND `gidm`='{$gidm}'";
            $filed = "ROUND(SUM(`bet_golds`),1) AS `gold`,COUNT(`ID`) AS `count`";
        }else{
            $point = $this->get_percentage_point();
            $where = "`hidden`=0 AND `gtype`='{$gtype}' AND ";
            $where.= $this->get_where();
            $filed = "ROUND(SUM(`bet_golds`*{$point}/100),1) AS `gold`,COUNT(`ID`) AS `count`";
            if($session=="PL") {
                $filed .= ",ROUND(SUM(IF(`showtype`='live',`bet_golds`*{$point}/100,0)),1) AS `gold_RB`,SUM(IF(`showtype`='live',1,0)) AS `count_RB`";
                $filed .= ",ROUND(SUM(IF(`showtype`='today' || (`showtype`='fs' && `gnum_c`>0),`bet_golds`*{$point}/100,0)),1) AS `gold_FT`,SUM(IF(`showtype`='today' || (`wtype`='FS' && `gnum_c`>0),1,0)) AS `count_FT`";
            }

        }

        $filed.= ",CONCAT('lid_',`lid`) AS `league`,`lid`,`gidm`,CONCAT('gidm_',`gidm`) AS `game`,`gid` AS `m_gid`";
        $filed.= ",`league{$css}` AS `league_name`,`league{$css}` AS `league_sname`";
        $filed.= ",`team_h{$css}` AS `team_h`,`team_c{$css}` AS `team_c`,`nid`";
        $sql = "SELECT {$filed} FROM {$this->betTable} ";

        if($smn === false){
            $sql.= "WHERE {$where}  GROUP BY `gidm`";
            $rs = $this->dbc->select($sql);
            if($rs){
                $ary = [
                    "all_count" => 0,
                    "all_gold"  => 0,
                    "gtype" => $gtype
                ];
                $leaAry = [];
                foreach ($rs as $v){
                    $match =  $this->get_match($v["gidm"]);
                    if($match != "no") {
                        if(!isset($leaAry[$v["lid"]])) {
                            $leaAry[$v["lid"]]["league"] = $v["league"];
                            $leaAry[$v["lid"]]["lid"] = $v["lid"];
                            $leaAry[$v["lid"]]["league_name"] = $match["league"];
                            $leaAry[$v["lid"]]["league_sname"] = $match["league"];
                            unset($match["league"]);
                            $leaAry[$v["lid"]]["event"] = "";
                            $leaAry[$v["lid"]]["count"] = 0;
                            $leaAry[$v["lid"]]["gold"] = 0;
                        }
                        $leaAry[$v["lid"]]["count"]+= $v["count"];
                        $leaAry[$v["lid"]]["gold"]+= $v["gold"];
                        $ary["all_count"]+= $v["count"];
                        $ary["all_gold"]+= $v["gold"];

                        $game = [];
                        $game["game"] = $v["game"];
                        $game["gidm"] = $v["gidm"];
                        $game["m_gid"]= $v["m_gid"];
                        $game["game_over"] = "N";
                        $game["team_h"] = $match["team_h"];unset($match["team_h"]);
                        $game["team_c"] = $match["team_c"];unset($match["team_c"]);

                        if($session == "PL") {
                            $game["wager_count_FT"] = $v["count_FT"];
                            $game["wager_gold_FT"] = $v["gold_FT"];
                            $game["more_count_FT"] = $v["count_FT"];

                            $game["wager_count_RB"] = $v["count_RB"];
                            $game["wager_gold_RB"] = $v["gold_RB"];
                            $game["more_count_RB"] = $v["count_RB"];
                        }else{
                            $game["wager_count"] = $v["count"];
                            $game["wager_gold"] = $v["gold"];
                            $game["more_count"] = $v["count"];
                        }
                        $game["gold"] = $v["gold"];
                        $game["count"] = $v["count"];


                        $game["live"] = $match["live"];
                        unset($match["live"]);
                        $game["midfield"] = $match["midfield"];
                        unset($match["midfield"]);
                        $game["game_over"] = $match["game_over"];
                        unset($match["game_over"]);
                        $game["session"] = $match;
                        $leaAry[$v["lid"]]["game"][] = $game;
                    }
                }
                $ary["league"] = array_values($leaAry);
                return $ary;
            }else{
                return "no";
            }
        }else{ //子账号 管理下线
            $sql.= "WHERE {$where}  GROUP BY `m_name`,`gidm`";
            $rs = $this->dbc->select($sql);
            if(!$rs){return "no";}
            $ary = [
                "all_count" => 0,
                "all_gold"  => 0,
                "gtype" => $gtype
            ];
            $leaAry = [];
            $ary["league"] = array_values($leaAry);
            $game = [];
            foreach ($rs as $v){
                $match =  $this->get_match($v["gidm"]);
                if($match != "no") {
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)) {
                        if (!isset($leaAry[$v["lid"]])) {
                            $leaAry[$v["lid"]]["league"] = $v["league"];
                            $leaAry[$v["lid"]]["lid"] = $v["lid"];
                            $leaAry[$v["lid"]]["league_name"] = $match["league"];
                            $leaAry[$v["lid"]]["league_sname"] = $match["league"];
                            unset($match["league"]);
                            $leaAry[$v["lid"]]["event"] = "";
                            $leaAry[$v["lid"]]["count"] = 0;
                            $leaAry[$v["lid"]]["gold"] = 0;
                        }
                        $leaAry[$v["lid"]]["count"] += $v["count"];
                        $leaAry[$v["lid"]]["gold"] += $v["gold"];
                        $ary["all_count"] += $v["count"];
                        $ary["all_gold"] += $v["gold"];

                        if(!isset($game[$v["gidm"]])){
                            $game[$v["gidm"]]["lid"] = $v["lid"];
                            $game[$v["gidm"]]["game"] = $v["game"];
                            $game[$v["gidm"]]["gidm"] = $v["gidm"];
                            $game[$v["gidm"]]["m_gid"] = $v["m_gid"];
                            $game[$v["gidm"]]["game_over"] = "N";
                            $game[$v["gidm"]]["team_h"] = $match["team_h"];
                            unset($match["team_h"]);
                            $game[$v["gidm"]]["team_c"] = $match["team_c"];
                            unset($match["team_c"]);
                            $game[$v["gidm"]]["live"] = $match["live"];
                            unset($match["live"]);
                            $game[$v["gidm"]]["midfield"] = $match["midfield"];
                            unset($match["midfield"]);
                            $game[$v["gidm"]]["game_over"] = $match["game_over"];
                            unset($match["game_over"]);
                            $game[$v["gidm"]]["session"] = $match;
                            if ($session == "PL") {
                                $game[$v["gidm"]]["wager_count_FT"] = 0;
                                $game[$v["gidm"]]["wager_gold_FT"] = 0;
                                $game[$v["gidm"]]["more_count_FT"] = 0;

                                $game[$v["gidm"]]["wager_count_RB"] = 0;
                                $game[$v["gidm"]]["wager_gold_RB"] = 0;
                                $game[$v["gidm"]]["more_count_RB"] = 0;
                            } else {
                                $game[$v["gidm"]]["wager_count"] = 0;
                                $game[$v["gidm"]]["wager_gold"] = 0;
                                $game[$v["gidm"]]["more_count"] = 0;
                            }
                            $game[$v["gidm"]]["gold"] = 0;
                            $game[$v["gidm"]]["count"] = 0;
                        }


                        if ($session == "PL") {
                            $game[$v["gidm"]]["wager_count_FT"] += $v["count_FT"];
                            $game[$v["gidm"]]["wager_gold_FT"] += $v["gold_FT"];
                            $game[$v["gidm"]]["more_count_FT"] += $v["count_FT"];

                            $game[$v["gidm"]]["wager_count_RB"] += $v["count_RB"];
                            $game[$v["gidm"]]["wager_gold_RB"] += $v["gold_RB"];
                            $game[$v["gidm"]]["more_count_RB"] += $v["count_RB"];
                        } else {
                            $game[$v["gidm"]]["wager_count"] += $v["count"];
                            $game[$v["gidm"]]["wager_gold"] += $v["gold"];
                            $game[$v["gidm"]]["more_count"] += $v["count"];
                        }
                        $game[$v["gidm"]]["gold"] += $v["gold"];
                        $game[$v["gidm"]]["count"] += $v["count"];
                    }
                }
            }

            if(count($game)>0){

                foreach ($game as $v){
                    $lid = $v["lid"];
                    unset($v["lid"]);
                    $leaAry[$lid]["game"][] = $v;
                }
                $ary["league"] = array_values($leaAry);
                return $ary;
            }else{
                return "no";
            }

        }

    }


    /**
     * 获取赛事
     * @param $gidm
     * @return array|string
     */
    public function get_match($gidm){
        global $ls_game_ary;
        $css = "_cn";
        $css1= "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                $css1 = "_tw";
                break;
            case "en-us":
                $css = "_en";
                $css1 = "_en";
                break;
        }
        $gtype = strtoupper($this->param["gtype"]);
        $session = strtoupper($this->param["session"]);
        $table = $this->get_match_table($gtype);
        if($gtype != "FS"){
            $table_xml = $this->get_match_table_xml($gtype);
        }

        $where = "`gidm`='{$gidm}' AND `master`='Y'";
        $field = "`a`.`status`,`a`.`m_date` AS `date`,FROM_UNIXTIME(`datetime`,'%T') AS `time`,`m_time`,`is_inball`,`datetime`,`league{$css1}` AS `league`,`team_h{$css1}` AS `team_h`,`team_c{$css1}` AS `team_c`";
        if($session=="PL"){
            $field.= ",`inball_more{$css1}` AS `inball_more`";
        }

        switch ($gtype){
            case "BK":
            case "BM":
            case "TT":
            case "TN":
            case "VB":
            case "SK":
            case "OP":
                $where.= " AND LENGTH(`gnum_h`)=5";
                break;
            case "BS":
                $where.= " AND LENGTH(`gnum_h`)=5 AND `ptype_id`=0";
                break;
        }
        if(isset($table_xml)){
            $field.=",`a`.`gid`";
            switch($session){
                case "RB":
                case "PL":
                    $field.= ",`re{$css}` AS `xml`";
                    break;
                case "FT":
                case "FU":
                    $field.= ",`r{$css}` AS `xml`";
                    break;
                case "P":
                    $field.= ",`p3{$css}` AS `xml`";
                    break;
            }
            $rs = $this->dbs->select("SELECT {$field} FROM {$table} AS `a` JOIN {$table_xml} AS `x` ON `a`.`gid`=`x`.`gid` WHERE {$where}","Row");
        }else{
            $field.=",`gid`";
            $rs = $this->dbs->select("SELECT {$field} FROM {$table} WHERE {$where}","Row");
        }

        if(!$rs){ return "no";}
        $ary = [
            "midfield" => "N",
            "live" => "N",
            "game_over" => "N",
            "date" => $rs["date"],
            "gid"  => $rs["gid"],
            "time" => $rs["time"],
            "league"=>$rs["league"],
            "team_h"=>$rs["team_h"],
            "team_c"=>$rs["team_c"]
        ];
        $tt = 2*60*60;
        if($gtype == "BS"){
            $tt = 6 * 60 * 60;
        }
        if($rs["is_inball"]==1){ //两小时之后 或 已经有比分
            $ary["game_over"] = "Y";
        }


        if(isset($rs["xml"])){
            $xml = de_string($rs["xml"]);
            $live = getXmlNode($xml,"Live");
            $midfield = getXmlNode($xml,"midfield");
            $is_OT = getXmlNode($xml,"sw_OT");
            $ary["live"] = empty($live) ? "N" : $live;
            $ary["midfield"] = empty($midfield) ? "N" : $midfield;
            $ary["best"] = getXmlNode($xml,"best");
            $ary["is_OT"] = empty($is_OT) || $is_OT=="N" ? "false" : "true";
            $ary["game_cancel"] = "N";
            if(($session == "RB") && $ary["game_over"] == "N"){
                switch ($gtype){
                    case "FT":
                        unset($ary["time"]);
                        unset($ary["date"]);
                        $ary["start"] = "Y";
                        $retime = explode("^",getXmlNode($xml,"re_time"));
                        $ary["retime"] = $retime[0];
                        $ary["sec"] = 0;
                        if(!empty($retime[1])){
                            $sc =explode(":",str_replace('\'','',$retime[1]));
                            if(count($sc)==2){
                                $ary["sec"] = $sc[1];
                                $ary["reminute"] = $sc[0];
                            }
                        }
                        $arr = [
                            "score_h" => "score_h",
                            "score_c" => "score_c",
                            "redcard_h" => "redcard_h",
                            "redcard_c" => "redcard_c",
                            "lastScore" => "score_new"
                        ];
                        foreach ($arr as $k => $v){

                            $ary[$k] = getXmlNode($xml,$v);
                            if($k!="lastScore"){
                                $ary[$k] = empty($ary[$k]) ? 0 : $ary[$k];
                            }
                        }
                        break;
                    case "BK":
                        $arr = [
                            "t_status"=>"t_status",
                            "half_time"=>"HalfTime",
                            "score_c" => "sc_FT_A",
                            "score_h" => "sc_FT_H",
                            "sc_OT_A" => "sc_OT_A",
                            "sc_OT_H" => "sc_OT_H",
                            "sc_H2_A" => "sc_H2_A",
                            "sc_H2_H" => "sc_H2_H",
                            "sc_H1_A" => "sc_H1_A",
                            "sc_H1_H" => "sc_H1_H",
                            "sc_Q4_A" => "sc_Q4_A",
                            "sc_Q4_H" => "sc_Q4_H",
                            "sc_Q3_A" => "sc_Q3_A",
                            "sc_Q3_H" => "sc_Q3_H",
                            "sc_Q2_A" => "sc_Q2_A",
                            "sc_Q2_H" => "sc_Q2_H",
                            "sc_Q1_A" => "sc_Q1_A",
                            "sc_Q1_H" => "sc_Q1_H",
                            "se_type" => "se_type",
                            "se_now"  => "se_now",
                            "sc_new"  => "sc_new",
                            "t_count" => "t_count",
                            "t_end" => "t_end"
                        ];
                        //print_R($xml);exit;
                        foreach ($arr as $k => $v){
                            $ary[$k] = getXmlNode($xml,$v);
                        }

                        $ary["t_type"]  = 10;

                        break;
                    case "TN":
                        $arr = [
                            "sc_1st_H","sc_1st_A",
                            "sc_2nd_H","sc_2nd_A",
                            "sc_3th_H","sc_3th_A",
                            "sc_4th_H","sc_4th_A",
                            "sc_5th_H","sc_5th_A",
                            "sc_set_H","sc_set_A",
                            "sc_game_H","sc_game_A",
                            "W_delay","server_sw"
                        ];
                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $se_now = 1;
                        $nd = $ary["sc_2nd_H"]+$ary["sc_2nd_A"];
                        $th3 = $ary["sc_3th_H"]+$ary["sc_3th_A"];
                        $th4 = $ary["sc_4th_H"]+$ary["sc_4th_A"];
                        $th5 = $ary["sc_5th_H"]+$ary["sc_5th_A"];
                        if($nd>0 && $th3==0){
                            $se_now = 2;
                        }elseif($th3>0 && $th4==0){
                            $se_now = 3;
                        }elseif($th4>0 && $th5==0){
                            $se_now = 4;
                        }elseif($th5>0){
                            $se_now = 5;
                        }
                        $ary["se_now"] = $se_now;
                        $ary["se_now_name"] = $ls_game_ary["TN_game_{$se_now}_set"];
                        break;
                    case "VB":
                        $ary["start"] = getXmlNode($xml,"gopen");
                        $ary["retime"] = "1H";
                        $ary["reminute"] = "";

                        $arr = [
                            "score_h","score_c",
                            "sc_1st_H","sc_1st_A",
                            "sc_2nd_H","sc_2nd_A",
                            "sc_3th_H","sc_3th_A",
                            "sc_4th_H","sc_4th_A",
                            "sc_5th_H","sc_5th_A",
                            "sc_set_H","sc_set_A",
                            "sc_game_H","sc_game_A",
                            "server_sw"
                        ];

                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $se_now = 1;
                        $nd = $ary["sc_2nd_H"]+$ary["sc_2nd_A"];
                        $th3 = $ary["sc_3th_H"]+$ary["sc_3th_A"];
                        $th4 = $ary["sc_4th_H"]+$ary["sc_4th_A"];
                        $th5 = $ary["sc_5th_H"]+$ary["sc_5th_A"];
                        if($nd>0 && $th3==0){
                            $se_now = 2;
                        }elseif($th3>0 && $th4==0){
                            $se_now = 3;
                        }elseif($th4>0 && $th5==0){
                            $se_now = 4;
                        }elseif($th5>0){
                            $se_now = 5;
                        }
                        $ary["se_now"] = $se_now;
                        $se_now+=2;
                        $ary["se_now_name"] = $ls_game_ary["VB_game_{$se_now}_set"];
                        break;
                    case "TT":
                    case "BM":
                        $arr = [
                            "sc_1st_H","sc_1st_A",
                            "sc_2nd_H","sc_2nd_A",
                            "sc_3th_H","sc_3th_A",
                            "sc_4th_H","sc_4th_A",
                            "sc_5th_H","sc_5th_A",
                            "sc_6th_H","sc_6th_A",
                            "sc_7th_H","sc_7th_A",
                            "sc_game_H","sc_game_A",
                            "W_delay","server_sw"
                        ];
                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $se_now = 1;
                        $nd = $ary["sc_2nd_H"]+$ary["sc_2nd_A"];
                        $th3 = $ary["sc_3th_H"]+$ary["sc_3th_A"];
                        $th4 = $ary["sc_4th_H"]+$ary["sc_4th_A"];
                        $th5 = $ary["sc_5th_H"]+$ary["sc_5th_A"];
                        $th6 = $ary["sc_6th_H"]+$ary["sc_6th_A"];
                        $th7 = $ary["sc_7th_H"]+$ary["sc_7th_A"];
                        if($nd>0 && $th3==0){
                            $se_now = 2;
                        }elseif($th3>0 && $th4==0){
                            $se_now = 3;
                        }elseif($th4>0 && $th5==0){
                            $se_now = 4;
                        }elseif($th5>0 && $th6==0){
                            $se_now = 5;
                        }elseif($th6>0 && $th7==0){
                            $se_now = 6;
                        }elseif($th7>0){
                            $se_now = 7;
                        }
                        $ary["se_now"] = $se_now;
                        $se_now+=1;
                        $ary["se_now_name"] = $ls_game_ary["TT_game_{$se_now}_set"];
                        break;
                    case "BS":
                        $ary["start"] = getXmlNode($xml,"gopen");
                        $ary["retime"] = "1H";
                        $ary["reminute"] = "";
                        $ary["lastScore"] = getXmlNode($xml,"score_new");
                        $arr = [
                            "sc_1st_H","sc_1st_A",
                            "sc_2nd_H","sc_2nd_A",
                            "sc_3th_H","sc_3th_A",
                            "sc_4th_H","sc_4th_A",
                            "sc_5th_H","sc_5th_A",
                            "sc_6th_H","sc_6th_A",
                            "sc_7th_H","sc_7th_A",
                            "sc_8th_H","sc_8th_A",
                            "sc_9th_H","sc_9th_A",
                            "sc_ot_H","sc_ot_A",
                            "sc_ov_H","sc_ov_A",
                            "base_1B","base_2B","base_3B",
                            "base_hh","part","outCount"
                        ];
                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $ary["score_h"] = "".getXmlNode($xml,"sc_game_H");
                        $ary["score_c"] = "".getXmlNode($xml,"sc_game_A");
                        break;
                    case "OP":
                        $ary["start"] = getXmlNode($xml,"gopen");
                        $ary["retime"] = "1H";
                        $ary["reminute"] = "";
                        $ary["lastScore"] = getXmlNode($xml,"score_new");
                        $arr = [
                            "redcard_h","redcard_c"
                        ];
                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $sh = getXmlNode($xml,"sc_game_H");
                        $sc = getXmlNode($xml,"sc_game_C");
                        $ary["score_h"] = empty($sh) ? 0 : $sh;
                        $ary["score_c"] = empty($sc) ? 0 : $sc;
                        break;
                    case "SK":
                        $arr = [
                            "sc_1st_H","sc_1st_A",
                            "sc_2nd_H","sc_2nd_A",
                            "sc_3th_H","sc_3th_A",
                            "sc_4th_H","sc_4th_A",
                            "sc_5th_H","sc_5th_A",
                            "sc_6th_H","sc_6th_A",
                            "sc_game_H","sc_game_A",
                            "W_delay","server_sw"
                        ];
                        foreach ($arr as  $v){
                            $ary[$v] = "".getXmlNode($xml,$v);
                        }
                        $se_now = 1;
                        $nd = $ary["sc_2nd_H"]+$ary["sc_2nd_A"];
                        $th3 = $ary["sc_3th_H"]+$ary["sc_3th_A"];
                        $th4 = $ary["sc_4th_H"]+$ary["sc_4th_A"];
                        $th5 = $ary["sc_5th_H"]+$ary["sc_5th_A"];
                        $th6 = $ary["sc_6th_H"]+$ary["sc_6th_A"];
                        if($nd>0 && $th3==0){
                            $se_now = 2;
                        }elseif($th3>0 && $th4==0){
                            $se_now = 3;
                        }elseif($th4>0 && $th5==0){
                            $se_now = 4;
                        }elseif($th5>0 && $th6==0){
                            $se_now = 5;
                        }elseif($th6>0){
                            $se_now = 6;
                        }
                        $ary["se_now"] = $se_now;
                        $se_now+=1;
                        $ary["se_now_name"] = $ls_game_ary["SK_game_{$se_now}_set"];
                        break;
                }
            }else{
                if($session == "PL"){
                    switch ($gtype){
                        case "FT":
                        case "OP":
                            $ary["result_FT_H"] = null;
                            $ary["result_FT_C"] = null;
                            $ary["result_1H_H"] = null;
                            $ary["result_1H_C"] = null;
                            break;
                        case "BK":
                            $ary["result_FT_H"] = null;
                            $ary["result_FT_C"] = null;
                            $ary["result_OT_A"] = null;
                            $ary["result_OT_H"] = null;
                            $ary["result_H2_A"] = null;
                            $ary["result_H2_H"] = null;
                            $ary["result_H1_A"] = null;
                            $ary["result_H1_H"] = null;
                            $ary["result_Q4_A"] = null;
                            $ary["result_Q4_H"] = null;
                            $ary["result_Q3_A"] = null;
                            $ary["result_Q3_H"] = null;
                            $ary["result_Q2_A"] = null;
                            $ary["result_Q2_H"] = null;
                            $ary["result_Q1_A"] = null;
                            $ary["result_Q1_H"] = null;
                            break;
                        case "TN":
                            $ary["result_1_H"] = null;
                            $ary["result_1_C"] = null;
                            $ary["result_2_H"] = null;
                            $ary["result_2_C"] = null;
                            $ary["result_3_H"] = null;
                            $ary["result_3_C"] = null;
                            $ary["result_4_H"] = null;
                            $ary["result_4_C"] = null;
                            $ary["result_5_H"] = null;
                            $ary["result_5_C"] = null;
                            $ary["result_0_H"] = null;
                            $ary["result_0_C"] = null;
                            $ary["result_6_H"] = null;
                            $ary["result_6_C"] = null;
                            break;
                        case "VB":
                            $ary["result_1_H"] = null;
                            $ary["result_1_C"] = null;
                            $ary["result_2_H"] = null;
                            $ary["result_2_C"] = null;
                            $ary["result_3_H"] = null;
                            $ary["result_3_C"] = null;
                            $ary["result_4_H"] = null;
                            $ary["result_4_C"] = null;
                            $ary["result_5_H"] = null;
                            $ary["result_5_C"] = null;
                            $ary["result_0_H"] = null;
                            $ary["result_0_C"] = null;
                            $ary["result_6_H"] = null;
                            $ary["result_6_C"] = null;
                            $ary["result_7_H"] = null;
                            $ary["result_7_C"] = null;
                            break;
                        case "TT":
                            $ary["result_set_H"] = null;
                            $ary["result_set_A"] = null;
                            $ary["result_point_H"] = null;
                            $ary["result_point_A"] = null;
                            $ary["result_1st_H"] = null;
                            $ary["result_1st_A"] = null;
                            $ary["result_2nd_H"] = null;
                            $ary["result_2nd_A"] = null;
                            $ary["result_3th_H"] = null;
                            $ary["result_3th_A"] = null;
                            $ary["result_4th_H"] = null;
                            $ary["result_4th_A"] = null;
                            $ary["result_5th_H"] = null;
                            $ary["result_5th_A"] = null;
                            $ary["result_6th_H"] = null;
                            $ary["result_6th_A"] = null;
                            $ary["result_7th_H"] = null;
                            $ary["result_7th_A"] = null;
                            break;
                        case "BM":
                            $ary["result_set_H"] = null;
                            $ary["result_set_A"] = null;
                            $ary["result_point_H"] = null;
                            $ary["result_point_A"] = null;
                            $ary["result_1st_H"] = null;
                            $ary["result_1st_A"] = null;
                            $ary["result_2nd_H"] = null;
                            $ary["result_2nd_A"] = null;
                            $ary["result_3th_H"] = null;
                            $ary["result_3th_A"] = null;
                            $ary["result_4th_H"] = null;
                            $ary["result_4th_A"] = null;
                            $ary["result_5th_H"] = null;
                            $ary["result_5th_A"] = null;
                            break;
                        case "BS":
                            $ary["start"] = getXmlNode($xml,"gopen");
                            $ary["retime"] = "1H";
                            $ary["reminute"] = "";
                            $ary["lastScore"] = getXmlNode($xml,"score_new");
                            $arr = [
                                "sc_1st_H","sc_1st_A",
                                "sc_2nd_H","sc_2nd_A",
                                "sc_3th_H","sc_3th_A",
                                "sc_4th_H","sc_4th_A",
                                "sc_5th_H","sc_5th_A",
                                "sc_6th_H","sc_6th_A",
                                "sc_7th_H","sc_7th_A",
                                "sc_8th_H","sc_8th_A",
                                "sc_9th_H","sc_9th_A",
                                "sc_ot_H","sc_ot_A",
                                "sc_ov_H","sc_ov_A",
                                "base_1B","base_2B","base_3B",
                                "base_hh","part","outCount"
                            ];
                            foreach ($arr as  $v){
                                $ary[$v] = "".getXmlNode($xml,$v);
                            }
                            $ary["result_FT_H"] = "".getXmlNode($xml,"sc_game_H");
                            $ary["result_FT_C"] = "".getXmlNode($xml,"sc_game_A");
                            break;
                        case "SK":
                            $ary["result_1st_H"] = null;
                            $ary["result_1st_A"] = null;
                            $ary["result_2nd_H"] = null;
                            $ary["result_2nd_A"] = null;
                            $ary["result_3th_H"] = null;
                            $ary["result_3th_A"] = null;
                            $ary["result_4th_H"] = null;
                            $ary["result_4th_A"] = null;
                            $ary["result_5th_H"] = null;
                            $ary["result_5th_A"] = null;
                            $ary["result_6th_H"] = null;
                            $ary["result_6th_A"] = null;
                            $ary["result_FT_H"] = null;
                            $ary["result_FT_C"] = null;
                            break;
                    }
                    if($ary["game_over"] == "Y" && !empty($rs["inball_more"])){//已经有赛果
                        if($rs["status"]>0){
                            $ary["game_cancel"] = "Y";
                            $ary["cancel_type"] = $rs["status"];
                        }
                        $inball = unserialize($rs["inball_more"]);

                        switch ($gtype){
                            case "FT":
                            case "OP":
                                $ary["result_FT_H"] = $inball["GMH"];
                                $ary["result_FT_C"] = $inball["GMC"];
                                $ary["result_1H_H"] = $inball["HGMH"];
                                $ary["result_1H_C"] = $inball["HGMC"];
                                break;
                            case "BK":
                                $ary["result_Q1_A"] = $inball["GMH3"]["result_h"];
                                $ary["result_Q1_H"] = $inball["GMH3"]["result_c"];

                                $ary["result_Q2_A"] = $inball["GMH4"]["result_h"];
                                $ary["result_Q2_H"] = $inball["GMH4"]["result_c"];

                                $ary["result_Q3_A"] = $inball["GMH5"]["result_h"];
                                $ary["result_Q3_H"] = $inball["GMH5"]["result_c"];

                                $ary["result_Q4_A"] = $inball["GMH6"]["result_h"];
                                $ary["result_Q4_H"] = $inball["GMH6"]["result_c"];

                                $ary["result_H1_A"] = $inball["GMH1"]["result_h"];
                                $ary["result_H1_H"] = $inball["GMH1"]["result_c"];

                                $ary["result_H2_A"] = $inball["GMH2"]["result_h"];
                                $ary["result_H2_H"] = $inball["GMH2"]["result_c"];

                                $ary["result_OT_A"] = $inball["HGMH"]["result_h"];
                                $ary["result_OT_H"] = $inball["HGMH"]["result_c"];

                                $ary["result_FT_H"] = $inball["GMH"]["result_h"];
                                $ary["result_FT_C"] = $inball["GMH"]["result_c"];
                                break;
                            case "TN":
                                $ary["result_1_H"] = isset($inball["GMH1"]["result_h"]) ? $inball["GMH1"]["result_h"] : null;
                                $ary["result_1_C"] = isset($inball["GMH1"]["result_c"]) ? $inball["GMH1"]["result_c"] : null;

                                $ary["result_2_H"] = isset($inball["GMH2"]["result_h"]) ? $inball["GMH2"]["result_h"] : null;
                                $ary["result_2_C"] = isset($inball["GMH2"]["result_c"]) ? $inball["GMH2"]["result_c"] : null;

                                $ary["result_3_H"] = isset($inball["GMH3"]["result_h"]) ? $inball["GMH3"]["result_h"] : null;
                                $ary["result_3_C"] = isset($inball["GMH3"]["result_c"]) ? $inball["GMH3"]["result_c"] : null;

                                $ary["result_4_H"] = isset($inball["GMH4"]["result_h"]) ? $inball["GMH4"]["result_h"] : null;
                                $ary["result_4_C"] = isset($inball["GMH4"]["result_c"]) ? $inball["GMH4"]["result_c"] : null;

                                $ary["result_5_H"] = isset($inball["GMH5"]["result_h"]) ? $inball["GMH5"]["result_h"] : null;
                                $ary["result_5_C"] = isset($inball["GMH5"]["result_c"]) ? $inball["GMH5"]["result_c"] : null;

                                $ary["result_0_H"] = $inball["GMH"]["result_h"];
                                $ary["result_0_C"] = $inball["GMH"]["result_c"];

                                $ary["result_6_H"] = $inball["GMH6"]["result_h"];
                                $ary["result_6_C"] = $inball["GMH6"]["result_h"];
                                break;
                            case "VB":
                                $ary["result_1_H"] = isset($inball["GMH1"]["result_h"]) ? $inball["GMH1"]["result_h"] : null;
                                $ary["result_1_C"] = isset($inball["GMH1"]["result_c"]) ? $inball["GMH1"]["result_c"] : null;

                                $ary["result_2_H"] = isset($inball["GMH2"]["result_h"]) ? $inball["GMH2"]["result_h"] : null;
                                $ary["result_2_C"] = isset($inball["GMH2"]["result_c"]) ? $inball["GMH2"]["result_c"] : null;

                                $ary["result_3_H"] = isset($inball["GMH3"]["result_h"]) ? $inball["GMH3"]["result_h"] : null;
                                $ary["result_3_C"] = isset($inball["GMH3"]["result_c"]) ? $inball["GMH3"]["result_c"] : null;

                                $ary["result_4_H"] = isset($inball["GMH4"]["result_h"]) ? $inball["GMH4"]["result_h"] : null;
                                $ary["result_4_C"] = isset($inball["GMH4"]["result_c"]) ? $inball["GMH4"]["result_c"] : null;

                                $ary["result_5_H"] = isset($inball["GMH5"]["result_h"]) ? $inball["GMH5"]["result_h"] : null;
                                $ary["result_5_C"] = isset($inball["GMH5"]["result_c"]) ? $inball["GMH5"]["result_c"] : null;

                                $ary["result_6_H"] = isset($inball["GMH6"]["result_h"]) ? $inball["GMH6"]["result_h"] : null;
                                $ary["result_6_C"] = isset($inball["GMH6"]["result_c"]) ? $inball["GMH6"]["result_c"] : null;

                                $ary["result_7_H"] = isset($inball["GMH7"]["result_h"]) ? $inball["GMH7"]["result_h"] : null;
                                $ary["result_7_C"] = isset($inball["GMH7"]["result_c"]) ? $inball["GMH7"]["result_c"] : null;

                                $ary["result_0_H"] = $inball["GMH"]["result_h"];
                                $ary["result_0_C"] = $inball["GMH"]["result_c"];
                                break;
                            case "TT":
                                $ary["result_set_H"] = $inball["GMH"]["result_h"];
                                $ary["result_set_A"] = $inball["GMH"]["result_c"];

                                $ary["result_point_H"] = null;
                                $ary["result_point_A"] = null;

                                $ary["result_1st_H"] = isset($inball["GMH1"]["result_h"]) ? $inball["GMH1"]["result_h"] : null;
                                $ary["result_1st_A"] = isset($inball["GMH1"]["result_c"]) ? $inball["GMH1"]["result_c"] : null;

                                $ary["result_2nd_H"] = isset($inball["GMH2"]["result_h"]) ? $inball["GMH2"]["result_h"] : null;
                                $ary["result_2nd_A"] = isset($inball["GMH2"]["result_c"]) ? $inball["GMH2"]["result_c"] : null;

                                $ary["result_3th_H"] = isset($inball["GMH3"]["result_h"]) ? $inball["GMH3"]["result_h"] : null;
                                $ary["result_3th_A"] = isset($inball["GMH3"]["result_c"]) ? $inball["GMH3"]["result_c"] : null;

                                $ary["result_4th_H"] = isset($inball["GMH4"]["result_h"]) ? $inball["GMH4"]["result_h"] : null;
                                $ary["result_4th_A"] = isset($inball["GMH4"]["result_c"]) ? $inball["GMH4"]["result_c"] : null;

                                $ary["result_5th_H"] = isset($inball["GMH5"]["result_h"]) ? $inball["GMH5"]["result_h"] : null;
                                $ary["result_5th_A"] = isset($inball["GMH5"]["result_c"]) ? $inball["GMH5"]["result_c"] : null;

                                $ary["result_6th_H"] = isset($inball["GMH6"]["result_h"]) ? $inball["GMH6"]["result_h"] : null;
                                $ary["result_6th_A"] = isset($inball["GMH6"]["result_c"]) ? $inball["GMH6"]["result_c"] : null;

                                $ary["result_7th_H"] = isset($inball["GMH7"]["result_h"]) ? $inball["GMH7"]["result_h"] : null;
                                $ary["result_7th_A"] = isset($inball["GMH7"]["result_c"]) ? $inball["GMH7"]["result_c"] : null;
                                break;
                            case "BM":
                                $ary["result_set_H"] = $inball["GMH"]["result_h"];
                                $ary["result_set_A"] = $inball["GMH"]["result_c"];

                                $ary["result_point_H"] = null;
                                $ary["result_point_A"] = null;

                                $ary["result_1st_H"] = isset($inball["GMH1"]["result_h"]) ? $inball["GMH1"]["result_h"] : null;
                                $ary["result_1st_A"] = isset($inball["GMH1"]["result_c"]) ? $inball["GMH1"]["result_c"] : null;

                                $ary["result_2nd_H"] = isset($inball["GMH2"]["result_h"]) ? $inball["GMH2"]["result_h"] : null;
                                $ary["result_2nd_A"] = isset($inball["GMH2"]["result_c"]) ? $inball["GMH2"]["result_c"] : null;

                                $ary["result_3th_H"] = isset($inball["GMH3"]["result_h"]) ? $inball["GMH3"]["result_h"] : null;
                                $ary["result_3th_A"] = isset($inball["GMH3"]["result_c"]) ? $inball["GMH3"]["result_c"] : null;

                                $ary["result_4th_H"] = isset($inball["GMH4"]["result_h"]) ? $inball["GMH4"]["result_h"] : null;
                                $ary["result_4th_A"] = isset($inball["GMH4"]["result_c"]) ? $inball["GMH4"]["result_c"] : null;

                                $ary["result_5th_H"] = isset($inball["GMH5"]["result_h"]) ? $inball["GMH5"]["result_h"] : null;
                                $ary["result_5th_A"] = isset($inball["GMH5"]["result_c"]) ? $inball["GMH5"]["result_c"] : null;
                                break;
                            case "BS":
                                $ary["start"] = getXmlNode($xml,"gopen");
                                $ary["retime"] = "1H";
                                $ary["reminute"] = "";
                                $ary["lastScore"] = getXmlNode($xml,"score_new");
                                $arr = [
                                    "sc_1st_H","sc_1st_A",
                                    "sc_2nd_H","sc_2nd_A",
                                    "sc_3th_H","sc_3th_A",
                                    "sc_4th_H","sc_4th_A",
                                    "sc_5th_H","sc_5th_A",
                                    "sc_6th_H","sc_6th_A",
                                    "sc_7th_H","sc_7th_A",
                                    "sc_8th_H","sc_8th_A",
                                    "sc_9th_H","sc_9th_A",
                                    "sc_ot_H","sc_ot_A",
                                    "sc_ov_H","sc_ov_A",
                                    "base_1B","base_2B","base_3B",
                                    "base_hh","part","outCount"
                                ];
                                foreach ($arr as  $v){
                                    $ary[$v] = "".getXmlNode($xml,$v);
                                }
                                $ary["result_FT_H"] = $inball["GMH"]["result_h"];
                                $ary["result_FT_C"] = $inball["GMH"]["result_c"];
                                break;
                            case "SK":
                                $ary["result_1st_H"] = isset($inball["GMH1"]["result_h"]) ? $inball["GMH1"]["result_h"] : null;
                                $ary["result_1st_A"] = isset($inball["GMH1"]["result_c"]) ? $inball["GMH1"]["result_c"] : null;

                                $ary["result_2nd_H"] = isset($inball["GMH2"]["result_h"]) ? $inball["GMH2"]["result_h"] : null;
                                $ary["result_2nd_A"] = isset($inball["GMH2"]["result_c"]) ? $inball["GMH2"]["result_c"] : null;

                                $ary["result_3th_H"] = isset($inball["GMH3"]["result_h"]) ? $inball["GMH3"]["result_h"] : null;
                                $ary["result_3th_A"] = isset($inball["GMH3"]["result_c"]) ? $inball["GMH3"]["result_c"] : null;

                                $ary["result_4th_H"] = isset($inball["GMH4"]["result_h"]) ? $inball["GMH4"]["result_h"] : null;
                                $ary["result_4th_A"] = isset($inball["GMH4"]["result_c"]) ? $inball["GMH4"]["result_c"] : null;

                                $ary["result_5th_H"] = isset($inball["GMH5"]["result_h"]) ? $inball["GMH5"]["result_h"] : null;
                                $ary["result_5th_A"] = isset($inball["GMH5"]["result_c"]) ? $inball["GMH5"]["result_c"] : null;

                                $ary["result_6th_H"] = isset($inball["GMH6"]["result_h"]) ? $inball["GMH6"]["result_h"] : null;
                                $ary["result_6th_A"] = isset($inball["GMH6"]["result_c"]) ? $inball["GMH6"]["result_c"] : null;
                                $ary["result_FT_H"] = $inball["GMH"]["result_h"];
                                $ary["result_FT_C"] = $inball["GMH"]["result_c"];
                                break;
                        }
                    }
                }
            }
        }



        return $ary;

    }



    /**
     * @return array[]
     */
    public function get_SearchFilter_data(){
        $ary = [
            "downline" => $this->get_downline(),
        ];

        if(isset($this->param["totalBets"]) && strtoupper($this->param["totalBets"]) == "WMC"){
            $wmc = $this->get_wmc_league();
            $ary["league"] = $wmc["league"];
            $ary["event"] = $wmc["event"];
        }else{
            $ary["league"] = $this->get_league();
            $ary["other_data"] = [];
        }
        return $ary;
    }


    public function get_wmc_league(){
        global $sport_tables;
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $gtype = isset($this->param["gtype"]) ? strtoupper($this->param["gtype"]) : "ALL";
        $start_date = date("Y-m-d",strtotime("-1 day"));
        $end_date = date("Y-m-d");
        $datetime = time()-2*60*60;
        $where = "`m_date`>='{$start_date}' AND `datetime`>'{$datetime}' AND `is_inball`=0";

        $leg = [];
        $event = [];
        if($gtype == "ALL"){
            foreach ($sport_tables as $k => $v){
                $table = $v["table"];
                $where1 = $where;
                if($k != "FS"){
                    $l = $this->dbs->select("SELECT `lid` AS `id`,`league{$css}` AS `name` FROM {$table} WHERE {$where1} GROUP BY `lid`");
                    if($l){
                        $leg = array_merge($leg,$l);
                    }
                    $where1.= " AND `master`='Y' AND LENGTH(`gnum_h`)=5";
                    $ev = $this->dbs->select("SELECT `team_h{$css}` AS `team_h`,`team_c{$css}` AS `team_c`,`gid`,`ptype{$css}` AS `ptype` FROM {$table} WHERE {$where1} ORDER BY `datetime` ASC");
                    if($ev){
                        $event = array_merge($event,$ev);
                    }
                }

            }

            $events = [];
            foreach ($event as $v){
                $events["'{$v["gid"]}'"] = [
                    "id" => $v["gid"],
                    "name" => str_replace($v["ptype"],"",$v["team_h"])." v ".str_replace($v["ptype"],"",$v["team_c"])
                ];
            }
            $event = $events;
        }else{
            if($gtype == "FS"){
                $where = "`sfs_id`='FS' AND `datetime`>'{$datetime}' ";
            }
            $table = $sport_tables[$gtype]["table"];
            $leg = $this->dbs->select("SELECT `lid` AS `id`,`league{$css}` AS `name` FROM {$table} WHERE {$where} GROUP BY `lid`");
            if(!$leg){ $leg = [];}

            if($gtype!="FS"){
                $where.= " AND `master`='Y' AND LENGTH(`gnum_h`)=5";
                $ev = $this->dbs->select("SELECT `team_h{$css}` AS `team_h`,`team_c{$css}` AS `team_c`,`gid`,`ptype{$css}` AS `ptype` FROM {$table} WHERE {$where} ORDER BY `datetime` ASC");
                if($ev){
                    foreach ($ev as $v){
                        $event[$v["gid"]] = [
                            "id" => $v["gid"],
                            "name" => str_replace($v["ptype"],"",$v["team_h"])." v ".str_replace($v["ptype"],"",$v["team_c"])
                        ];
                    }
                }
            }
        }

        return ["league"=>$leg,"event"=>$event];
    }

    /**
     * 联赛查询
     * @return array
     */
    public function get_league(){
        $smn = $this->son_nid_manger();
        $css = "";
        switch ($this->langx){
            case "zh-tw":
                $css = "_tw";
                break;
            case "en-us":
                $css = "_en";
                break;
        }
        $gtype = strtoupper($this->param["gtype"]);

        $where = "`gtype`='{$gtype}' AND ";
        $where.= $this->get_where();
        $ary = [];
        if($smn === false){
            $rs = $this->dbs->select("SELECT `lid` AS `id`,`league{$css}` AS `name` FROM {$this->betTable} WHERE {$where} GROUP BY `lid`");
            if($rs){$ary=$rs;}
        }else{ //子账号管理下线
            $rs = $this->dbs->select("SELECT `lid` AS `id`,`league{$css}` AS `name`,`nid` FROM {$this->betTable} WHERE {$where} GROUP BY `m_name`,`lid`");
            if($rs){
                $aa = [];
                foreach ($rs as $v){
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        $aa[$v["id"]] = [
                            "id" => $v["id"],
                            "name" => $v["name"]
                        ];
                    }
                }
                $ary = array_values($aa);
            }
        }

        return $ary;
    }

    /**
     * 下级账号查询
     * @return array
     */
    public function get_downline(){
        //$lv = lv_nid($this->sup["nid"]);
        $smn = $this->son_nid_manger();
        $downTable = Constant::T_RANK;
        $where = "`nid` LIKE '{$this->sup["nid"]}%'";
        $isMaster = " AND `isMaster`=0";
        $layer = Constant::MEM;
        switch ($this->login_layer){
            case Constant::ADS:
                $where.= " AND `level`=4";//分公司
                $layer = Constant::AD;
                break;
            case Constant::AD:
                $where.= " AND `level`=4";//分公司
                $layer = Constant::D0;
                break;
            case Constant::D0:
                $where.= " AND `level`=3";//股东
                $layer = Constant::CO;
                break;
            case Constant::CO:
                $where.= " AND `level`=2";//总代理
                $layer = Constant::SU;
                break;
            case Constant::SU:
                $where.= " AND `level`=1";//代理
                $layer = Constant::AG;
                break;
            case Constant::AG:
                $isMaster = "";
                $downTable = Constant::T_MEMBER;
                $layer = Constant::MEM;
                break;
        }

        $rs = $this->dbc->select("SELECT `nid`,`alias`,`id`,`name` AS `username`  FROM {$downTable} WHERE {$where} {$isMaster}");
        if($rs){
            $ary = [];
            foreach ($rs as $v){
                $nid = $v["nid"];
                unset($v["nid"]);
                if($smn === false){
                    $ary[$v["id"]] = $v;
                }else{
                    $nid = $this->get_manger_acc_nid($layer,$nid);
                    if(in_array($nid,$smn)){
                        $ary[$v["id"]] = $v;
                    }
                }

            }
            return $ary;
        }else{
            return [];
        }
    }

    /**
     * 总览
     * @return array[]
     */
    public function get_overview(){
        $_p = $this->param;
        $percentage = $_p["percentage"];
        $period = [];
        foreach ($this->gAry as $gtype){
            $period[$gtype]["ALL_BETS"] = 0;
            $period[$gtype]["ALL_TOTAL"] = 0;

            //今日
            $today = $this->get_bet_today($gtype);
            $bets = empty($today["bets"]) ? 0 : $today["bets"];
            $total = empty($today["total"]) ? 0 : $today["total"];
            $period[$gtype]["today"] = [
                "bets" => $bets,
                "total"=> $total
            ];
            $period[$gtype]["ALL_BETS"] += $bets;
            $period[$gtype]["ALL_TOTAL"]+= $total;

            //滚球
            $inplay = $this->get_bet_inplay($gtype);
            $bets = empty($inplay["bets"]) ? 0 : $inplay["bets"];
            $total = empty($inplay["total"]) ? 0 : $inplay["total"];
            $period[$gtype]["inplay"] = [
                "bets" => $bets,
                "total"=> $total
            ];
            $period[$gtype]["ALL_BETS"] += $bets;
            $period[$gtype]["ALL_TOTAL"]+= $total;

            //过关
            $parlay = $this->get_bet_parlay($gtype);
            $bets = empty($parlay["bets"]) ? 0 : $parlay["bets"];
            $total = empty($parlay["total"]) ? 0 : $parlay["total"];
            $period[$gtype]["parlay"] = [
                "bets" => $bets,
                "total"=> $total
            ];
            $period[$gtype]["ALL_BETS"] += $bets;
            $period[$gtype]["ALL_TOTAL"]+= $total;

            //早盘
            $early = $this->get_bet_early($gtype);
            $bets = empty($early["bets"]) ? 0 : $early["bets"];
            $total = empty($early["total"]) ? 0 : $early["total"];
            $period[$gtype]["early"] = [
                "bets" => $bets,
                "total"=> $total
            ];
            $period[$gtype]["ALL_BETS"] += $bets;
            $period[$gtype]["ALL_TOTAL"]+= $total;


            //冠军/进球球员
            $outright = $this->get_bet_outright($gtype);
            $bets = empty($outright["bets"]) ? 0 : $outright["bets"];
            $total = empty($outright["total"]) ? 0 : $outright["total"];
            $period[$gtype]["outright"] = [
                "bets" => $bets,
                "total"=> $total
            ];
            $period[$gtype]["ALL_BETS"] += $bets;
            $period[$gtype]["ALL_TOTAL"]+= $total;

        }
        $this->insertLog("即时注单->总览");
        return ["period"=>$period];
    }

    public function get_bet_outright($gtype){
        $date = date("Y-m-d");
        $where = "AND `m_date`>='{$date}'AND `showtype`='fs'";
        return $this->get_bet($gtype,$where);
    }

    /**
     * 早盘注单
     * @param $gtype
     * @return array|null
     */
    public function get_bet_early($gtype){
        $date = date("Y-m-d");
        $where = "AND `m_date`>'{$date}' AND `showtype`='today'";
        return $this->get_bet($gtype,$where);
    }

    /**
     * 过关注单
     * @param $gtype
     * @return array|null
     */
    public function get_bet_parlay($gtype){
        $date = date("Y-m-d");
        $where = "AND `m_date`>='{$date}' AND `showtype`='parlay'";
        return $this->get_bet($gtype,$where);
    }

    /**
     * 滚球注单
     * @param $gtype
     * @return array|null
     */
    public function get_bet_inplay($gtype){
        $time1 = time();
        $time = time() - 2 * 60 *60;
        $where = " AND `datetime`>{$time} AND `showtype`='live'";
        return $this->get_bet($gtype,$where);
    }

    /**
     * 今日查询
     * @param $gtype 赛事类
     * @return array|null
     */
    public function get_bet_today($gtype){
        $date = date("Y-m-d");
        $time = time();//初盘数据
        $where = " AND `m_date`='{$date}' AND `showtype`='today'";
        return $this->get_bet($gtype,$where);
    }

    /**
     * 数据查询 注单表
     * @param $gtype 球类
     * @param string $where
     * @return array|null
     */
    public function get_bet($gtype,$where=""){
        $smn = $this->son_nid_manger();
        $point = $this->get_percentage_point();
        $ary = [];
        if($smn===false){
            $sql = "SELECT ROUND(SUM(`bet_golds`*{$point}/100),1) AS `total`,COUNT(`ID`) AS `bets` FROM {$this->betTable} ";
            $sql.= "WHERE `nid` LIKE '{$this->sup["nid"]}%' AND `hidden`=0 AND `gtype`='{$gtype}' AND `isResult`=0 {$where}";
            $rs = $this->dbc->select($sql,"Row");
            $ary = $rs;
        }else{ //子账号管理下线
            $sql = "SELECT ROUND(SUM(`bet_golds`*{$point}/100),1) AS `total`,COUNT(`ID`) AS `bets`,`nid` FROM {$this->betTable} ";
            $sql.= "WHERE `nid` LIKE '{$this->sup["nid"]}%' AND `hidden`=0 AND `gtype`='{$gtype}' AND `isResult`=0 {$where} GROUP BY `m_name`";
            $rs = $this->dbc->select($sql);
            $ary["total"] = 0;
            $ary["bets"] = 0;
            if($rs){
                foreach ($rs as $v){
                    $nid = $this->get_manger_acc_nid(Constant::MEM,$v["nid"]);
                    if(in_array($nid,$smn)){
                        $ary["total"] += $v["total"];
                        $ary["bets"] += $v["bets"];
                    }
                }
            }
        }

        return $ary;
    }



    /**
     * 获取占成计算字段
     * @return int|string
     */
    public function get_percentage_point($isA=false){
        $A = "";
        if($isA == true){$A = "@";}
        $_p = $this->param;
        $percentage = $_p["percentage"];
        $point = 100;
        $d0 = "{$A}`d0_point`";
        $co = "{$A}`co_point`";
        $su = "{$A}`su_point`";
        $ag = "{$A}`ag_point`";

        switch ($this->login_layer){
            case Constant::ADS:
            case Constant::ADS:
                $datalist = ["com","d","c","s","a","dcsa","dcs","dc","csa","cs","sa"];
                if(!in_array($percentage,$datalist)){
                    if($percentage == "my"){
                        $percentage = "com";
                    }else{
                        $percentage = "full";
                    }
                }
                break;
            case Constant::D0:
                $datalist = ["d","c","s","a","dcsa","dcs","dc","csa","cs","sa"];
                if(!in_array($percentage,$datalist)){
                    if($percentage == "my"){
                        $percentage = "d";
                    }else{
                        $percentage = "full";
                    }
                }
                break;
            case Constant::CO:
                $datalist = ["c","s","a","csa","cs","sa"];
                if(!in_array($percentage,$datalist)){
                    if($percentage == "my"){
                        $percentage = "c";
                    }else{
                        $percentage = "full";
                    }
                }
                break;
            case Constant::SU:
                $datalist = ["s","a","sa"];
                if(!in_array($percentage,$datalist)){
                    if($percentage == "my"){
                        $percentage = "s";
                    }else{
                        $percentage = "full";
                    }
                }
                break;
            case Constant::AG:
                $datalist = ["a"];
                if(!in_array($percentage,$datalist)){
                    if($percentage == "my"){
                        $percentage = "a";
                    }else{
                        $percentage = "full";
                    }
                }
                break;
        }
        switch ($percentage){
            case "com"://公司占成
                $point = "(100 - {$d0} - {$co} - {$su} - {$ag})";
                break;
            case "d"://分公司占成
                $point = $d0;
                break;
            case "c"://股东占成
                $point = $co;
                break;
            case "s"://总代理 占成
                $point = $su;
                break;
            case "a"://代理 占成
                $point = $ag;
                break;
            case "dcsa"://分公司 + 股东 + 总代理 + 代理
                $point = "({$d0} + {$co} + {$su} + {$ag})";
                break;
            case "dcsa"://分公司 + 股东 + 总代理
                $point = "({$d0} + {$co} + {$su})";
                break;
            case "dc"://分公司 + 股东
                $point = "({$d0} + {$co})";
                break;
            case "csa"://股东 + 总代理 + 代理
                $point = "({$co} + {$su} + {$ag})";
                break;
            case "cs"://股东 + 总代理
                $point = "({$co} + {$su})";
                break;
            case "sa"://总代理 + 代理
                $point = "({$su} + {$ag})";
                break;
        }

        return $point;
    }

    /**
     * 获取赛事表
     * @param $gtype
     * @return string
     */
    public function get_match_table($gtype){
        $table = Constant::S_FT;
        switch ($gtype){
            case "BK":
                $table = Constant::S_BK;
                break;
            case "BM":
                $table = Constant::S_BM;
                break;
            case "BS":
                $table = Constant::S_BS;
                break;
            case "TT":
                $table = Constant::S_TT;
                break;
            case "TN":
                $table = Constant::S_TN;
                break;
            case "VB":
                $table = Constant::S_VB;
                break;
            case "SK":
                $table = Constant::S_SK;
                break;
            case "OP":
                $table = Constant::S_OP;
                break;
            case "FS":
                $table = Constant::S_SP;
                break;
        }

        return $table;
    }

    /**
     * 获取赛事XML表
     * @param $gtype
     * @return string
     */
    public function get_match_table_xml($gtype){
        $table = Constant::S_FT_XML;
        switch ($gtype){
            case "BK":
                $table = Constant::S_BK_XML;
                break;
            case "BM":
                $table = Constant::S_BM_XML;
                break;
            case "BS":
                $table = Constant::S_BS_XML;
                break;
            case "TT":
                $table = Constant::S_TT_XML;
                break;
            case "TN":
                $table = Constant::S_TN_XML;
                break;
            case "VB":
                $table = Constant::S_VB_XML;
                break;
            case "SK":
                $table = Constant::S_SK_XML;
                break;
            case "OP":
                $table = Constant::S_OP_XML;
                break;
        }

        return $table;
    }

    /**
     * 所有查询条件
     * @return string
     */
    public function get_where(){
        $down_id = !empty($this->param["down_id"]) ? $this->param["down_id"] : "all";
        $league_id = !empty($this->param["league_id"]) ? $this->param["league_id"] : "all";
        $gold = !empty($this->param["gold"]) ? $this->param["gold"] : 0;
        $where = "`nid` LIKE '{$this->sup["nid"]}%'";
        if($down_id != "all") {
            $ds = explode(",",$down_id);
            $wid = "`id`={$down_id}";
            if(count($ds)>1){
                $wid = "`id` IN ({$down_id})";
            }
            switch ($this->login_layer) {
                case Constant::ADS:
                    $table = Constant::T_ADMIN;
                    if(count($ds)>1){
                        $ad = $this->dbc->select("SELECT `nid` FROM {$table} WHERE {$wid} AND {$where} AND `level`=1 AND `isMaster`=0");
                        if($ad){
                            $where .= " AND (";
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.= "`nid` LIKE '{$ad["nid"]}%' OR ";
                            }
                            $vv = rtrim($vv,"OR");
                            $where.= "{$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `nid` FROM {$table} WHERE {$wid} AND {$where} AND `level`=1 AND `isMaster`=0","Row");
                        if($ad){
                            $where = "`nid` LIKE '{$ad["nid"]}%'";
                        }
                    }

                    break;
                case Constant::AG:
                    $table = Constant::T_MEMBER;
                    if(count($ds)>1) {
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where}");
                        if ($ad) {
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.= "'{$ad["name"]}',";
                            }
                            $vv = rtrim($vv,",");
                            $where .= " AND `M_name` IN ({$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where}","Row");
                        if ($ad) {
                            $where .= " AND `M_name`='{$ad["name"]}'";
                        }
                    }
                    break;
                default:
                    $where1 = $where." AND `isMaster`=0";
                    $name = '`M_name`';
                    switch ($this->login_layer){
                        case Constant::AD:
                            $where1.= " AND `level`=4";
                            $name = '`d0_name`';
                            break;
                        case Constant::D0:
                            $where1.= " AND `level`=3";
                            $name = '`co_name`';
                            break;
                        case Constant::CO:
                            $where1.= " AND `level`=2";
                            $name = '`su_name`';
                            break;
                        case Constant::SU:
                            $where1.= " AND `level`=1";
                            $name = '`ag_name`';
                            break;
                    }
                    $table = Constant::T_RANK;
                    if(count($ds)>1) {
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where1} ");
                        if ($ad) {
                            $vv = "";
                            foreach ($ad as $v){
                                $vv.="'{$v["name"]}',";
                            }
                            $vv = rtrim($vv,",");
                            $where .= " AND {$name} IN ({$vv})";
                        }
                    }else{
                        $ad = $this->dbc->select("SELECT `name` FROM {$table} WHERE {$wid} AND {$where1} ","Row");
                        if ($ad) {
                            $where .= " AND {$name}='{$ad["name"]}'";
                        }
                    }
                    break;
            }
        }

        if(is_numeric($league_id)){
            $where.= " AND `lid`={$league_id}";
        }

        if(is_numeric($gold)){
            $where.= " AND `bet_golds`>{$gold}";
        }


        $where.= $this->get_session_where();

        return $where;
    }

    /**
     * 根据session获取判断相应的条件
     * @return string
     */
    public function get_session_where(){
        $where = "";
        if(isset($this->param["session"])){
            $session = strtoupper($this->param["session"]);
            $gtype = strtoupper($this->param["gtype"]);
            $date = date("Y-m-d");
            $time1 = time();

            //`showtype`='fs' AND `gnum_c`>0  进球球员:`gnum_c`>0, 冠军:`gnum_c`=0
            switch ($session){
                case "RB"://滚球
                    $time = time() - 2 * 60 *60;
                    if($gtype=="BS"){
                        $time = time() - 6 * 60 *60;
                        $where.= " AND `datetime` BETWEEN {$time} AND {$time1} AND `showtype`='live' AND `isResult`=0";
                    }else{
                        $where.= " AND `datetime` BETWEEN {$time} AND {$time1} AND `showtype`='live' AND `isResult`=0";
                    }
                    break;
                case "FT"://今日
                    $where.= " AND `m_date`='{$date}' AND `datetime`>{$time1} AND (`showtype`='today' OR (`showtype`='fs' AND `gnum_c`>0)) AND `isResult`=0";
                    break;
                case "FU"://早盘
                    $s_date = !empty($this->param["date"]) ? strtoupper($this->param["date"]) : "ALL";
                    switch ($s_date){
                        case "ALL":
                            $where.= " AND `m_date`>'{$date}'";
                            break;
                        case "FUTURE"://未来
                            $date = date("Y-m-d",strtotime("+7 day"));
                            $where.= " AND `m_date`>'{$date}'";
                            break;
                        default:
                            $where.= " AND `m_date`='{$s_date}'";
                            break;
                    }

                    $where.= " AND (`showtype`='today' OR (`showtype`='fs' AND `gnum_c`>0)) AND `isResult`=0";
                    break;
                case "P"://过关
                    $s_date = !empty($this->param["date"]) ? strtoupper($this->param["date"]) : "ALL";
                    switch ($s_date){
                        case "ALL":
                            $where.= " AND `m_date`>='{$date}'";
                            break;
                        case "FUTURE"://未来
                            $date = date("Y-m-d",strtotime("+7 day"));
                            $where.= " AND `m_date`>'{$date}'";
                            break;
                        case "TODAY":
                            $where.= " AND `m_date`='{$date}'";
                            break;
                        default:
                            $where.= " AND `m_date`='{$s_date}'";
                            break;
                    }
                    if($session == "P"){
                        $where.= " AND `showtype`='parlay'";
                    }else{
                        $where.= " AND (`showtype`='today' OR (`showtype`='fs' AND `gnum_c`>0))";
                    }
                    $where.= " AND `isResult`=0";
                    break;
                case "PL"://已开赛
                    $s_date = !empty($this->param["date"]) ? strtoupper($this->param["date"]) : "TODAY";
                    switch ($s_date){
                        case "YESTERDAY":
                            $date = date("Y-m-d",strtotime("-1 day"));
                            $where.=" AND `m_date`='{$date}'";
                            break;
                        case "ALL":
                            $y_date = date("Y-m-d",strtotime("-1 day"));
                            $where.=" AND `m_date` BETWEEN '{$y_date}' AND '{$date}' AND `datetime`<'{$time1}'";
                            break;
                        default:
                            $where.=" AND `m_date`='{$date}' AND `datetime`<'{$time1}'";
                            break;
                    }


                    if(!empty($this->param["market"])){
                        switch (strtoupper($this->param["market"])){
                            case "RB":
                                $where.= " AND `showtype`='live'";
                                break;
                            case "PL":
                                $where.= " AND (`showtype`='today' OR (`showtype`='fs' AND `gnum_c`>0))";
                                break;
                        }
                    }else{
                        $where.= " AND `showtype`<>'parlay' AND `gnum_c`>0";
                    }

                    break;
                case "FS"://冠军
                    $s_date = !empty($this->param["date"]) ? strtoupper($this->param["date"]) : "ALL";
                    if($s_date == "ALL"){
                        $where.= " AND `m_date`>='{$date}'";
                    }else{
                        $d = explode(",",$s_date);
                        $where.= " AND `m_date` BETWEEN '{$d[0]}' AND '{$d[1]}'";
                    }
                    $where.= " AND `showtype`='fs' AND `gnum_c`=0 AND `isResult`=0";
                    break;
            }

            return $where;
        }

    }

}