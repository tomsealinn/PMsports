<?php
//返回当前的毫秒时间戳
function msectime() {
	
    list($msec, $sec) = explode(' ', microtime());
    $msectime = (float)sprintf('%.0f', (floatval($msec) + floatval($sec)) * 1000);
    return $msectime;
}

function get_domain(){
    return $_SERVER["HTTP_HOST"];
    $domain = explode(".",$_SERVER["HTTP_HOST"]);
    $domain = $domain[count($domain)-2].".".$domain[count($domain)-1];
    return $domain;
}
/**
 * 显示400错误
 */
function error_400(){
    header("HTTP/1.1 404 Not Found");
    header("Status: 404 Not Found");
    exit;
}

/**
 * 判断文件是否在指定目录下
 * @param $dir
 * @param $files
 * @return bool
 */
function isDirFiles($dir,$files){
    $filesLists = getFile($dir);
    if(in_array($files,$filesLists)){
        return true;
    }else{
        return false;
    }
}

/**
 * 压缩字符串
 * @param $str
 * @return string
 */
function en_string($str){
    return base64_encode(gzdeflate($str));
}


/**
 * 解压字符串
 * @param $str
 * @return false|string
 */
function de_string($str){
    return gzinflate(base64_decode($str));
}

/**
 * 获取文件目录列表
 * @param $dir
 * @return mixed
 */
function getDirs($dir="") {
    $dirArray[]=NULL;
    if (false != ($handle = opendir ( $dir ))) {
        $i=0;
        while ( false !== ($file = readdir ( $handle )) ) {
            //去掉"“.”、“..”以及带“.xxx”后缀的文件
            if ($file != "." && $file != ".."&&!strpos($file,".")) {
                $dirArray[$i]=$file;
                $i++;
            }
        }
        //关闭句柄
        closedir ( $handle );
    }
    return $dirArray;
}

/**
 * 获取php文件列表
 * @param $dir 文件夹路径
 * @return mixed
 */
function getFile($dir)
{
    $fileArray[] = NULL;
    if (false != ($handle = opendir($dir))) {
        $i = 0;
        while (false !== ($file = readdir($handle))) {
            //去掉"“.”、“..”以及带“.xxx”后缀的文件
            if ($file != "." && $file != ".." && strpos($file, ".php")) {
                $fileArray[$i] = $file;
                $i++;
            }
        }
        //关闭句柄
        closedir($handle);
    }
    return $fileArray;
}

/**
 * 获取文件内容
 * @param $filename 文件路径
 * @return false|string
 */
/*function getFileTxt($filename){
    $return = '';
    if ($fp = fopen($filename, 'rb'))
    {
        while (!feof($fp)){
            $return .= fread($fp, 1024);
        }
        fclose($fp);
        // return $return;
        return $return;
    }else{
        return false;
    }
}*/

function getFileTxt($filename) {

    // 使用正则表达式匹配路径中的随机目录名，并将其转换为小写

    $lowercasePath = preg_replace_callback('/\/([a-zA-Z]+)\//', function ($matches) {

        return '/' . strtolower($matches[1]) . '/';

    }, $filename);

 

    // 分解路径和文件名

    $pathInfo = pathinfo($lowercasePath);

    $directory = $pathInfo['dirname'];

    $originalFilename = $pathInfo['basename'];

 

    // 打开目录并读取内容

    if ($dirHandle = opendir($directory)) {

        while (false !== ($entry = readdir($dirHandle))) {

            // 忽略 . 和 ..

            if ($entry != "." && $entry != "..") {

                // 忽略大小写比较文件名

                if (strtolower($entry) === strtolower($originalFilename)) {

                    closedir($dirHandle);

                    $filePath = $directory . '/' . $entry;

                    

                    $return = '';

                    if ($fp = fopen($filePath, 'rb')) {

                        while (!feof($fp)) {

                            $return .= fread($fp, 1024);

                        }

                        fclose($fp);

                        return $return;

                    } else {

                        return false;

                    }

                }

            }

        }

        closedir($dirHandle);

    }

    return false; // 文件未找到

}
/**
 * 写入采集账号文件
 * @param $arr
 */
