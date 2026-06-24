function index(_win, _dom){
    var _self = this;
    var win = _win;
    var dom = _dom;
    var parentClass;
    var classname = "index";
    var classHash = new Object();
    var _top = new Object();
    var timerHash = new Object();
    var pageHash = new Object();

    var util = new win.util(win,dom);
    var config_set = new win.config_set();
    var Timer = win.Timer;
    var LS;
    var LS_code;
    var LS_report;
    var LS_account;
    var getView = win.getView;
    var fastTemplate_a1 = win.fastTemplate_a1;
    var cookie = new CookieManager();
    var Storage = new LocalstorageManager();
    var selLayer = "A";

    var cache_html_sw = false;
    var topFrame = null;
    var leftFrame = null;
    var bottomFrame = null;
    var bodyFrame = null;
    var alertFrame = null;
    var alertChooseFrame = null;
    var noticeFrame = null;
    var annoFrame = null;
    var filterFrame = null;
    var detailFrame = null;
    var teachFrame = null;

    //Ricky
    var loginFrame;
    var homePage = false;

    var eventHandler = new Object();
    // var total_frame = 6;
    // var now_frame = 0;
    var first_load = false;
    var failCount = new Object();
    var retryTimer;

    //arvin
    var codeAlert = null; //淡出淡入DOM
    var setTimeContainer = null;
    var codeAlertClassName ;
    var defalutPage = false;
    var filter_set = new Object();
    var arr_check_all_div = {
        "top_menu_show": false,
        "left_menu_show": false,
        "bottom_menu_show": false,
        "alert_show": false,
        "newnote_show": false,
        "anno_show": false
    };

    win._history = new Array();

    //Ricky
    // util.getWebUrl() already includes protocol + host + port + module prefix.
    top.url = util.getWebUrl()+"/transform.php";
    top.param = "";
    top.keep_head = ",index,top_menu,left_menu,bottom_menu,alert_msg,";
    top.popWindow = new Object();

    _self.init=function(){
        for (var key in arr_check_all_div) {
            arr_check_all_div[key] = false ;
        }
        _self.clearAllOpenWindow();
        _self.chg_langx(top.ls);
        config_set.init();

        _self.lockScaled();
        if (win.addEventListener) win.addEventListener("popstate", _self.popstate);
        if (win.addEventListener) win.addEventListener("orientationchange", _self.Allorientation);
        if (win.addEventListener) win.addEventListener("resize", _self.footHide);
        if (dom.addEventListener) dom.addEventListener("scroll", _self.footHide);
        _self.addEventListener("bodyGoToPage", _self.bodyGoToPage);
        _self.addEventListener("goToPage", _self.goToPageEvent);
        _self.addEventListener("newOpenPage", _self.newOpenPageEvent);
        _self.addEventListener("newOpenPageNoPar", _self.newOpenPageNoParEvent);
        _self.addEventListener("showLoading", _self.showLoading);
        _self.addEventListener("backPage", _self.backPage);
        _self.addEventListener("hideDiv", _self.hideDiv);
        _self.addEventListener("chgPwdSafe", _self.chgPwdSafe);
        _self.addEventListener("chgLoginID", _self.chgLoginID);
        _self.addEventListener("chgPwd", _self.chgPwd);
        _self.addEventListener("forgotPwd", _self.forgotPwd);
        _self.addEventListener("backToIdex", _self.backToIdex);
        _self.addEventListener("showAlertMsg", _self.showAlertMsg);
        _self.addEventListener("hideAlertMsg", _self.hideAlertMsg);
        _self.addEventListener("showAlertChooseMsg", _self.showAlertChooseMsg);
        _self.addEventListener("hideAlertChooseMsg", _self.hideAlertChooseMsg);
        _self.addEventListener("showAnno", _self.showAnno);
        _self.addEventListener("hideAnno", _self.hideAnno);
        _self.addEventListener("chgPageName", _self.chgPageName);
        _self.addEventListener("showFilter", _self.showFilter);
        _self.addEventListener("showOverviewFilter", _self.showOverviewFilter);
        _self.addEventListener("hideFilter", _self.hideFilter);
        _self.addEventListener("changeFilter", _self.changeFilter);
        _self.addEventListener("showFilterLoading", _self.showFilterLoading);
        _self.addEventListener("closeFilterLoading", _self.closeFilterLoading);
        _self.addEventListener("openLeftMenu", _self.openLeftMenu);
        _self.addEventListener("closeLeftMenu", _self.closeLeftMenu);
        _self.addEventListener("closeNote", _self.closeNote);
        _self.addEventListener("closeNotice", _self.closeNotice);
        _self.addEventListener("showReportDetail", _self.showReportDetail);
        _self.addEventListener("showBetDetail", _self.showBetDetail);
        _self.addEventListener("showBetEdit", _self.showBetEdit);
        _self.addEventListener("showBetResult", _self.showBetResult);
        _self.addEventListener("hideReportDetail", _self.hideRightDetail);
        _self.addEventListener("hideEditDetail", _self.hideRightEditDetail);
        _self.addEventListener("showAccDetail", _self.showAccDetail);
        _self.addEventListener("hideAccDetail", _self.hideRightDetail);
        _self.addEventListener("showMemHistory", _self.showMemHistory);
        _self.addEventListener("hideMemHistory", _self.hideRightDetail);
        _self.addEventListener("showProblemAccDetail", _self.showProblemAccDetail);
        _self.addEventListener("hideProblemAccDetail", _self.hideRightDetail);
        _self.addEventListener("viewReportTeach", _self.viewReportTeach);
        _self.addEventListener("hideReportTeach", _self.hideReportTeach);
        _self.addEventListener("showReport", _self.showReport);
        _self.addEventListener("showFadeOutMesg", _self.showFadeOutMesg);
        _self.addEventListener("AnnCountBroadcastData", _self.AnnCountBroadcastData);
        _self.addEventListener("getPromblemCount", _self.getPromblemCount);
        _self.addEventListener("backToTop", _self.backToTop);
        _self.addEventListener("chooseLayer", _self.chooseLayer);
        _self.addEventListener("chooseLan", _self.chooseLan);
        _self.addEventListener("chgLeftMenuColor", _self.chgLeftMenuColor);
        _self.addEventListener("chgLangx", _self.chgLangx);
        _self.addEventListener("loadImportantAnno", _self.loadImportantAnno);
        _self.addEventListener("SetConfirmExit", _self.SetConfirmExit);
        _self.addEventListener("ConfirmExitAlert", _self.ConfirmExitAlert);
        _self.addEventListener("showResultDetail", _self.showResultDetail);
        _self.addEventListener("hideResultDetail", _self.hideRightDetail);
        _self.addEventListener("showMatchEdit", _self.showMatchEdit);

        //2019-04-12 Ricky 408.右邊控制板-選擇語言後頁面沒有改變
        if(top.rightChg == "Y"){
            _self.clearAllTimer(true);
            _self.hideDiv({"target":"acc_show"});
            //top.rightChg = "N";
        }else{
            //login
            _self.goToPage("acc_show", "login", function(){
                loginFrame = new win.login(win,dom);
                loginFrame.setParentclass(_self);
                loginFrame.init();
            },{});
            util.setParentclass(_self);
        }

        try{
            var load_name = dom.getElementById("load_txt");
            load_name.innerHTML = LS.get("loading_txt");
            var load_name02 = dom.getElementById("load_txt02");
            load_name02.innerHTML = LS.get("loading_txt");
        }catch(e){}

        //Dashboard表頭在768尺寸以下時，往下滑動需消失
        var tarDiv = dom.getElementById("body_show");
        var tarObj = new Object();
        tarObj["menu"] = dom.getElementById("top_menu_show");
        tarObj["main"] = dom.getElementById("dashboard_main");
        tarObj["backtop"] = dom.getElementById("backtop");

        var retFun = function (e) {
            util.checkScrollToHide(e, tarObj);
        }
        // 2019-05-03 L.所有頁面-移除"返回頂部"的按鈕
        // tarDiv.addEventListener("scroll", retFun, false);
        //util.addEvent(tarDiv, "scroll", util.checkScrollToHide, tarObj);
        util.addEvent(dom.getElementById("backtop"), "click", _self.backToTop);

        try {//IE8這邊會掛掉
            codeAlert = dom.getElementById("codeAlert");
            codeAlertClassName = codeAlert.className;
            codeMsg = dom.getElementById("codeMsg");

            dom.addEventListener('touchmove', _self.doOnTouchMove);
            dom.getElementById("body_show").addEventListener('touchmove', _self.doOnTouchMove);

            // 2019-03-26 鎖住橡皮筋
            lockscroll = new bodyPreventDefault();
            lockscroll.init();
        }catch(e){};
    }

    // 2019-06-20 n.高度414px以下-頁面樣式幫秀768設計請幫將捲軸至頂(PJP-653-1)  - Roy
    _self.Allorientation = function(){
        var orientation = win.Math.abs(win.orientation);
        if(orientation == 90) {
            dom.body.scrollTop = 0;
            setTimeout(function() {
                window.scrollTo(0, 1)
            }, 500);
        }else{
            // 2019-06-20 559.iphone XS max-首頁-手機橫向轉成直向時, 頁面下方多一塊空白(PJP-653-2) - 轉換class讓他重新判斷高度 - Roy
            var mainObj = dom.getElementById("main");
            mainObj.className = "main_rotate";
            setTimeout(function(){
                mainObj.className = "main";
            },500);
        }
        _self.sizeChange() ;
    }
    //畫面改變時 fixed 的物件顯示會異常, 異動class 觸發畫面重新偵測
    _self.sizeChange = function () {
        var tmpObj = dom.getElementById("main");
        if (tmpObj) {
            tmpObj.classList.add("nofixed");
            setTimeout(function () { tmpObj.classList.remove("nofixed"); }, 450);
        }
    }

    _self.chgLangx=function(param){
        if (bodyFrame && bodyFrame.exitConfirm && !bodyFrame.LeaveChk && !param.LeaveChkPass) {
            dom.getElementById("alert_choose_show").style.display = "none";
            return _self.exitConfirm(_self.chgLangx, param, bodyFrame.exitConfirm);
        }
        // _self.chg_langx(param.ls);
        top.ls = param.ls;
        top.langx = param.langx;
        selLayer = param.selLayer;
        //2019-04-12 Ricky 408.右邊控制板-選擇語言後頁面沒有改變
        //如果是從右邊控制板調語系，hasLogin = Y;
        if(param.rightChg == "Y") top.rightChg = "Y";
        else top.rightChg = "N";
        _self.init();
        dom.getElementById("alert_choose_show").style.display = "none";
    }

    _self.clearAllOpenWindow = function(){
        for(var i in top.popWindow){
            try{
                if(!top.popWindow[i].closed){
                        top.popWindow[i].window.close();
                }
            }catch(e){}
        }
    }

    _self.chg_langx=function(ls){
        LS = eval("new LS_"+ls+"();");
        LS_code = eval("new LS_code_"+ls+"();");
        LS_report = eval("new LS_report_"+ls+"();");
        LS_account = eval("new LS_account_"+ls+"();");

        LS.init();
        LS_code.init();
        LS_report.init();
        LS_account.init();
    }

    _self.backToTop=function(){
        dom.getElementById("body_show").scrollTop = 0;
    }

    _self.setParentclass=function(_parentclass){
        parentClass = _parentclass;
    }

    _self.getThis=function(varible){
        return eval(varible);
    }

    _self.addCSSretry=function(){
        var ary = dom.getElementsByTagName("link");
        // util.echo(ary.length);
        for(var i=0; i<ary.length; i++){
            // util.echo(ary[i].href);
        }

    }

    _self.showLoading=function(param){
        if(!defalutPage) defalutPage = param.defalutPage;
        else _self.setLoadingVisible(param.showLoading);
    }

    _self.setLoadingVisible=function(isShow){
        //console.log(first_load);
        // util.echo("[setLoadingVisible]"+isShow);
        if(first_load) dom.getElementById("loading").style.display = isShow?"":"none";
        //dom.getElementById("loading").style.display = isShow?"":"none";
    }

    /*
    * param.page
    * param.retFun
    */
    _self.bodyGoToPage=function(param){
        if (bodyFrame && bodyFrame.exitConfirm && !bodyFrame.LeaveChk && !param.LeaveChkPass) {
            //exitConfirm 離開確認參數
            //LeaveChk confirm後可否離開
            //LeaveChkPass param帶參數強制掉過此判斷
            _self.exitConfirm(_self.bodyGoToPage, param, bodyFrame.exitConfirm);
            return;
        } else {
            //每次換頁就先初始class
            dom.getElementById("top_menu_show").className="ma_header";
            dom.getElementById("dashboard_main").className="ma_main";
            dom.getElementById("bottom_menu_show").className = "ma_foot";
            if (topFrame) topFrame.onKeyBoardOpen(false);
            dom.getElementById("body_show").className ="ma_content";

            _self.setLoadingVisible(true);

            var ret = false;
            if (bodyFrame && bodyFrame.exitEvent){
                ret = bodyFrame.exitEvent();
            }else{
                ret = true;
            }

            if (win._history.length > 0){
                if(param.page == "dashboard_main") {//不管動作是回到哪一步驟, 點至首頁時麻煩返回鍵都幫拿掉(PJP-413)
                    topFrame.closebackBtn();
                    win._history = new Array();
                    homePage = true;
                }else {
                    homePage = false;
                    topFrame.openbackBtn();
                }
            }

            if(ret){
                ret = _self.clearAllTimer();
                if(ret) _self.goToPage("body_show", param.page, _self.definedParent, param);
            }
        }
    }

    _self.definedParent=function(param){
        try{
            var obj = classHash[param.page];
            if(param["extendsClass"]){
                obj = util.extendsClass(eval("new "+param["extendsClass"]+"(win,dom,param.postHash)"), eval(param.page), win, dom, param["postHash"]);
            }else{
                obj = eval("new "+param.page+"(win,dom,param.postHash);");
            }

            if(param.isTrans=="Y"){
                var parantClass = (param.parentClass!=null)?param.parentClass:_self;
                obj.setParentclass(parantClass);
                obj.init();
                if (param.retChild) param.retChild(obj);//if (param.hasOwnProperty("retChild")) param.retChild(obj);
            }else{
                bodyFrame = obj;
                bodyFrame.setParentclass(_self);
                bodyFrame.init();
            }
        }catch(e){
            console.log(e);
            util.err("[definedParent]["+param.page+"]", e);
        }
        _self.backToTop();

        if( (param.back!="Y" || homePage) && param.isTrans!="Y" ){
	        _self.pushHistory(param, "", param.page);
        }

        if(param.retFun) param.retFun(param.retParam);
        if (param.pageName) _self.chgPageName({ "pageType": param.pageType, "pageName": param.pageName, "uniqText": param.uniqText});

    }

    _self.chgPageName=function(param){
        if(topFrame) topFrame.setPageName(param);
    }

    //============ report detail ============
    _self.showReportDetail=function(param){
        param.parse = "Y";
        param.page = "report_detail";
        _self.showRigthDetail(param, _self.show_report_detail);
    }


    _self.show_report_detail=function(){
        _self.chgRightClass("report_detail");
    }
    //============ report detail ============

    //============ bet detail ============
    _self.showBetDetail=function(param){
        param.parse = "Y";
        param.page = "bet_detail";
        _self.showRigthDetail(param, _self.show_bet_detail);
    }


    _self.show_bet_detail=function(){
        _self.chgRightClass("bet_detail");
    }
    //============ bet detail ============

    //============ bet edit detail ============
    _self.showBetEdit=function(param){
        param.parse = "Y";
        param.page = "bet_edit_detail";
        _self.showRigthDetail(param, _self.show_bet_edit_detail);
    }


    _self.show_bet_edit_detail=function(){
        _self.chgRightClass("bet_edit_detail");
    }
    //============ bet edit detail ============

    //============ bet result detail ============
    _self.showBetResult=function(param){
        param.parse = "Y";
        param.page = "bet_result_detail";
        _self.showRigthDetail(param, _self.show_bet_result_detail);
    }


    _self.show_bet_result_detail=function(){
        _self.chgRightClass("bet_result_detail");
    }
    //============ bet result detail ============

    //============ acc detail ============
    _self.showAccDetail=function(param){
        param.parse = "Y";
        param.page = "acc_detail";
        _self.showRigthDetail(param, _self.show_acc_detail);
    }

    _self.show_acc_detail=function(){
        _self.chgRightClass("acc_detail");
    }

    //============ acc detail ============


    //============ mem history ============
    _self.showMemHistory=function(param){
	    _self.showRigthDetail(param, _self.show_mem_history);
    }

    _self.show_mem_history=function(){
        _self.chgRightClass("mem_history");
    }
    //============ mem history ============

    //============ problem Acc Detail= ===========
    _self.showProblemAccDetail=function(param){
        param.parse = "Y";
        param.page = "problem_accounts_detail";
        _self.showRigthDetail(param, _self.show_ProBlemAcc_detail);
    }

    _self.show_ProBlemAcc_detail=function(){
        _self.chgRightClass("problem");
    }
    //============ problem Acc Detail ============

    //============ results detail ============
    _self.showResultDetail=function(param){
        _self.showResultRigthDetail(param, _self.show_result_detail);
    }

    _self.show_result_detail=function(){
        _self.chgRightClass("result_detail");
    }

    _self.showResultRigthDetail=function(param, showFun){
        dom.getElementById("right_show").style.display = "";

        if(detailFrame==null){
            _self.goToPage("right_show", param.page, function(){
                try{
                    detailFrame = eval("new win."+param.gtype+"_"+param.page+"(win,dom,param.postHash);");
                    detailFrame.setParentclass(_self);
                    detailFrame.init();
                    if(param.parse=="Y") detailFrame.parseData(param);
                    _self.clearDuplicate();

                    if(showFun) showFun();
                }catch(e){
                    util.err("[loadRigthDetail]["+param.page+"]", e);
                }
            }, param);
        }else{
            if(param.parse=="Y"){
                detailFrame.parseData(param);
            }else{
                detailFrame.reinit(param.postHash);
            }
            if(showFun) showFun();
        }
    }
    //============ results detail ============

    //============ match edit ============
    _self.showMatchEdit=function(param){
        _self.showMatchRigthEdit(param, _self.show_match_edit);
    }

    _self.show_match_edit=function(){
        _self.chgRightClass("match_edit");
    }

    _self.showMatchRigthEdit=function(param, showFun){
        dom.getElementById("right_show").style.display = "";

        if(detailFrame==null){
            _self.goToPage("right_show", param.page, function(){
                try{
                    detailFrame = eval("new win."+param.gtype+"_"+param.page+"(win,dom,param.postHash);");
                    detailFrame.setParentclass(_self);
                    detailFrame.init();
                    if(param.parse=="Y") detailFrame.parseData(param);
                    _self.clearDuplicate();

                    if(showFun) showFun();
                }catch(e){
                    util.err("[loadRigthDetail]["+param.page+"]", e);
                }
            }, param);
        }else{
            if(param.parse=="Y"){
                detailFrame.parseData(param);
            }else{
                detailFrame.reinit(param.postHash);
            }
            if(showFun) showFun();
        }
    }
    //============ match edit ============

    // 2019-03-27 50.帳號管理-360尺寸-帳號列表-會員層-點擊會員id秀出的右側交易狀況, 應要直接覆蓋整頁
    _self.chgRightClass=function(targetObj){
        var sty = "";
        util.classFunc(dom.getElementById("right_show"), ["w200px","w360px","w100per"], "remove");
        switch(targetObj){
            case "problem":
            case "acc_detail":
                sty = "w200px";
                break;
            case "mem_history":
                sty = (getView().viewportwidth < 599)? "w100per" : "w360px";
                break;
            case "report_detail":
            case "bet_detail":
                sty = (getView().viewportwidth < 768)? "w200px" : "w360px";
                break;
            case "bet_edit_detail":
            case "bet_result_detail":
            case "result_detail":
            case "match_edit":
                sty = (getView().viewportwidth < 768)? "w100per" : "w360px";
                break;
        }
        util.classFunc(dom.getElementById("right_show"), [sty,"ma_extend"]);
    }

    _self.showRigthDetail=function(param, showFun){
        dom.getElementById("right_show").style.display = "";

        if(detailFrame==null){
            _self.goToPage("right_show", param.page, function(){
                try{

                    detailFrame = eval("new win."+param.page+"(win,dom,param.postHash);");
                    detailFrame.setParentclass(_self);
                    detailFrame.init();
                    if(param.parse=="Y") detailFrame.parseData(param);
                    _self.clearDuplicate();

                    if(showFun) showFun();
                }catch(e){
                    util.err("[loadRigthDetail]["+param.page+"]", e);
                }
            }, param);
        }else{
            if(param.parse=="Y"){
                detailFrame.parseData(param);
            }else{
                detailFrame.reinit(param.postHash);
            }
            if(showFun) showFun();
        }
    }

    _self.hideRightDetail=function(isGoPage){
        if (dom.getElementById("right_show").classList){
            dom.getElementById("right_show").classList.remove("ma_extend");
        }else{
            dom.getElementById("right_show").className = "ma_right w200px";
        }
        // 2019-05-02 511.報表-查看細單層-若點擊某一細單並彈出右側詳細內容後, bet detials底色應要停留在被點擊的那一行注單(PJP-566)
        if(bodyFrame!=null && bodyFrame._super && isGoPage==null) bodyFrame._super.closeAccDetail();
        //totalbets 細單側邊細單關掉移除底色
        if(bodyFrame!=null && bodyFrame.closeAccDetail && isGoPage==null) bodyFrame.closeAccDetail();
        // if(bodyFrame.closeAccDetail) bodyFrame.closeAccDetail();
        detailFrame = null;
    }

    _self.hideRightEditDetail=function(isGoPage){
        if (dom.getElementById("right_show").classList){
            dom.getElementById("right_show").classList.remove("ma_extend");
        }else{
            dom.getElementById("right_show").className = "ma_right w200px";
        }
        // 2019-05-02 511.報表-查看細單層-若點擊某一細單並彈出右側詳細內容後, bet detials底色應要停留在被點擊的那一行注單(PJP-566)
        if(bodyFrame!=null && bodyFrame._super && isGoPage==null) bodyFrame._super.closeAccEditDetail();
        //totalbets 細單側邊細單關掉移除底色
        if(bodyFrame!=null && bodyFrame.closeAccEditDetail && isGoPage==null) bodyFrame.closeAccEditDetail();
        // if(bodyFrame.closeAccDetail) bodyFrame.closeAccDetail();
        detailFrame = null;
    }



    _self.viewReportTeach=function(param){
        _self.goToPage("acc_show", "report_teach", function(){
            try{
                dom.getElementById("home_show").style.display = "none";
                dom.getElementById("acc_show").style.display = "";
                teachFrame = new win.report_teach(win,dom);
                teachFrame.setParentclass(_self);
                teachFrame.init();
            }catch(e){
                util.err("[viewReportTeach][report_teach]", e);
            }
        }, param);
    }

    _self.showReport=function(param){
        dom.getElementById("home_show").style.display = "";
    }

    _self.hideReportTeach=function(param){
        dom.getElementById("acc_show").style.display = "none";
        teachFrame = null;
    }

    _self.showFilter=function(param){
        if(filterFrame==null){
            _self.goToPage("filter_show", "report_filter", function(){
                try{
                    filterFrame = new win.report_filter(win,dom);
                    filterFrame.setParentclass(_self);
                    filterFrame.init();
                    filterFrame.initFilter(param);
                }catch(e){
                    util.err("[showFilter][report_filter]", e);
                }
            }, param);
        }else{
            filterFrame.initFilter(param);
        }
        _self.showDiv({"type":"filter_show"});
    }

    _self.showOverviewFilter = function (param) {
        if (filterFrame == null) {
            _self.goToPage("filter_show", "wmc_filter", function () {
                try {
                    filterFrame = new win.wmc_filter(win, dom);
                    filterFrame.setParentclass(_self);
                    filterFrame.init();
                    filterFrame.initFilter(param);
                } catch (e) {
                    util.err("[showFilter][wmc_filter]", e);
                }
            }, param);
        } else {
            filterFrame.initFilter(param);
        }
        _self.showFilterLoading();
        _self.showDiv({ "type": "filter_show" });
    }

    _self.hideFilter=function(param){
        _self.showDiv({"type":"home_show"});
        try{
            bodyFrame.hideFilter(param);
        }catch(e){
            util.err("[hideFilter]", e);
        }

        filterFrame = null;
    }

    _self.changeFilter=function(param){
        try{
            bodyFrame.changeFilter(param);
        }catch(e){
            util.err("[changeFilter]", e);
        }
        _self.hideFilter(null);
    }

    _self.showFilterLoading=function(param){
        try{
            dom.getElementById("filter_loading").style.display = "";
        }catch(e){
            // util.err("[filter_loading]", e);
        }
    }

    _self.closeFilterLoading=function(param){
        try{
            dom.getElementById("filter_loading").style.display = "none";
        }catch(e){
            // util.err("[filter_loading]", e);
        }
    }
    /*
    * param.target
    * param.page
    * param.retFun
    * param.post
    */
    _self.goToPageEvent=function(param){
        param.isTrans =  param.isTrans || "Y";
        var retFunc = ( param.useDefineParent=="Y")? _self.definedParent : param.retFun;
        if( (param.back!="Y" || homePage) &&  param.backGoToPage == "Y" ){
	        _self.pushHistory(param, "", param.page);
        }
        _self.goToPage(param.target, param.page, retFunc, param);
    }

    _self.goToPage=function(target, page, retFun, param){

        //util.echo("target:"+target+"==page:"+page+"==retFun:"+retFun+"==param:"+param, "goToPage");
        _self.hideRightDetail(true);
        clearTimeout(retryTimer);
        if(!failCount[page]) failCount[page] = 0;

        var page_name = target+"_"+page+"_"+top.ver;
        var retryLimit = config_set.get("RETRY_LIMIT");
        var retryTime = config_set.get("RETRY_TIME");

        // 2019-06-14 report_index.js 會在 init 加入 orientationchange 事件，但是離開該頁面卻沒有移除
        if(page.indexOf("report")==-1) util.removeEvent(win, "orientationchange");

        var ht = new win.HttpRequest();
        //console.log(ht);
        ht.addEventListener("onError", function(){
            if(failCount[page] < retryLimit){
                failCount[page]++;
                retryTimer = setTimeout(_self.goToPage, retryTime, target, page, retFun, param);
            }else{
                if(target=="body_show") bodyFrame.init();
                _self.setLoadingVisible(false);
            }
        });

        ht.addEventListener("LoadComplete", function(html){
            failCount[page] = 0;
            //util.echo("[loadHtml]"+html);
            var tempHtml = new win.parseHTML(html);
            var dbody = tempHtml.getTag("div")[0];
            var sty = tempHtml.getTag("style");
            var scp = tempHtml.getTag("script");

            if(!dbody){
                try{
                    var errHash = JSON.parse(html);
                    if(util.chkErrorMsg(errHash,LS_code)) return;
                }catch(e){
                    util.err("["+classname+"]", e);
                }
            }

            // 將不必要的js css移除，避免負擔
            var ret = false;
            if (first_load && target=="body_show"){
                ret =  _self.clearHead();
            }else{
                _self.clearDuplicate();
                ret = true;
            }
            if(ret){
                for(var j=0; j<scp.length; j++){
                    try{
                        var scpt = document.createElement("script");
                        if(scp[j].src){
                            scpt.src = scp[j].src;
                        }else{
                            scpt.innerHTML = scp[j].innerHTML;
                            scpt.id = page+"JS";
                        }
                        dom.getElementsByTagName("head")[0].appendChild(scpt);
                    }catch(e){
                        util.err("["+classname+"]", e);
                    }
                }

                for(var i=0; i<sty.length; i++){
                    sty[i].id = page+"CS";
                    dom.getElementsByTagName("head")[0].appendChild(sty[i]);
                }

                pageHash[page_name] = dbody.innerHTML;
                //console.log(target);
                dom.getElementById(target).innerHTML = dbody.innerHTML;
                retFun(param);
            }
        });

        if(cache_html_sw && pageHash[page_name]){
            dom.getElementById(target).innerHTML = pageHash[page_name];
            retFun(param);
        }else{
            var _post = "p="+page+"&ver="+top.ver+"&login_layer="+top.login_layer+"&langx="+top.langx;
            if(top.uid!="")_post+="&uid="+top.uid;
            if(param.post) _post+="&"+param.post;
            //ht.loadURL(util.getWebUrl()+"/transform.php", "POST" , _post);
            ht.loadURL(top.url, "POST" , _post);
        }

    }

    _self.footHide = function (e) {
        //524.所有輸入框-當出現內建鍵盤時,底部控制版要消失(PJP-625)
        //android keyboard 會把視窗往上推 所以用resize做觸發
        //safari keyboard 會觸動document scroll 所以用scroll做觸發
        // alert(dom.activeElement.tagName);
        // alert(dom.activeElement.tagName);
        var id =  dom.activeElement.id;
        if ((dom.activeElement.tagName == "INPUT" && id!="loginBtn") || (dom.activeElement.tagName == "SELECT"  && id!="loginBtn")){
            dom.getElementById("dashboard_main").className = "ma_main_foothide";
            dom.getElementById("bottom_menu_show").className = "hide_item";
            if (topFrame) topFrame.onKeyBoardOpen(true);
        } else {
            dom.getElementById("dashboard_main").className = "ma_main";
            dom.getElementById("bottom_menu_show").className = "ma_foot";
            if (topFrame) topFrame.onKeyBoardOpen(false);
        }
    }

    _self.clearHead=function(){
        var ori_head = dom.getElementsByTagName("head")[0].children;
        var sty_len = ori_head.length;
        for(var i = sty_len-1; i >= 0; i--){
            var realID = ori_head[i].id.substr(0,ori_head[i].id.length-2);
            if( (ori_head[i].tagName=="STYLE" || ori_head[i].tagName=="SCRIPT") && top.keep_head.indexOf(","+realID+",")==-1 ){
                ori_head[i].parentNode.removeChild(ori_head[i]);
            }
        }
        return true;
    }

    _self.clearDuplicate=function(){
        var ori_head = dom.getElementsByTagName("head")[0].children;
        var sty_len = ori_head.length;
        var classHash = new Array();
        for(var i = sty_len-1; i >= 0; i--){
            var realID = ori_head[i].id;
            if( (ori_head[i].tagName=="STYLE" || ori_head[i].tagName=="SCRIPT") && top.keep_head.indexOf(","+realID+",")==-1 && util.in_array(realID,classHash) ){
                ori_head[i].parentNode.removeChild(ori_head[i]);
            }
            classHash.push(realID);
        }
    }

    _self.pushHistory=function(state, title, page){
        try{
            win.history.pushState(null, title, util.getWebUrl() );
            if(page!=""){
                win._history.push({"state":util.clone(state),"page":page});

            }
        }catch(e){
            util.err("[pushHistory]", e);
        }
    }

    _self.popstate=function(e){
        _self.pushHistory(null, "", "");
        _self.backPage({"retFun":null});
    }

    _self.clearAllTimer=function(isInit){
        //var dontClear = isInit ? true : !timerHash[keys].dont_clear;
        // util.echo("clearAllTimer");
        for(var keys in timerHash){
            if(isInit){
                if(timerHash[keys]!=null){
                    timerHash[keys].clearObj();
                    timerHash[keys] = null;
                }
            }else{
                if(timerHash[keys]!=null && !timerHash[keys].dont_clear){
                    timerHash[keys].clearObj();
                    timerHash[keys] = null;
                }
            }
        }

        return true;
    }

    _self.SetConfirmExit = function (param) {
        bodyFrame.LeaveChk = false;
        bodyFrame.exitConfirm = param;
    }

    _self.ConfirmExitAlert = function (param) {
        if (bodyFrame && bodyFrame.exitConfirm && !bodyFrame.LeaveChk) {
            _self.exitConfirm(_self.ConfirmExitAlert, param, bodyFrame.exitConfirm);
        } else {
            if (param && param.func) {
                param.func(param.Event, param.Param);
            }
        }
    }

    _self.exitConfirm = function (retFun, param, confirm_par) {
        if (confirm_par.isEdit && !confirm_par.isEdit()){
            bodyFrame.LeaveChk = true;
            retFun(param);
            return;
        }
        _self.showLoading({ "showLoading": false });
        util.showMsg(confirm_par["Alert"].msg, confirm_par["Alert"].mode, function (msg) {
            if (msg == "yes") {
                bodyFrame.LeaveChk = true;
                //當確認離開時有留下遺言 做ifYes
                if (confirm_par.ifYes) {
                    confirm_par.ifYes(confirm_par.YesParam);
                }
                retFun(param);
            } else {
                bodyFrame.LeaveChk = false;
                //當不想離開時要把畫面還原等動作 做ifNo
                if (confirm_par.ifNo) {
                    confirm_par.ifNo(confirm_par.NoParam);
                }
                return false;
            }
        });
    }

    _self.backPage=function(param){
        if (bodyFrame && bodyFrame.exitConfirm && !bodyFrame.LeaveChk) {
            _self.exitConfirm(_self.backPage, param, bodyFrame.exitConfirm);
            return false;
        } else {
            try{
                if(teachFrame!=null) return; //教學畫面
                if(win._history.length > 1){
                    win._history.pop();
                    var obj = win._history[win._history.length-1];
                    var hash = obj.state;
                    hash.page = obj.page;
                    hash.back = "Y";
                    if(hash.postHash!=null) hash.postHash.back = "Y";
                    hash.retFun = param.retFun;
                    if(hash.backGoToPage=="Y"){
                        _self.goToPageEvent(hash);
                    }else{
                        _self.bodyGoToPage(hash);
                    }
                }
                if(win._history.length <= 1){
                    topFrame.closebackBtn();
                    _self.chgPageName({"pageName":"dashboard"});
                }
            }catch(e){
                util.err("[backPage]", e);
            }
        }
    }

    _self.addEventListener=function(eventname, eventFunction){
        eventHandler[eventname] = eventFunction;
    }

    _self.dispatchEvent=function(eventname, param){
        util.echo("["+classname+"][dispatchEvent]"+eventname);
        if(eventHandler[eventname]) eventHandler[eventname](param);
    }

    _self.showDiv=function(param){
        dom.getElementById("acc_show").style.display = "none";
        dom.getElementById("home_show").style.display = "none";
        dom.getElementById("filter_show").style.display = "none";
        dom.getElementById(param.type).style.display = "";
    }

    _self.hideDiv=function(param){
        if(param.target=="acc_show"){

            top.param = "login_layer="+top.login_layer+"&uid="+top.uid+"&langx="+top.langx+"&ver="+top.ver;
            _self.showDiv({"type":"home_show"});

            //top
            _self.goToPage("top_menu_show", "top_menu", function(){
                try{
                    topFrame = new win.top_menu(win,dom);
                    topFrame.setParentclass(_self);
                    topFrame.init();
                    // _self.checkCount();
                    _self.check_all_div("top_menu_show", param);
                    _self.chgPageName({"page":"dashboard"});
                }catch(e){
                    util.err("[hideDiv][top_menu]", e);
                }
            },{});

            //left
            _self.goToPage("left_menu_show", "left_menu", function(){
                try{
                    leftFrame = new win.left_menu(win,dom);
                    leftFrame.setParentclass(_self);
                    leftFrame.init();
                    // _self.checkCount();
                    _self.check_all_div("left_menu_show", param);
                }catch(e){
                    util.err("[hideDiv][left_menu]", e);
                }
            },{});

            //bottom
            _self.goToPage("bottom_menu_show", "bottom_menu", function(){
                try{
                    bottomFrame = new win.bottom_menu(win,dom);
                    bottomFrame.setParentclass(_self);
                    bottomFrame.init();
                    // _self.checkCount();
                    _self.check_all_div("bottom_menu_show", param);
                }catch(e){
                    util.err("[hideDiv][bottom_menu]", e);
                }
            },{});

            //alert msg
            _self.goToPage("alert_show", "alert_msg", function(){
                try{
                    alertFrame = new win.alert_msg(win,dom);
                    alertFrame.setParentclass(_self);
                    alertFrame.init();
                    // _self.checkCount();
                    _self.check_all_div("alert_show", param);
                }catch(e){
                    util.err("[alert_msg]", e);
                }
            },{});

            // 新增現金項目公告
            var cke = cookie.get("note_addcash202008");
            // 公告先做好但先不要顯示
            if((cke==undefined || cke=="N") && false ){
                //alert notice
                _self.goToPage("newnote_show", "alert_note", function(){
                    try{
                        noticeFrame = new win.alert_notice(win,dom);
                        noticeFrame.setParentclass(_self);
                        noticeFrame.init();
                        _self.check_all_div("newnote_show", param);
                        _self.lockBodyScroll();
                        dom.getElementById("newnote_show").style.display = "";
                    }catch(e){
                        util.err("[alert_note]", e);
                    }
                },{});
            }else{
                _self.check_all_div("newnote_show", param);
            }


            //important announcement
            _self.goToPage("anno_show", "alert_announcement", function(){
                try{
                    annoFrame = new win.alert_announcement(win,dom);
                    annoFrame.setParentclass(_self);
                    annoFrame.init();
                    // _self.checkCount();
                    _self.check_all_div("anno_show", param);
                }catch(e){
                    util.err("[alert_announcement]", e);
                }
            },{});

            //body
            //20191210 改由check_all_div 確認全部仔入完成後再進入首頁
            //_self.bodyGoToPage({"page":"dashboard_main","retFun":_self.checkCount});
        }
        _self.createTimer();//初始化資料
        _self.startTimer(); //開始執行
    }

    //確認全部載完才進首頁
    _self.check_all_div = function (div_name, param) {
        arr_check_all_div[div_name] = true;
        var chk_do_main = true;
        for (var i in arr_check_all_div) {
            if (!arr_check_all_div[i]) {
                chk_do_main = false;
                break;
            }
        }
        if (chk_do_main) {
            _self.loadAnnounce_Prombel_luminous();  //載完畫面載亮點資訊
            // _self.showImportantAnno() ;
            // _self.bodyGoToPage({ "page": "dashboard_main" });
            _self.bodyGoToPage({ "page": "dashboard_main", "retFun": _self.showImportantAnno });
        }
    }
    // 顯示公告
    _self.showImportantAnno = function(){
        first_load = true;
        _self.loadImportantAnno();
    }

    _self.lockBodyScroll=function(){
        dom.getElementById("body_show").setAttribute("style", "overflow-y:hidden;");
        dom.body.setAttribute("style", "position:fixed; overflow-y:hidden;");
    }

    _self.openBodyScroll=function(){
        dom.getElementById("body_show").removeAttribute("style");
        dom.body.removeAttribute("style");
    }

    _self.showAlertMsg=function(param){
        alertFrame.showMsg(param);
        dom.getElementById("alert_show").style.display = "";
    }

    _self.showAlertChooseMsg=function(param){
        alertChooseFrame.showMsg(param);
        dom.getElementById("alert_choose_show").style.display = "";
    }

    _self.openLeftMenu=function(){
        dom.getElementById("left_menu_show").className ="ma_left";
        dom.getElementById("body_show").className ="ma_content";
        leftFrame.openMenu();
    }

    _self.closeLeftMenu=function(){
        dom.getElementById("left_menu_show").className ="ma_left";
        dom.getElementById("body_show").className ="ma_content";
        leftFrame.openMenu();
    }

    // 歡迎使用新版公告
    _self.closeNote=function(){
        dom.getElementById("newnote_show").style.display = "none";
        noticeFrame = null;
        cookie.set("note_addcash202008", "Y", 180);
        _self.openBodyScroll();
    }

    //橘色公告
    /*_self.closeNotice=function(){
        dom.getElementById("notice_show").style.display = "none";
        noticeFrame = null;
        cookie.set("notice_newsite20190611", "Y", 180);
        _self.openBodyScroll();
    }*/

    _self.hideAlertMsg=function(param){
        alertFrame.clearMsg();
        dom.getElementById("alert_show").style.display = "none";
    }

    _self.hideAlertChooseMsg=function(param){
        alertChooseFrame.clearChoose();
        dom.getElementById("alert_choose_show").style.display = "none";
        // 2019-04-17 Ricky 說不一定用得到
        // if(param.page == "alert_choose") topFrame.chg_lan_str(param);
    }

    _self.hideDivComplete=function(){
        // util.echo("acc_show div hide OK!");
    }

    //導去安全代碼
    _self.chgPwdSafe=function(){
        _self.goToPage("acc_show", "old_chg_pwd_safe", function(){
            try{
                loginFrame = new win.old_chg_pwd_safe(win,dom);
                loginFrame.setParentclass(_self);
                loginFrame.init();
            }catch(e){
                util.err("[chgPwdSafe][old_chg_pwd_safe]", e);
            }
        },{});
    }

    //導去登入頁忘記密碼
    _self.chgLoginID=function(){
        _self.goToPage("acc_show", "old_chg_login_ID", function(){
            try{
                loginFrame = new win.old_chg_login_ID(win,dom);
                loginFrame.setParentclass(_self);
                loginFrame.init();
            }catch(e){
                util.err("[chgLoginID][old_chg_login_ID]", e);
            }
        },{});
    }

    //導回首頁
    _self.backToIdex=function(){
        util.goToIndex();
    }

    //導去修改密碼
    _self.chgPwd=function(){
        _self.goToPage("acc_show", "old_chg_pwd", function(){
            try{
                loginFrame = new win.old_chg_pwd(win,dom);
                loginFrame.setParentclass(_self);
                loginFrame.init();
            }catch(e){
                util.err("[chgPwd][old_chg_pwd]", e);
            }
        },{"post":"isFirst=Y"});
    }

    //導去登入頁忘記密碼
    _self.forgotPwd=function(){
        _self.goToPage("acc_show", "pre_forgot_pwd", function(){
            try{
                loginFrame = new win.pre_forgot_pwd(win,dom);
                loginFrame.setParentclass(_self);
                loginFrame.init();
            }catch(e){
                util.err("[forgotPwd][pre_forgot_pwd]", e);
            }
        },{});
    }


    //導去選擇語系
    _self.chooseLan=function(){
        //alert choose
        _self.goToPage("alert_choose_show", "alert_choose", function(){
            try{
                alertChooseFrame = new win.alert_choose(win,dom);
                alertChooseFrame.setParentclass(_self);
                alertChooseFrame.init();
                var selLayer = "";
                if(top.login_layer == "co"){
                    selLayer = "A";
                }else if(top.login_layer == "su"){
                    selLayer = "B";
                }else if(top.login_layer == "ag"){
                    selLayer = "C";
                }
                var _postHashCN = new Object();
                _postHashCN["langx"] = "zh-cn";
                _postHashCN["ls"] = "cn";
                _postHashCN["selLayer"] = selLayer;
                var _postHashTW = new Object();
                _postHashTW["langx"] = "zh-tw";
                _postHashTW["ls"] = "tw";
                _postHashCN["selLayer"] = selLayer;
                var _postHashUS = new Object();
                _postHashUS["langx"] = "en-us";
                _postHashUS["ls"] = "us";
                _postHashCN["selLayer"] = selLayer;
                var _cn = {"id":"zh_cn","style":"ar_choose_lanCN","content":"简体","postHash":_postHashCN};
                var _tw = {"id":"zh_tw","style":"ar_choose_lanHK","content":"繁體","postHash":_postHashTW};
                var _en = {"id":"en_us","style":"ar_choose_lanEN","content":"English","postHash":_postHashUS};
                var _param = new Array(_cn, _tw, _en);

                alertChooseFrame.parseChoose("langx",_param);
                dom.getElementById("alert_choose_show").style.display = "";
            }catch(e){
                util.err("[alert_choose]", e);
            }
        },{});

    }

    //導去選擇帳戶管理層級
    _self.chooseLayer=function(){
        //alert choose
        _self.goToPage("alert_choose_show", "alert_choose", function(){
            try{
                alertChooseFrame = new win.alert_choose(win,dom);
                alertChooseFrame.setParentclass(_self);
                alertChooseFrame.init();

                var view_ads = new Array("ad","d0","co","su","ag","mem","sub");
                var view_ad = new Array("d0","co","su","ag","mem","sub");
                var view_d0 = new Array("co","ag","mem","sub");
                var view_co = new Array("su","ag","mem","sub");
                var view_su = new Array("ag","mem","sub");
                var view_ag = new Array("mem","sub");
                var selLayer = "";
                if(top.login_layer == "ad" || top.login_layer == "ads"){
                    selLayer = "A";
                }else if(top.login_layer == "d0"){
                    selLayer = "B";
                }else if(top.login_layer == "co"){
                    selLayer = "C";
                }else if(top.login_layer == "su"){
                    selLayer = "D";
                }else if(top.login_layer == "ag"){
                    selLayer = "E";
                }
                var _postHashAD = new Object();
                _postHashAD["page"] = "acc_ad_list";
                _postHashAD["type"] = "account";
                _postHashAD["pageType"] = "account";
                _postHashAD["selLayer"] = selLayer;
                var _postHashD0 = new Object();
                _postHashD0["page"] = "acc_d0_list";
                _postHashD0["type"] = "account";
                _postHashD0["pageType"] = "account";
                _postHashD0["selLayer"] = selLayer;
                var _postHashCO = new Object();
                _postHashCO["page"] = "acc_co_list";
                _postHashCO["type"] = "account";
                _postHashCO["pageType"] = "account";
                _postHashCO["selLayer"] = selLayer;
                var _postHashSU = new Object();
                _postHashSU["page"] = "acc_su_list";
                _postHashSU["type"] = "account";
                _postHashSU["pageType"] = "account";
                _postHashSU["selLayer"] = selLayer;
                var _postHashAG = new Object();
                _postHashAG["page"] = "acc_ag_list";
                _postHashAG["type"] = "account";
                _postHashSU["pageType"] = "account";
                _postHashAG["selLayer"] = selLayer;
                var _postHashMEM = new Object();
                _postHashMEM["page"] = "acc_mem_list";
                _postHashMEM["type"] = "account";
                _postHashSU["pageType"] = "account";
                _postHashMEM["selLayer"] = selLayer;
                var _postHashSUB = new Object();
                _postHashSUB["page"] = "acc_sub_list";
                _postHashSUB["type"] = "account";
                _postHashSU["pageType"] = "account";
                _postHashSUB["selLayer"] = selLayer;
                var _ad = {"id":"layer_ad","style":"","content":LS.get("acc_ad"),"postHash":_postHashAD};
                var _d0 = {"id":"layer_d0","style":"","content":LS.get("acc_d0"),"postHash":_postHashD0};
                var _co = {"id":"layer_co","style":"","content":LS.get("acc_co"),"postHash":_postHashCO};
                var _su = {"id":"layer_su","style":"","content":LS.get("acc_su"),"postHash":_postHashSU};
                var _ag = {"id":"layer_ag","style":"","content":LS.get("acc_ag"),"postHash":_postHashAG};
                var _mem = {"id":"layer_mem","style":"","content":LS.get("acc_mem"),"postHash":_postHashMEM};
                var _sub = {"id":"layer_sub","style":"","content":LS.get("acc_sub"),"postHash":_postHashSUB};

                var _param = new Array();
                //判斷子帳號有哪些權限來隱藏header
                var tmp_view = eval("view_"+top.login_layer);
                for(var i =0; i < tmp_view.length;i++){
                    if(tmp_view[i]=="sub" && (top.user_type == 2 || top.user_type == 3) ) continue;
                    var pushData = eval("_"+tmp_view[i]);
                    _param.push(pushData);
                }
                alertChooseFrame.parseChoose("account",_param);
                alertChooseFrame.showTitle(false);
                dom.getElementById("alert_choose_show").style.display = "";
            }catch(e){
                util.err("[alert_choose]", e);
            }
        },{});
    }

    //--------------創建計時器 start-----------------
    _self.createTimer = function () {
        timerHash["Ann_ProAcc"] = new Timer(config_set.get("ANNOUNCE_PROBLEMACCOUNT_TIME"));
        timerHash["Ann_ProAcc"].setParentclass(_self);
        timerHash["Ann_ProAcc"].dont_clear = true; //設定為不清除timer
        timerHash["Ann_ProAcc"].init();
        timerHash["Ann_ProAcc"].addEventListener("TimerEvent.TIMER", _self.timerRun);
        timerHash["Ann_ProAcc"].addEventListener("TimerEvent.TIMER_COMPLETE", _self.timerComplete);
    }
    //設定 定時做事
    _self.startTimer = function () {
        util.echo("dashboard startTimer");
        timerHash["Ann_ProAcc"].startTimer();
    }

    _self.stopTimer = function () {
        util.echo("dashboard stopTimer");
        timerHash["Ann_ProAcc"].stopTimer();
    }

    _self.clearTimer = function () {
        util.echo("dashboard clearTimer");
        timerHash["Ann_ProAcc"].clearObj();
    }

    _self.timerRun = function () {
        util.echo("DASHBOARD timer");
        _self.loadAnnounce_Prombel_luminous();
    }

    _self.timerComplete = function () {
        util.echo("timerComplete"); //no complete
    }
    //--------------創建計時器 end-----------------
    _self.lockScaled=function(){
        util.addEvent(dom.documentElement, "touchstart", _self.touchstartEvent);
    }

    _self.showFadeOutMesg = function (param) {
        //2019-04-08 Ricky 新增帳號時，按下copy會馬上再彈出另一個訊息，所以進這fun先初始化class
        codeAlert.className = "ps_sendCode";
        clearTimeout(setTimeContainer);
        if (typeof param !== "object" || !param.text || param.text == "") return;
        var secClassAry = [ 2, 5];
        // var codeAlert = dom.getElementById("codeAlert");
        var fadeName = "item_disappear2s"; //預設都2秒。註：如果擴充美工只需給 item_disappear'X's  X的秒數 上方陣列再加對應秒數
        var delayAni = 2; //延遲淡出淡入各一秒
        var sec = 0; //設定幾秒後拿掉內容
        if (secClassAry.indexOf(param.s) != -1) fadeName = fadeName.replace(/[0-9]+/g, param.s);
        sec = fadeName.match(/[0-9]+/g)[0];
        //設定
        //codeAlert.innerHTML = param.text;
        codeMsg.innerHTML = param.text;
        codeAlert.classList.add(fadeName);
        setTimeContainer = setTimeout(function(){
            //codeAlert.innerHTML = "";
            codeMsg.innerHTML = "";
            codeAlert.classList.remove(fadeName);
        }, (sec * 1 + delayAni) * 1000);

        //2019-04-08 Ricky 新增帳號的彈出訊息會有copy按鈕可以複製帳密
        if(param.showCopy == "Y"){
            dom.getElementById("btn_copy").value=param.value;
            dom.getElementById("btn_copy").style.display="";
            dom.getElementById("btn_copy").classList.add("txtl");
        }else{
            dom.getElementById("btn_copy").style.display="none";
        }
    }

    _self.touchstartEvent=function(event){
        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }
    //取得目前尚未讀取的人數
    _self.getPromblemCount = function(){
        var urlParams = "";
        urlParams += "uid=" + top.uid;
        urlParams += "&login_layer=" + top.login_layer;
        urlParams = "p=get_ncr_count&ver=" + top.ver + "&" + urlParams;
        var getHTML = new HttpRequest();
        getHTML.addEventListener("onError", _self.onError);
        getHTML.addEventListener("LoadComplete", _self.ProCountBroadcastData);
        getHTML.loadURL(top.url, "POST", urlParams);
    }
    //取得公告目前的id
    _self.getAnnouncementCount = function () {
        var urlParams = "";
        urlParams += "uid=" + top.uid;
        urlParams += "&login_layer=" + top.login_layer;
        urlParams += "&announcement=count";
        urlParams += "&langx=" + top.langx;
        urlParams = "p=get_announcement&ver=" + top.ver + "&" + urlParams;
        var getHTML = new HttpRequest();
        getHTML.addEventListener("onError", _self.onError);
        getHTML.addEventListener("LoadComplete", _self.AnnCountBroadcastData);
        getHTML.loadURL(top.url, "POST", urlParams);
    }
    //讀取完畢再去取資料
    _self.loadAnnounce_Prombel_luminous = function(){
        var times = 50;
        setTimeout(function(){
            if (topFrame && bottomFrame){
                _self.getAnnouncementCount();
                if (top.login_layer == "co") _self.getPromblemCount();
            }else{
                setTimeout(arguments.callee, times);
            }
        },times);
    }
    //仿推播 推給 top 與 bottom 公告
    _self.AnnCountBroadcastData = function(data){
        topFrame.AnnComplete(data);
        bottomFrame.AnnComplete(data);
    }
    //仿推播 推給 top 與 bottom 問題帳戶
    _self.ProCountBroadcastData = function (data) {
        topFrame.ProAccComplete(data);
        bottomFrame.ProAccComplete(data);
    }

    //換左邊menu的深底色
    _self.chgLeftMenuColor = function (param) {
        leftFrame.chgColor(param);
    }


    _self.loadImportantAnno = function(){
        var urlParams = "";
        urlParams += "uid=" + top.uid;
        urlParams += "&login_layer=" + top.login_layer;
        urlParams += "&announcement=count";
        urlParams += "&action=init";
        urlParams += "&scoll_type=home_important";
        urlParams += "&scoll_date=all";
        urlParams += "&sort=desc";
        urlParams += "&langx=" + top.langx;
        urlParams = "p=get_announcement&ver=" + top.ver + "&" + urlParams;
        var getHTML = new HttpRequest();
        getHTML.addEventListener("onError", _self.onError);
        getHTML.addEventListener("LoadComplete", _self.loadImportantAnnoComplete);
        getHTML.loadURL(top.url, "POST", urlParams);
    }

    _self.loadImportantAnnoComplete = function(data){
        try {
            var arr_data = JSON.parse(data);
            if(!arr_data.hasOwnProperty("msg")){
                util.chkErrorMsg(arr_data, LS_code);
                return;
            }
            if(arr_data["code"]!="none"){
                var tmpData = arr_data["code"].split("@@");
                var count = tmpData.length;
                if(count > 0){
                    _self.showAnno(tmpData);
                }
            }
            _self.setLoadingVisible(false);
        }catch(e){
            util.echo(e);
        }
    }

    _self.showAnno=function(data){
        annoFrame.showAnno(data);
        dom.getElementById("anno_show").style.display = "";
    }

    _self.hideAnno=function(){
        annoFrame.clearMsg();
        dom.getElementById("anno_show").style.display = "none";
    }

    _self.doOnTouchMove = function () {
        dom.activeElement.blur();
    }

    //new open page
    _self.newOpenPageEvent = function(obj){
        var dowrite = (obj.dowrite == undefined)?false:obj.dowrite;
        _self.newOpenPage(obj.filename, (obj.title)?obj.title:"",  _self.getNewOpenParam(obj), dowrite, obj._body);
    }

    _self.newOpenPageNoParEvent = function(obj){
        var dowrite = (obj.dowrite == undefined)?false:obj.dowrite;

        _self.newOpenPage(obj.filename, (obj.title)?obj.title:"", "" , dowrite, obj._body);
    }

    _self.getNewOpenParam = function(obj){

        var par = "config='";
        par+="location="+((obj.location!=null)?obj.location:"no");
        par+=",status="+((obj.status)?obj.status:"no");
        par+=",width="+((obj.width)?obj.width:"600px");
        par+=",height="+((obj.height)?obj.height:"600px");
        par+=",toolbar="+((obj.toolbar)?obj.toolbar:"no");
        par+=",top="+((obj.top)?obj.top:"0px");
        par+=",left="+((obj.left)?obj.left:"0px");
        par+=",scrollbars="+((obj.scrollbars)?obj.scrollbars:"no");
        par+=",resizable="+((obj.resizable)?obj.resizable:"yes");
        par+=",personalbar="+((obj.personalbar)?obj.personalbar:"yes");
        par+= "'";
        return par;

    }

    _self.newOpenPage = function(filename, _title, param, dowrite, _body){

        if(util.showTxt(filename)=="" && !dowrite) return;

        if(_title!="history"){
                if(top.popWindow[filename] != null){
                    top.popWindow[filename].focus();
                    if(!top.popWindow[filename].closed)	return;
                }
        }
        top.popWindow[filename] = window.open(filename, _title, param);
        top.popWindow[filename].focus();

        if(dowrite){
            var headStr = "";
            top.popWindow[filename].document.write("<html><body></body></html>");

            for(var i=0; i < window.document.head.childNodes.length; i++){
                var node = document.head.childNodes[i];
                var tag = node.tagName;

                if(tag=="META" || tag=="LINK"){
                    headStr += node.outerHTML;
                }
            }

            htmlStr = "<html>"+headStr+"<body>"+_body+"</body></html>";

            top.popWindow[filename].document.write(htmlStr);
            top.popWindow[filename].document.close();
        }

    }
}
