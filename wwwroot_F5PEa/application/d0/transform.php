<?php
include_once "./include/config.php";
//启动session的初始化
session_start();
$_p = $_POST;
if(empty($_p["p"])){
    @error_log(date("Y-m-d H:i:s")." [d0_404] empty-p uri=".($_SERVER["REQUEST_URI"]??"-")." ref=".($_SERVER["HTTP_REFERER"]??"-")." ip=".($_SERVER["REMOTE_ADDR"]??"-")." keys=".implode(",",array_keys($_p))."\n", 3, ROOT_PATH."/_d0_404_debug.log");
    error_400();
}
define("_POST_",serialize($_p));
$langx = empty($_p["langx"]) ? "zh-cn" : $_p["langx"];
//通过参数"p"追踪目录
$filesName = $_p["p"].".php";
$p_arr = explode("_",$_p["p"]);
$dir = ROOT_PATH."/application/d0";
$dirLists = getDirs($dir);//文件夹列表
$dirHtml = "";//html文件路径
if(!in_array($p_arr[0],$dirLists)){
    if(count($p_arr) == 1 && file_exists($p_arr[0].".php")){ //根目录
        $dirHtml = "{$_p["p"]}.html";
        include_once $dir."/".$p_arr.".php";exit;
    }else{
        if(isDirFiles($dir."/other",$filesName)){//如果other文件夹存在
            $dirHtml = "other/{$_p["p"]}.html";
            include_once $dir."/other/".$filesName;exit;
        }
    }
}

$isPhpFiles = false;//是否存在p文件
foreach ($p_arr as $k => $v){
    if(!is_dir($dir)){//目录不存在
        $isPhpFiles = false;
        break;
    }
    $dirLists = getDirs($dir);//文件夹列表
    $dir .= "/".$v;
    $dirHtml .= $v."/";

    if(in_array($v,$dirLists) && isDirFiles($dir,$filesName)){
        $isPhpFiles = true;
        break;
    }
}

if($isPhpFiles){
    $dirHtml .= "{$_p["p"]}.html";
    include_once $dir."/".$filesName;
    exit;
}else{
    @error_log(date("Y-m-d H:i:s")." [d0_404] unresolved p=".$_p["p"]." dir=".$dir." dirHtml=".$dirHtml." uri=".($_SERVER["REQUEST_URI"]??"-")." ref=".($_SERVER["HTTP_REFERER"]??"-")." ip=".($_SERVER["REMOTE_ADDR"]??"-")." keys=".implode(",",array_keys($_p))."\n", 3, ROOT_PATH."/_d0_404_debug.log");
    error_400();
}