function writefile($arr){
    $cache  = "<?php\r\n";
    $cache  .=  "unset(\$webdb);\r\n";
    $cache  .=  "\$webdb = '{$arr}';\r\n";
    $cache  .= "?>";

    if(!write_file(dirname(__FILE__)."/db.php",$cache)){ //写入缓存失败
        echo '<script>alert("缓存文件写入失败！请先设db.php文件权限为：0777!");</script>';
    }

}

function securityFilePath($fileName,$read_write = '0777'){

}

function write_file($filename,$data,$method="rb+",$iflock=1){
    @touch($filename);
    $path = dirname($filename);
    if(!file_exists($path)){// 判断路径是否存在，如果不存在则mkdir创建，并写入权限
        mkdir ($path,0777,true);
    }
    $handle=@fopen($filename,$method);
    if($iflock){
        @flock($handle,LOCK_EX);
    }
    @fputs($handle,$data);
    if($method=="rb+") @ftruncate($handle,strlen($data));
    @fclose($handle);
    @chmod($filename,0777);
    if( is_writable($filename) ){
        return true;
    }else{
        return false;
    }
}

//毫秒时间戳
function get_timestamp_millisecond()
{
    $time = explode (" ", microtime () );
    $time = $time [1] . ($time [0] * 1000);
    $time2 = explode ( ".", $time );
    $time = $time2 [0];
    return $time;
}

/**
 * 生成注单编号
 * @return int
 */
function betID(){
    return rand(10000000000,99999999999);
}

/**
 * 分页
 * @param array $param URL参数
 * @param int $count 总共有多少条
 * @return array
 */
function pager($param=[],$count=1)
{
    global $default_page_size;
    $data = [];
    $data['size'] = (isset($param['size']) ? $param['size'] : $default_page_size); //每页显示条数
    $pageCount = ceil($count / $data['size']);
    if (!empty($param['page']) && $pageCount > 0) {
        if ($param['page'] > $pageCount) {
            $page = $pageCount;
        } else {
            $page = $param['page'];
        }
    } else {
        $page = 1;
    }

    $data['page'] = (int)$page;//当前页
    $data['start'] = ($data['page'] - 1) * $data['size'];
    $data['count'] = $count;//总数
    $data['totalpage'] = empty($pageCount) ? 1 : $pageCount;//总页数
    return $data;
}

/**
 * 账号验证 登入帐号必须由2个英文大小写字母(A-Z和a-z)和数字(0-9)组合, 输入限制6-12字元.
 * @param $str
 * @return bool
 */
function regexUser($str){
    if(!preg_match("/^[a-zA-Z][a-zA-Z0-9]{5,11}$/u",$str)){
        return false;
    }
    return true;
}

/**
 * 密码验证  1.至少要有两个大或小写英文字母和数字(0 - 9)组合, 字数最少6至12个。2. 三个不同的字母数字。3. 不准许有空格。
 * @param $str
 * @return bool
 */
function regexPwd($str){
    $res = str_chk($str,1);
    if($res=="chk_OK"){
        return true;
    }else{
        return false;
    }

}

/**
 * 檢查流程
 * $str 检测字符串
 * $EngNeed 至少需要幾個字母組成
 */
