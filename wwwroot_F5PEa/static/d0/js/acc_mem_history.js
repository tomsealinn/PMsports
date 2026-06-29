function acc_mem_history(_win, _dom, _post) {
    var classname = "acc_mem_history";
    var _self = this;
    var win = _win;
    var dom = _dom;
    var parentClass;
    var postHash = _post;
    var util;
    var LS_code;
    var LS_account;
    var LS;
    var config_set;
    var dataType = "today_wagers";
    var hr = null;
    var eventHandler = new Object;
    var completeFun = new Object;
    var modelAry = new Array("today_wagers", "history_data", "history_view");
    var nowGtype = "ALL";
    var nowDate = null;
    var danAry = new Array;
    var timerObj = new Object;
    var dateHash = new Object;
    _self.init = function() {
        dom.getElementById("username").innerHTML =
            util.showTxt(postHash["username"]);
        dom.getElementById("alias").innerHTML = util.showTxt(postHash["alias"]);
        util.addEvent(dom.getElementById("today_wagers"), "click", _self.loadData, {
            "title": "today_wagers",
            "type": "today_wagers"
        });
        util.addEvent(dom.getElementById("history"), "click", _self.loadData, {
            "title": "history",
            "type": "history_data"
        });
        util.addEvent(dom.getElementById("back_btn"), "click", _self.backEvent);
        util.addEvent(dom.getElementById("back_click"), "click", _self.backClick);
        _self.initGtypeSelect();
        _self.initFun();
        _self.getData()
    };
    _self.reinit = function(_parHash) {
        postHash = _parHash;
        if (dataType == "history_view") {
            dataType = "history_data";
            dom.getElementById("history_view_show").style.display = "none"
        }
        _self.init()
    };
    _self.initFun = function() {
        completeFun["history_data"] = _self.historyDataComplete;
        completeFun["history_view"] = _self.historyViewComplete;
        completeFun["today_wagers"] = _self.todaywagersComplete
    };
    _self.initGtypeSelect = function() {
        _self.doSelToUL(dom.getElementById("gtype_sel"), "gtype_sel_LB");
        util.addEvent(dom.getElementById("gtype_sel"),
            "change", _self.selectGtype)
    };
    _self.initDateSelect = function() {
        var date_sel = dom.getElementById("date_sel");
        date_sel.options.length = 0;
        for (var i = 0; i < dateHash["history"].length; i++) {
            var hisData = dateHash["history"][i];
            var name = hisData.DATE_NAME + " " + hisData.WEEK;
            var varItem = new Option(name, hisData.DATE, false, false);
            date_sel.options.add(varItem)
        }
        _self.doSelToUL(date_sel, "date_sel_LB");
        util.addEvent(date_sel, "change", _self.selectDate)
    };
    _self.checkDateSelect = function(date) {
        var date_sel = dom.getElementById("date_sel");
        var opt = date_sel.options;
        for (var i = 0; i < opt.length; i++)
            if (opt[i].value == date) {
                date_sel.selectedIndex = i;
                break
            }
        nowDate = date
    };
    _self.setParentclass = function(_parentclass) {
        parentClass = _parentclass;
        util = parentClass.getThis("util");
        config_set = parentClass.getThis("config_set");
        LS_code = parentClass.getThis("LS_code");
        LS_account = parentClass.getThis("LS_account");
        LS = parentClass.getThis("LS")
    };
    _self.getThis = function(varible) {
        return eval(varible)
    };
    _self.getParentThis = function(varible) {
        return parentClass.getThis(varible)
    };
    _self.showDiv = function(e, param) {
        var obj = dom.getElementById("gtype_div");
        if (obj.classList.contains("active")) obj.classList.remove("active");
        else {
            obj.classList.add("active");
            obj.focus()
        }
    };
    _self.backEvent = function(param) {
        _self.clearDangerTimer();
        parentClass.dispatchEvent("hideMemHistory", null)
    };
    _self.backClick = function(e) {
        _self.showTarget("date_div", false);
        _self.showTarget("back_click", false);
        _self.loadData(e, {
            "title": "history",
            "type": "history_data"
        })
    };
    _self.selectGtype = function(e) {
        nowGtype = e.target.value;
        e.target.JS_UL.setSelected(nowGtype);
        _self.getData(nowDate)
    };
    _self.selectDate = function(e, param) {
        nowDate = e.target.value;
        e.target.JS_UL.setSelected(nowDate);
        _self.getData(nowDate)
    };
    _self.loadData = function(e, param) {
        util.classFunc(dom.getElementById("today_wagers"), "on", "remove");
        util.classFunc(dom.getElementById("history"), "on", "remove");
        util.classFunc(dom.getElementById(param.title), "on", "");
        for (var y = 0; y < modelAry.length; y++) dom.getElementById(modelAry[y] + "_show").style.display = "none";
        dataType = param.type;
        _self.getData(param.date);
        if (param.date != null && typeof param.date != "undefined") {
            var tmpAry = param.date.split("-");
            var newDate = tmpAry[1] + "-" + tmpAry[2];
            dom.getElementById("date_sel").JS_UL.setSelected(param.date)
        }
    };
    _self.getData = function(date) {
        dom.getElementById("history_loading").style.display = "";
        hr = new win.HttpRequestRetry(win.HttpRequest, config_set.get("RETRY_TIME"), config_set.get("RETRY_LIMIT"), "detailFrame");
        hr.setParentclass(_self);
        hr.addEventListener("onError", _self.onError);
        hr.addEventListener("LoadComplete",
            _self.LoadComplete);
        hr.loadURL(top.url, "POST", _self.getPar(dataType, date))
    };
    _self.getPar = function(dataType, date) {
        var par = "";
        par += top.param;
        par += "&p=get_" + dataType;
        par += "&mid=" + postHash["sid"];
        par += "&selGtype=" + nowGtype;
        if (dataType == "history_view") {
            nowDate = date;
            if (date != null) par += "&today_gmt=" + date;
            par += "&tmp_flag=Y";
            par += "&pay_type=" + postHash["pay_type"]
        }
        if (dataType == "today_wagers") par += "&pay_type=" + postHash["pay_type"];
        return par
    };
    _self.onError = function() {
        util.echo("onError")
    };
    _self.LoadComplete =
        function(json) {
            var showDate = dataType == "history_view";
            _self.showTarget("date_div", showDate);
            _self.showTarget("back_click", showDate);
            _self.showTarget("control_bar", true);
            _self.closeNodata();
            var hash;
            try {
                hash = JSON.parse(json);
                if (util.chkErrorMsg(hash, LS_code)) return
            } catch (e) {
                util.err("[" + classname + "]", e);
                util.showErrorMsg("data error");
                return
            }
            if (dataType !== hash["type"]) return;
            _self.clearDangerTimer();
            completeFun[hash["type"]](hash);
            dom.getElementById("history_loading").style.display = "none"
        };
    _self.todaywagersComplete =
        function(hash) {
            if (hash["status"] == "200") {
                var wagers = hash["wagers"];
                if (wagers.length > 0) {
                    _self.closeNoData();
                    danAry.length = 0;
                    var tmpScreen = "";
                    var showObj = dom.getElementById(hash["type"] + "_show");
                    var total_gold = 0;
                    for (var a = 0; a < wagers.length; a++) {
                        var w = wagers[a];
                        var bet_wtype = w["BET_WTYPE"];
                        var p = bet_wtype == "P" || bet_wtype == "RP" ||  bet_wtype == "RP3" ? "_P" : "";
                        var tpl = new fastTemplate_a1;
                        var modelObj = dom.getElementById(hash["type"] + p + "_model");
                        tpl.init(modelObj.cloneNode(true));
                        var tid = _self.replaceOU(w["WID"]);
						
                        if (p != "") {
                            var ary =
                                new Array("TID", "WID", "DATE", "ADDTIME", "ODDF_TYPE", "GTYPE");
                            tpl.addBlock("title");
                            for (var b = 0; b < ary.length; b++) {
                                var keys = ary[b];
                                if (keys == "DATE" && w[keys] != "") {
                                    var data_str = w[keys].split("-");
                                    var data_st = data_str[2].trim() + "-" + data_str[1].trim() + "-" + data_str[0].trim();
                                    w[keys] = data_st
                                }
                                if (keys == "ODDF_TYPE") {
                                    var data_str = w[keys].replace(/\(/g, "").replace(/\)/, "");
                                    w[keys] = data_str
                                }
                                if (keys == "TID") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(tid));
                                tpl.replace(new RegExp("\\*" + keys + "\\*",
                                    "gi"), util.showTxt(w[keys]))
                            }
                            var ary = new Array("WID", "DATE", "ADDTIME", "LEAGUE", "TEAM_H", "TEAM_C", "SCORE", "ORG_SCORE", "RESULT_DATA", "RESULT", "BET_RATIO", "IORATIO", "WTYPE_SUB", "MS_SUB", "DEL_CLASS");
                            if (w["BALL_ACT_CLASS"] == "word_orange")
                                if (!util.in_array(tid, danAry)) danAry.push(tid);
                            for (var k = 0; k < w["WAGERS_SUB"].length; k++) {
                                tpl.addBlock("wagers");
                                for (var b = 0; b < ary.length; b++) {
                                    var parlayData = w["WAGERS_SUB"][k];
                                    var keys = ary[b];
                                    tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(parlayData[keys]))
                                }
                            }
                            var ary =
                                new Array("GOLD", "GOLD_CLASS", "WIN_GOLD", "WIN_GOLD_DIS", "BALL_ACT_CLASS", "BALL_ACT_RET");
                            tpl.addBlock("gold");
                            for (var b = 0; b < ary.length; b++) {
                                var keys = ary[b];
                                if (keys == "GOLD") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys] == "" ? "" : util.mprintf(w[keys] * 1, 0, 1, false, true));
                                if (keys == "WIN_GOLD")
                                    if (w[keys] == "") {
                                        tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), "");
                                        w["WIN_GOLD_DIS"] = "display:none"
                                    } else {
                                        tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.mprintf(w[keys] * 1, 0, 2, false, true));
                                        w["WIN_GOLD_DIS"] =
                                            ""
                                    }
                                tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(w[keys]))
                            }
                        } else {
                            var ary = new Array("WID", "TID", "ODDF_TYPE", "IS_FS", "DATE", "ADDTIME", "LEAGUE", "TEAM_H", "TEAM_C", "RESULT_DATA", "RESULT", "BET_RATIO", "IORATIO", "GTYPE", "WTYPE", "GOLD", "GOLD_CLASS", "WIN_GOLD", "WIN_GOLD_DIS", "SCORE", "ORG_SCORE", "W_MS", "BALL_ACT_CLASS", "BALL_ACT_RET");
                            tpl.addBlock("wagers");
                            for (var b = 0; b < ary.length; b++) {
                                var keys = ary[b];
                                if (w["BET_WTYPE"] == "FS") {
                                    if (keys == "IS_FS") w[keys] = ""
                                } else {
                                    if (keys == "IS_FS") w[keys] = "对";
                                    if (keys ==
                                        "GTYPE") w[keys] = ""
                                }
                                if (w["BALL_ACT_CLASS"] == "word_orange")
                                    if (!util.in_array(tid, danAry)) danAry.push(tid);
                                if (keys == "DATE" && w[keys] != "") {
                                    var data_str = w[keys].split("-");
                                    var data_st = data_str[2].trim() + "-" + data_str[1].trim() + "-" + data_str[0].trim();
                                    w[keys] = data_st
                                }
                                if (keys == "ODDF_TYPE") {
                                    var data_str = w[keys].replace(/\(/g, "").replace(/\)/, "");
                                    w[keys] = data_str
                                }
                                if (keys == "GOLD") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys] == "" ? "" : util.mprintf(w[keys] * 1, 0, 1, false, true));
                                if (keys == "WIN_GOLD")
                                    if (w[keys] ==
                                        "") {
                                        tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), "");
                                        w["WIN_GOLD_DIS"] = "display:none"
                                    } else {
                                        tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.mprintf(w[keys] * 1, 0, 2, false, true));
                                        w["WIN_GOLD_DIS"] = ""
                                    }
                                if (keys == "TID") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(tid));
                                tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(w[keys]))
                            }
                        }
                        total_gold += w["GOLD"] * 1;
                        tmpScreen += tpl.fastPrint()
                    }
                    dom.getElementById("unsettle_amout_gold").innerHTML = util.mprintf(total_gold * 1, 0, 1, false,
                        true);
                    dom.getElementById(hash["type"] + "_content").innerHTML = tmpScreen;
                    showObj.style.display = "";
                    if (danAry.length > 0) _self.createDangerTimer();
                    else _self.clearDangerTimer()
                } else _self.showNodata();
                _self.showHistoryClose(false)
            }
        };
    _self.historyViewComplete = function(hash) {
        var showObj = dom.getElementById(hash["type"] + "_show");
        if (hash["status"] == "200") {
            var wagers = hash["wagers"];
            if (wagers.length > 0) {
                _self.closeNoData();
                var tpl = new fastTemplate_a1;
                var tmpScreen = "";
                var total_gold = 0;
                var total_wingold = 0;
                for (var a =
                        0; a < wagers.length; a++) {
                    var w = wagers[a];
                    var bet_wtype = w["BET_WTYPE"];
                    var p = bet_wtype == "P" || bet_wtype == "RP" || bet_wtype == "RP3" ? "_P" : "";
                    var modelObj = dom.getElementById(hash["type"] + p + "_model");
                    tpl.init(modelObj.cloneNode(true));
                    var tid = _self.replaceOU(w["WID"]);
					console.log(bet_wtype);
                    if (p != "") {
                        var ary = new Array("TID", "ODDF_TYPE", "WID", "DATE", "ADDTIME", "SUB_COUNT", "GTYPE");
                        tpl.addBlock("title");
                        for (var b = 0; b < ary.length; b++) {
                            var keys = ary[b];
                            if (keys == "DATE" && w[keys] != "") {
                                var data_str = w[keys].split("-");
                                var data_st = data_str[2].trim() + "-" + data_str[1].trim() +
                                    "-" + data_str[0].trim();
                                w[keys] = data_st
                            }
                            if (keys == "ODDF_TYPE") {
                                var data_str = w[keys].replace(/\(/g, "").replace(/\)/, "");
                                w[keys] = data_str
                            }
                            if (keys == "TID") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(tid));
                            tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(w[keys]))
                        }
                        var ary = new Array("WID", "DATE", "ADDTIME", "LEAGUE", "TEAM_H", "TEAM_C", "SCORE", "ORG_SCORE", "RESULT_WL_CLASS", "RESULT_WL", "RESULT", "BET_RATIO", "IORATIO", "WTYPE_SUB", "MS_SUB", "GOLD", "WIN_GOLD", "DEL_CLASS", "BALL_ACT_CLASS",
                            "BALL_ACT_RET");
                        for (var k = 0; k < w["WAGERS_SUB"].length; k++) {
                            tpl.addBlock("wagers");
                            for (var b = 0; b < ary.length; b++) {
                                var parlayData = w["WAGERS_SUB"][k];
                                var keys = ary[b];
                                tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(parlayData[keys]))
                            }
                        }
                        var ary = new Array("GOLD", "GOLD_CLASS", "WIN_GOLD", "WIN_GOLD_CLASS", "MAIN_BALL_ACT_CLASS", "MAIN_BALL_ACT_RET");
                        tpl.addBlock("gold");
                        for (var b = 0; b < ary.length; b++) {
                            var keys = ary[b];
                            if (keys == "GOLD") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys] == "" ? "" :
                                util.mprintf(w[keys] * 1, 0, 1, false, true));
                            if (keys == "WIN_GOLD")
                                if (w[keys] == "") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                                else if (isNaN(w[keys] * 1)) tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                            else tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.mprintf(w[keys] * 1, 0, 2, false, true));
                            if (keys == "WIN_GOLD_CLASS") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                            tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(w[keys]))
                        }
                    } else {
                        var ary = new Array("TID",
                            "ODDF_TYPE", "WID", "IS_FS", "DATE", "ADDTIME", "LEAGUE", "TEAM_H", "TEAM_C", "RESULT_WL_CLASS", "RESULT_WL", "RESULT", "BET_RATIO", "GTYPE", "IORATIO", "WTYPE", "SCORE", "ORG_SCORE", "GOLD", "GOLD_CLASS", "WIN_GOLD", "WIN_GOLD_CLASS", "BALL_ACT_CLASS", "BALL_ACT_RET", "MS");
                        tpl.addBlock("wagers");
                        for (var b = 0; b < ary.length; b++) {
                            var keys = ary[b];
                            if (w["BET_WTYPE"] == "FS") {
                                if (keys == "IS_FS") w[keys] = ""
                            } else {
                                if (keys == "IS_FS") w[keys] = "对";
                                if (keys == "GTYPE") w[keys] = ""
                            }
                            if (keys == "IS_FS" && w["BET_WTYPE"] == "FS") w[keys] = "";
                            else if (keys ==
                                "IS_FS" && w["BET_WTYPE"] != "FS") w[keys] = "对";
                            if (w["BALL_ACT_CLASS"] == "word_orange")
                                if (!util.in_array(tid, danAry)) danAry.push(tid);
                            if (keys == "DATE" && w[keys] != "") {
                                var data_str = w[keys].split("-");
                                var data_st = data_str[2].trim() + "-" + data_str[1].trim() + "-" + data_str[0].trim();
                                w[keys] = data_st
                            }
                            if (keys == "ODDF_TYPE") {
                                var data_str = w[keys].replace(/\(/g, "").replace(/\)/, "");
                                w[keys] = data_str
                            }
                            if (keys == "GOLD") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys] == "" ? "" : util.mprintf(w[keys] * 1, 0, 1, false, true));
                            if (keys ==
                                "WIN_GOLD")
                                if (w[keys] == "") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                                else if (isNaN(w[keys] * 1)) tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                            else tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.mprintf(w[keys] * 1, 0, 2, false, true));
                            if (keys == "WIN_GOLD_CLASS") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), w[keys]);
                            if (keys == "TID") tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(tid));
                            tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), util.showTxt(w[keys]))
                        }
                    }
                    if (isNaN(w["WIN_GOLD"] *
                            1)) w["WIN_GOLD"] = "0";
                    total_wingold += w["WIN_GOLD"] * 1;
                    total_gold += w["GOLD"] * 1;
                    tmpScreen += tpl.fastPrint()
                }
                dom.getElementById("settle_amount_gold").innerHTML = util.mprintf(total_gold * 1, 0, 1, false, true);
                dom.getElementById("settle_amount_wingold").innerHTML = util.mprintf(total_wingold * 1, 0, 2, false, true);
                dom.getElementById(hash["type"] + "_content").innerHTML = tmpScreen;
                showObj.style.display = ""
            } else _self.showNodata();
            _self.checkDateSelect(hash["selDate"])
        } else if (hash["status"] == "201") {
            showObj.style.display = "none";
            _self.showHistoryClose(true, hash["msg"])
        }
    };
    _self.closeNoData = function() {
        dom.getElementById("nodata_show").style.display = "none"
    };
    _self.showNodata = function() {
        dom.getElementById("nodata_show").style.display = "";
        dom.getElementById("today_wagers_show").style.display = "none";
        dom.getElementById("history_data_show").style.display = "none";
        dom.getElementById("history_view_show").style.display = "none"
    };
    _self.closeNodata = function() {
        dom.getElementById("nodata_show").style.display = "none"
    };
    _self.historyDataComplete =
        function(hash) {
            dateHash = hash;
            _self.showTarget("gtype_div", true);
            if (hash["status"] == "200") {
                _self.showHistoryClose(false);
                _self.initDateSelect();
                var modelObj = dom.getElementById(hash["type"] + "_model");
                var showObj = dom.getElementById(hash["type"] + "_show");
                var tpl = new fastTemplate_a1;
                tpl.init(modelObj.cloneNode(true));
                var totalAry = new Array("GOLD", "VGOLD", "WINLOSS", "WINLOSS_CLS");
                var totalData = hash["total"];
                tpl.addBlock("total");
                for (var a = 0; a < totalAry.length; a++) {
                    var keys = totalAry[a];
                    if (totalData[keys] !=
                        null) tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), totalData[keys])
                }
                var hisAry = new Array("DATE_NAME", "WEEK", "GOLD", "VGOLD", "WINLOSS", "WINLOSS_CLS", "DATE");
                for (var i = 0; i < hash["history"].length; i++) {
                    var hisData = hash["history"][i];
                    tpl.addBlock("history");
                    for (var a = 0; a < hisAry.length; a++) {
                        var keys = hisAry[a];
                        if (hisData[keys] != null) tpl.replace(new RegExp("\\*" + keys + "\\*", "gi"), hisData[keys])
                    }
                }
                showObj.innerHTML = tpl.fastPrint();
                _self.setDateClick();
                showObj.style.display = ""
            } else if (hash["status"] ==
                "201") _self.showHistoryClose(true, hash["msg"])
        };
    _self.showHistoryClose = function(isShow, msg) {
        _self.showTarget("control_bar", !isShow);
        _self.showTarget("close_div", isShow);
        dom.getElementById("close_div").innerHTML = msg
    };
    _self.showTarget = function(tagName, isShow) {
        dom.getElementById(tagName).style.display = isShow ? "" : "none"
    };
    _self.setDateClick = function() {
        var ary = dom.getElementsByName("date_btn");
        for (var i = 0; i < ary.length; i++) {
            var obj = ary[i];
            var gold = obj.getAttribute("gold");
            var date = obj.getAttribute("date");
            if (gold != "-") util.addEvent(ary[i], "click", _self.loadData, {
                "title": "history",
                "type": "history_view",
                "date": date
            })
        }
    };
    _self.addEventListener = function(eventname, eventFunction) {
        eventHandler[eventname] = eventFunction
    };
    _self.dispatchEvent = function(eventname, param) {
        if (eventHandler[eventname]) eventHandler[eventname](param)
    };
    _self.createDangerTimer = function() {
        timerObj["dg"] = new Timer(config_set.get("CONFIG_DANGEROUS"));
        timerObj["dg"].setParentclass(_self);
        timerObj["dg"].dont_clear = true;
        timerObj["dg"].init();
        timerObj["dg"].addEventListener("TimerEvent.TIMER", _self.dgTimerRun);
        timerObj["dg"].addEventListener("TimerEvent.TIMER_COMPLETE", _self.dgTimerFinish);
        timerObj["dg"].startTimer()
    };
    _self.stopDangerTimer = function() {
        util.echo("dg stopTimer");
        timerObj["dg"].stopTimer()
    };
    _self.clearDangerTimer = function() {
        util.echo("dg clearTimer");
        if (timerObj["dg"] != null) {
            timerObj["dg"].clearObj();
            timerObj["dg"] = null
        }
        return true
    };
    _self.dgTimerRun = function(count) {
        _self.getData()
    };
    _self.dgTimerFinish = function() {
        util.echo("timerComplete")
    };
    _self.checkDanger = function() {
        if (danAry.length == 0) return;
        var urlParams = "";
        urlParams += "uid=" + top.uid;
        urlParams += "&login_layer=" + top.login_layer;
        urlParams += "&tid=" + danAry.join(",");
        urlParams += "&type=json";
        urlParams += "&mid=" + postHash["sid"];
        urlParams = "p=get_dangerous&ver=" + top.ver + "&" + urlParams;
        var getHTML = new HttpRequest;
        getHTML.addEventListener("onError", _self.onError);
        getHTML.addEventListener("LoadComplete", _self.checkDangerFinish);
        getHTML.loadURL(top.url, "POST", urlParams)
    };
    _self.checkDangerFinish =
        function(json) {
            danAry.length = 0;
            var hash;
            try {
                hash = JSON.parse(json);
                if (util.chkErrorMsg(hash, LS_code)) return
            } catch (e) {
                util.err("[" + classname + "]", e);
                util.showErrorMsg("data error");
                return
            }
            var dgHash = hash["tickets"];
            for (var i in dgHash) {
                var _status = util.showTxt(dgHash[i]);
                var ret = _self.chgDangerStatus(i, _status);
                if (!ret) {
                    _self.getData();
                    break
                }
            }
        };
    _self.chgDangerStatus = function(tid, _status) {
        var msg_sty = "";
        switch (_status) {
            case "A":
                msg_sty = "word_green";
                var msgObj = document.getElementById("dg_" + tid);
                util.classFunc(msgObj, ["word_orange"], "remove");
                util.classFunc(msgObj, [msg_sty]);
                msgObj.innerHTML = LS_account.get("today_wagers_" + _status);
                break;
            case "R":
                _self.clearDangerTimer();
                msg_sty = "word_red";
                var msgObj = document.getElementById("dg_" + tid);
                util.classFunc(msgObj, ["word_orange"], "remove");
                util.classFunc(msgObj, [msg_sty]);
                msgObj.innerHTML = LS_account.get("today_wagers_" + _status);
                break;
            case "N":
                danAry.push(tid);
            default:
                break
        }
        return true
    };
    _self.replaceOU = function(txt) {
        txt = txt.replace(/OU/g, "");
        txt = txt.replace(/DT/g, "");
        txt =
            txt.replace(/P3/g, "");
        txt = txt.replace(/P/g, "");
        return txt
    };
    _self.doSelToUL = function(DOMSel, labelId) {
        var obj_ids = ",sel_text,sel_list,";
        var elmt = util.getObjAry(dom.getElementById(labelId), obj_ids);
        elmt["sel_label"] = dom.getElementById(labelId);
        elmt["sel_list"].innerHTML = "";
        var options = DOMSel.options;
        for (i = 0; i < options.length; i++) {
            var tmp_li = document.createElement("li");
            tmp_li.id = options[i].value;
            tmp_li.innerHTML = options[i].innerHTML;
            elmt["sel_list"].appendChild(tmp_li)
        }
        var sel_js = new win.ClassSelect(win,
            dom);
        sel_js.setParentclass(_self);
        sel_js.init(elmt["sel_text"], elmt["sel_list"], elmt["sel_label"], elmt["sel_label"]);
        sel_js.setSelected(DOMSel.value);
        sel_js.addEvent("ONCHANGE", _self.set_SEL_value, DOMSel);
        sel_js.addEvent("ONOPEN", _self.show_sel_box, elmt["sel_label"]);
        sel_js.addEvent("ONCLOSE", _self.close_sel_box, elmt["sel_label"]);
        DOMSel["JS_UL"] = sel_js
    };
    _self.set_SEL_value = function(e, ElmObj) {
        ElmObj.value = ElmObj.JS_UL.value();
        if ("createEvent" in document) {
            var evt = document.createEvent("HTMLEvents");
            evt.initEvent("change", false, true);
            ElmObj.dispatchEvent(evt)
        } else ElmObj.fireEvent("onchange")
    };
    _self.show_sel_box = function(e, ElmObj) {
        if (!ElmObj.classList.contains("active")) ElmObj.classList.add("active")
    };
    _self.close_sel_box = function(e, ElmObj) {
        if (ElmObj.classList.contains("active")) ElmObj.classList.remove("active")
    }
};