function str_chk($str,$EngNeed=1){
    $str_char=0;
    $arr_char = [];
    $str_len = strlen($str);
    for ($i=0; $i < $str_len;$i++){
        $tmp_str = substr($str,$i,1);
        if(preg_match("/[aA-zZ]/",$tmp_str)){$str_char++;}

        $arr_char[$tmp_str] = true;
    }

    //低於6個字或是大於12個字
    if($str_len < 6 || $str_len > 12 ){
        return "err_length";
    }

    //不是由英數字或 @ 組成
    if(!preg_match("/^[a-zA-Z0-9@]*$/",$str)){
        return "err_combination";
    }

    //裡面含有空格或是底線
    if (preg_match("/\s/",$str) || preg_match("/_/",$str) || preg_match("/\^/",$str)){
        return "err_contain";
    }
    //2019-10-25 英文+數字 要有超過2個字元
    if (count(array_keys($arr_char)) <=2) {
        return "err_charactersNum";
    }
    //2019-10-25 過於簡易的密碼, 要做阻擋
    $arr_block_string = ["abc111","abc222","abc333","abc444","abc555","abc666","abc777","abc888","abc999","abc000","111abc","222abc","333abc","444abc","555abc","666abc","777abc","888abc","999abc","000abc","abc123","123abc","aaa123","123aaa","aaa1234","1234aaa","aa1234","1234aa","aa12345","12345aa","bbb123","123bbb","bbb1234","1234bbb","bb1234","1234bb","bb12345","12345bb","ccc123","123ccc","ccc1234","1234ccc","cc1234","1234cc","cc12345","12345cc","qwe123","123qwe","qwe1234","1234qwe","qwe12345","12345qwe"] ;
    if (array_search(strtolower($str),$arr_block_string)) {
        return "err_block_string";
    }

    //至少要有 EngNeed 個英文字和 1 個數字
    if($str_char >= $EngNeed && preg_match("/[0-9]/",$str)){
        return "chk_OK";
    }else{
        return "chk_wrong";
    }
}

/**
 * 日期验证
 * @param $str
 * @return bool
 */
function regexDate($str){
    if(!preg_match("/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$/",$str)){
        return false;
    }
    return true;
}

/**
 * 日期时间验证
 * @param $str
 * @return bool
 */
function regexDateTime($str){
    if(!preg_match("/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])\s+(20|21|22|23|[0-1]\d):[0-5]\d:[0-5]\d$/",$str)){
        return false;
    }
    return true;
}

/**
 * 结果转换
 * @param int $type 1:字符转数字，2：数字转字符
 * @param $status
 * @return string
 */
function status_num_str($type=1,$status=""){
    global $statusArr;
    if($type==1){
        return array_search($status,$statusArr);
    }else{
        return $statusArr[$status];
    }
}

/**
 * 公告类型转换
 * @param int $type 1:字符转数字，2：数字转字符
 * @param $announcement
 * @return string
 */
function announcement_num_str($type=1,$announcement=""){
    global $announcements;
    if($type==1){
        return array_search($announcement,$announcements);
    }else{
        return $announcements[$announcement];
    }
}

/**
 * 根据当前级别获取上级nid
 * @param $lv 当前账号级别
 * @param $nid 级别编码
 * @return false|string
 */
function this_sup_nid($lv,$nid){
    $num = 16;
    switch ($lv){
        case Constant::AD:
            $num *= 1;
            break;
        case Constant::D0:
            $num *= 2;
            break;
        case Constant::CO:
            $num *= 3;
            break;
        case Constant::SU:
            $num *= 4;
            break;
        case Constant::AG:
            $num *= 5;
            break;
        case Constant::MEM:
            $num *= 6;
            break;
    }
    if(strlen($nid) == 16){
        return $nid;
    }else{
        return substr($nid,0,$num);
    }

}

/**
 * 根据上级级别获取上级nid
 * @param $lv 上级级别
 * @param $nid 级别编码
 * @return false|string
 */
function sup_nid($lv,$nid){
    $num = 16;
    switch ($lv){
        case Constant::AD:
            $num *= 2;
            break;
        case Constant::D0:
            $num *= 3;
            break;
        case Constant::CO:
            $num *= 4;
            break;
        case Constant::SU:
            $num *= 5;
            break;
        case Constant::AG:
            $num *= 6;
            break;
        case Constant::MEM:
            $num *= 7;
            break;
    }
    if(strlen($nid) == 16){
        return $nid;
    }else{
        return substr($nid,0,$num);
    }

}

/**
 * 账户编码（nid）读取级别
 * @param $nid
 * @return array
 */
function lv_nid($nid){
    $lv = [];
    switch (strlen($nid)){
        case 16:
            $lv = [
                "lv" => Constant::ADS,
                "name" => "超管员"
            ];
            break;
        case 32:
            $lv = [
                "lv" => Constant::AD,
                "name" => "公司"
            ];
            break;
        case 48:
            $lv = [
                "lv" => Constant::D0,
                "name" => "分公司"
            ];
            break;
        case 64:
            $lv = [
                "lv" => Constant::CO,
                "name" => "股东"
            ];
            break;
        case 80:
            $lv = [
                "lv" => Constant::SU,
                "name" => "总代理"
            ];
            break;
        case 96:
            $lv = [
                "lv" => Constant::AG,
                "name" => "代理"
            ];
            break;
        case 112:
            $lv = [
                "lv" => Constant::MEM,
                "name" => "会员"
            ];
            break;
    }

    return $lv;
}


/**
 * nid查询等级
 * @param $nid
 * @return string
 */
function getNidOrLv($nid){
    $num = $nid/16;
    $lv = Constant::MEM;
    switch ($num){
        case 1:
            $lv = Constant::ADS;
            break;
        case 2:
            $lv = Constant::AD;
            break;
        case 3:
            $lv = Constant::D0;
            break;
        case 4:
            $lv = Constant::CO;
            break;
        case 5:
            $lv = Constant::SU;
            break;
        case 6:
            $lv = Constant::AG;
            break;
        case 7:
            $lv = Constant::MEM;
            break;
    }

    return $lv;
}

/**
 * 生成等级编码
 * @param string $nid 上级等级编码
 * @return string
 */
function set_nid($nid=""){
    return $nid.substr(md5(time().rand(1,100000)),0,16);
}

/**
 * ip归属地查询
 */
function getIP($ip=""){
    if(empty($ip)){ $ip = $_SERVER['REMOTE_ADDR'];}
    $db_Patch = VENDOR."/common/";
    $sity = iconv('GB2312', 'UTF-8', convertip($ip,$db_Patch));

    return ["ip"=>$ip,"sity"=>$sity];
}

/**
 * 日期区间
 * @param string $str
 * @return string[]
 */
function date_between($str=""){
    $start = " 00:00:00";
    $end = " 23:59:59";
    switch ($str){
        case "yes"://昨日
            $da = date("Y-m-d",strtotime("-1 day"));
            $start = $da.$start;
            $end = $da.$end;
            break;
        case "tm"://明日
            $da = date("Y-m-d",strtotime("1 day"));
            $start = $da.$start;
            $end = $da.$end;
            break;
        case "lw"://上周
            $first = 1;
            $date = date("Y-m-d");
            $w=date('w',strtotime($date));
            $stime = strtotime("{$date} -".($w ? $w - $first : 6).' days');
            $start = date('Y-m-d 00:00:00',$stime-7*24*60*60);
            $end = date("Y-m-d 23:59:59",$stime - 24*60*60);
            break;
        case "tw"://本周
            $first = 1;
            $date = date("Y-m-d");
            $w=date('w',strtotime($date));
            $stime = strtotime("{$date} -".($w ? $w - $first : 6).' days');
            $start = date('Y-m-d 00:00:00',$stime);
            $end = date("Y-m-d 23:59:59",$stime+6*24*60*60);
            break;
		case "aw":   
            $first = 1; 
            $date = date("Y-m-d"); 
            $w = date('w', strtotime($date));  
            $stime = strtotime("{$date} -" . ($w == 0 ? 6 : $w - 1) . ' days') + (7 * 24 * 60 * 60);  
            $start = date('Y-m-d 00:00:00', $stime);  
            $etime = $stime + (6 * 24 * 60 * 60);  
            $end = date('Y-m-d 23:59:59', $etime);     
           break;
        case "tp"://本期
            $issue = issue();
            $k = $issue["k"];
            $start = $issue["issue"][$k]["start"].$start;
            $end = $issue["issue"][$k]["end"].$end;
            break;
        case "lp"://上期
            $issue = issue();
            $k = $issue["k"] - 1;
            if($k == 0){//去年最后一期
                $issue = issue_last();
                $start = $issue[13]["start"].$start;
                $end = $issue[13]["end"].$end;
            } else {
                $start = $issue["issue"][$k]["start"].$start;
                $end = $issue["issue"][$k]["end"].$end;
            }
            break;
        case "ThisMonths"://本月
            $start = date('Y-m-01 00:00:00', strtotime(date("Y-m-d")));
            $end = date('Y-m-d 23:59:59', strtotime("{$start} +1 month -1 day"));
            break;
        case "LastMonths"://上月
            $start = date('Y-m-01 00:00:00', strtotime("-1 month"));
            $end = date('Y-m-d 23:59:59', strtotime("{$start} +1 month -1 day"));
            break;
        case "3Months"://最近3月
            $start = date('Y-m-01 00:00:00', strtotime("-3 month"));
            $end = date('Y-m-d H:i:s');
            break;
        case "6Months"://最近6月
            $start = date('Y-m-01 00:00:00', strtotime("-6 month"));
            $end = date('Y-m-d H:i:s');
            break;
        default://今日
            $start = date("Y-m-d").$start;
            $end = date("Y-m-d").$end;
            break;
    }
    return ["start"=>$start,"end"=>$end];

}

/**
 * 计算今年各期日期
 * @return array
 */
function issue(){
    $start = '2024-12-30';
    $k = 1;
    $d = 24*60*60;//1天
    $w = 4*7*$d;//4周
    $date = date("Y-m-d");

    $end = date("Y-m-d",strtotime($start) + $w);
    $arr = [];
    for($i=1;$i<=13;$i++){
        $arr[$i] = [
            "start" => $start,
            "end" => date("Y-m-d",strtotime($end) - $d)
        ];
        if($start<=$date && $date<=$end){
            $k = $i;
        }
        /*if($i==3 && date("Y",strtotime($start))==2020){
            $start = $end;
            $end = "2020-06-15";
        } else {*/
        $start = $end;
        $end = date("Y-m-d", strtotime($start) + $w);
        //}
    }

    return [
        "issue" => $arr,
        "k" => $k
    ];
}

/**
 * 计算去年各期日期
 * @return array
 */
function issue_last(){
    $start = '2024-1-1';
    $k = 1;
    $d = 24*60*60;//1天
    $w = 4*7*$d;//4周

    $end = date("Y-m-d",strtotime($start) + $w);
    $arr = [];
    for($i=1;$i<=13;$i++){
        $arr[$i] = [
            "start" => $start,
            "end" => date("Y-m-d",strtotime($end) - $d)
        ];
        $start = $end;
        $end = date("Y-m-d",strtotime($start) + $w);
    }

    return $arr;
}

/**
 * 报表-月帐期数设置
 * @return string
 */
function period_box(){
    $year = "2025";
    $last_year = "2024";

    $y_ary = issue()["issue"];
    $ly_ary = issue_last();
    $hs = [
        "y" => $year,
        "ly" => $last_year,
        "data" => []
    ];
    for($i=1;$i<=13;$i++){
        $ary = [];
        if(isset($y_ary[$i]["start"])){
            $start = date("Y/m/d",strtotime($y_ary[$i]["start"]));
            $end = date("Y/m/d",strtotime($y_ary[$i]["end"]));
            $str = "{$start} ~ {$end}";
        }else{
            $str = "&nbsp;";
        }

        if(isset($ly_ary[$i]["start"])) {
            $l_start = date("Y/m/d", strtotime($ly_ary[$i]["start"]));
            $l_end = date("Y/m/d", strtotime($ly_ary[$i]["end"]));
            $l_str = "{$l_start} ~ {$l_end}";
        }else{
            $l_str = "&nbsp;";
        }

        $ary["se"] = $str;
        $ary["l_se"] = $l_str;
        $hs["data"][$i] = $ary;
    }

    return $hs;
}

/**
 * MD5加密
 * @param $pwd
 * @return string
 */
function md5Pwd($pwd){
    return md5(md5($pwd));
}

/**
 * 生成32个随机字符
 * @param $param
 * @return string
 */
function getRandom($param)
{
    $str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    $key = "";
    for ($i = 0; $i < $param; $i++) {
        $key .= $str[mt_rand(0, 32)];    //生成php随机数
    }
    return $key;
}

/**
 * ltype转换数字
 * @param $ltype
 * @return int
 */
function ltype_num($ltype){
    $num = 3;
    switch($ltype){
        case 'A':
            $num = 1;
            break;
        case 'B':
            $num = 2;
            break;
        case 'C':
            $num = 3;
            break;
        case 'D':
            $num = 4;
            break;
    }

    return $num;
}

/**
 * 获取Xml节点值
 * @param $xml
 * @param $str
 * @return mixed
 */
function getXmlNode($xml, $str)
{
    preg_match("/\<{$str}>(.*?)\<\/{$str}>/is", $xml, $arr);
    return isset($arr[1]) ? rtrim($arr[1]) : "";
}

/**
 * 根据id返回mid
 * @param $id
 * @return int
 */
function returnMID($id){
    $mid = 24627157 + $id;
    return $mid;
}

/**
 * 数字转换ltype
 * @param $num
 * @return string
 */
function num_ltype($num){
    $ltype = "C";
    switch ($num){
        case 1:
            $ltype = "A";
            break;
        case 2:
            $ltype = "B";
            break;
        case 3:
            $ltype = "C";
            break;
        case 4:
            $ltype = "D";
            break;
    }

    return $ltype;
}

/**
 * game 拆分 如：FT_R_3_WAR
 * @param $str
 * @return array
 */
function game_split($str){
    $a = explode("_",$str);
    return [
        "gtype"=>$a[0],
        "type"=>$a[1]."_".$a[2],
        "rtype"=>$a[1],
        "ltype"=>$a[2],
        "game_num" => $a[3]
    ];
}

function utf8_gbk($str){
    //$str = iconv("UTF-8","gbk//TRANSLIT",$str);
    return $str;
}

/**
 * 赛事时间处理
 * @param $dtime
 * @return array
 */
function match_start($dtime){
    $mdate=explode(' ',strtoupper($dtime));
    $m_date=$mdate[0];
    $m_time=strtolower($mdate[1]);
    $hhmmstr=explode(":",$m_time);
    $hh=$hhmmstr[0];
    $ap=substr($m_time,strlen($m_time)-1,1);

    if ($ap=='p' and $hh<>12){
        $hh+=12;
    }

    $dd=explode("-",$m_date);
    if($dd[0]<>12 and date('m')==12){
        $yy=date('Y')+1;
    }else{
        $yy=date('Y');
    }
    $timestamp = $yy."-".$m_date." ".$hh.":".substr($hhmmstr[1],0,strlen($hhmmstr[1])-1).":00";
    return array($m_date,$m_time,$timestamp);
}

/**
 * 球类/名称互换 如：FT=足球
 * @param $type 类型
 * @param string $isGtype Y:球类编码转名称,N:球类名称转编码
 * @return false|int|string
 */
function gtypeOrName($type,$isGtype="Y"){
    global $gtypes;

    if($isGtype=="Y"){
        return $gtypes[$type];
    }else{
        return array_search($type,$gtypes);
    }
}

/**
 * ABCD盘赔率转换
 * @param $ltype 盘符
 * @param $ioratio 赔率
 * @return int
 */
function chg_ioratio($ltype,$ioratio){

    switch(strtoupper($ltype)){
        case 'A':
            $t_rate='0.04';
            break;
        case 'B':
            $t_rate='0.02';
            break;
         case 'C':
             $t_rate='0.01';
            break;
        case 'D':
             $t_rate='0';
            break;
    }

    $chg_ioratio=round($ioratio-$t_rate,2);
    return $chg_ioratio;
}

/**
 * 修改注单者级别转换
 * @param $layer
 * @param int $num 0:数字转字符，1：字符转数字
 * @return int|string
 */
function edit_layer_num_str($layer,$num=0){
    $lay = "";
    if($num == 0){
        switch ($layer){
            case 0://超管
                $lay = Constant::ADS;
                break;
            case 1://公司
                $lay = Constant::AD;
                break;
            case 2://分公司
                $lay = Constant::D0;
                break;
            case 3://股东
                $lay = Constant::CO;
                break;
        }
    }else{
        switch ($layer){
            case Constant::ADS://超管
                $lay = 0;
                break;
            case Constant::AD://公司
                $lay = 1;
                break;
            case Constant::D0://分公司
                $lay = 2;
                break;
            case Constant::CO://股东
                $lay = 3;
                break;
        }
    }
    return $lay;
}
