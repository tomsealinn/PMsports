function ClassSelect(_win, _dom){
	var _self = this;
	var win = _win;
	var dom = _dom;
	var parentClass;
	var util;
	var LS;
	var _priv = {};
	_priv.SelCss = "";
	_priv.unSelCss = "";
	_priv.resetMouseOver = false;
	_priv.isOpen = false;
	var _eventHandler = new Object();
	var _eventParam = new Object();

	//init = function (對應顯示已選項目, 對應選項列表<UL><LI>, 對應失焦關閉, 對應開啟按鈕)
	_self.init = function (nowText, divUl, divBox, divClk) {
		_priv.nowText = nowText;
		_priv.divUl = divUl;
		_priv.divBox = divBox;
		_priv.divClk = divClk;
		_priv.li = _self.getTag(_priv.divUl, "li");
		_priv.disabled = false;
		_priv.unSelCss = _self.getObjectClass(_priv.li[0]);

		_priv.divUl.prev_scroll_lock = true;
		util.addEvent(divClk, "click", _self.ShowDiv, "ONOPEN");
		if (divBox && divBox != divClk) {
			util.addEvent(divBox, "click", _self.ShowDivFromBox, "ONOPEN");
		}
		util.addEvent(divUl, "click", _self.ShowDiv, "ONCLOSE");
		//util.addEvent(divBox, "blur", _self.ShowDiv, "ONCLOSE");
		_self.checkSel();
		_self.initOption();
	}

	_self.checkSel = function () {
		if (_priv.li == null) return;
		var sel_li = _priv.li[0];
		if (_priv.selValue != null){
			for (var objid in _priv.li) {
				if (_priv.selValue == _priv.li[objid].id ) sel_li = _priv.li[objid];
			}
		}else{
			_priv.selValue = _priv.li[0].id;
		}
		if (_priv.DomSel) _priv.DomSel.value = _priv.selValue;
		var title = sel_li.innerHTML;
		_priv.nowText.innerHTML = title.replace(/\<.*?\>/g,"");
		_self.resetClass();
	}

	_self.initOption = function () {
		for (var i = 0, end = _priv.li.length; i < end; i++) {
			_self.setOnClick(_priv.li[i], _self.optionClick);
		}
	}

	_self.setOnClick = function (obj, func) {
		obj.onclick = function (e) { func(e, obj) }
	}

	_self.optionClick = function (e, tar) {
		var nowValue = (e.type == "change") ? tar.value : tar.id;
		if (nowValue != _priv.selValue) {
			_priv.selValue = nowValue;
			_self.checkSel();
			_self.eventhandler(e, "ONCHANGE", tar);
		}
	}

	_self.resetClass = function () {
		for (var i = 0, end = _priv.li.length; i < end; i++) {
			if (_priv.selValue == _priv.li[i].id) {
				_self.setObjectClass(_priv.li[i], _priv.SelCss);
				if (_priv.resetMouseOver){
					util.addEvent(_priv.divUl, "mouseover", function (e, target) { _self.setObjectClass(target, _priv.unSelCss) }, _priv.li[i]);
				}
			} else {
				_self.setObjectClass(_priv.li[i], _priv.unSelCss);
			}
		}
	}

	_self.setObjectClass = function (targetObj, classStr) {
		if (targetObj.className != undefined) {
			targetObj.className = classStr;
		} else {
			targetObj.setAttribute("class", classStr);
		}
	}

	_self.getObjectClass = function (targetObj) {
		if (targetObj.className != undefined) {
			return targetObj.className;
		} else {
			return targetObj.getAttribute("class");
		}
	}

	_self.getTag = function (obj, tName, first) {
		tName = tName || "";
		first = first || false;
		tName = tName.toUpperCase();
		var ret_ary = new Array();
		var children = obj.getElementsByTagName(tName);
		for (var i = 0, end = children.length; i < end; i++) {
			ret_ary[ret_ary.length] = children[i];
			if (first) return ret_ary;
		}
		return ret_ary;
	}

	_self.ShowDiv = function (e, OPCLS) {
		if (_priv.disabled) return;
		//由li ul 觸發強制改為關閉事件
		var all = _priv.divUl.getElementsByTagName("*");
		for (var i = 0, max = all.length; i < max; i++) {
			if (all[i] == e.target) {
				OPCLS = "ONCLOSE";
			}
		}
		if (_priv.divUl == e.target) OPCLS = "ONCLOSE";
		//由li ul 觸發強制改為關閉事件

		if (OPCLS == "ONOPEN" && !_priv.isOpen){
			_priv.isOpen = true;
			//util.addEvent(dom.getElementsByTagName("div")[0], "click", _self.BlurEvent, null);
			util.addEvent(dom.getElementsByTagName("div")[0], "mousedown", _self.BlurEvent, null);
			util.addEvent(dom.getElementsByTagName("div")[0], "touchstart", _self.BlurEvent, null);
		}else{
			OPCLS = "ONCLOSE";
			_priv.isOpen = false;
			//util.removeEvent(dom.getElementsByTagName("div")[0], "click");
			util.removeEvent(dom.getElementsByTagName("div")[0], "mousedown");
			util.removeEvent(dom.getElementsByTagName("div")[0], "touchstart");
		}

		_self.resetClass();
		_self.eventhandler(e, OPCLS, null);
	}

	_self.ShowDivFromBox = function (e, OPCLS) {
		if (_priv.divClk == e.target) return;
		var clkAll = _priv.divClk.getElementsByTagName("*");
		for (var c = 0, cmax = clkAll.length; c < cmax; c++) {
			if (clkAll[c] == e.target) return;
		}
		var all = _priv.divUl.getElementsByTagName("*");
		for (var i = 0, max = all.length; i < max; i++) {
			if (all[i] == e.target) return;
		}
		if (_priv.divUl == e.target) return;
		_self.ShowDiv(e, OPCLS);
	}

	_self.setParentclass = function (_parentclass) {
		parentClass = _parentclass;
		util = parentClass.getThis("util");
		LS = parentClass.getThis("LS");
	}

	_self.value = function () {
		return _priv.selValue;
	}

	//setSelCss = function (選單已選樣式,選單預設樣式,滑鼠移入後是否重置)
	_self.setSelCss = function (SelCss, unSelCss, resetMouseOver){
		_priv.SelCss = SelCss;
		_priv.unSelCss = unSelCss;
		_priv.resetMouseOver = resetMouseOver;
	}

	//事件處理
	_self.addEvent = function (eventname, eventFunction,Param) {
		_eventHandler[eventname] = eventFunction;
		_eventParam[eventname] = Param;
	}

	_self.eventhandler = function (_evt, _eventName, _obj) {
		if (_eventHandler[_eventName] != undefined) {
			if (_eventParam[_eventName] != null) _obj = _eventParam[_eventName];
			_eventHandler[_eventName](_evt, _obj);
		} else {
			//alert(_self.name+":"+_eventName+" not override !!");
		}
	}

	//setSelected = function (選定li  [id = _val])
	_self.setSelected = function (_val) {
		_priv.selValue = _val+"";
		_self.checkSel();
	}

	_self.BlurEvent = function (e, param) {

		var mouseIN = false;
		var all = _priv.divUl.getElementsByTagName("*");
		for (var i = 0, max = all.length; i < max; i++) {
			if (all[i] == e.target) {
				mouseIN = true;
			}
		}
		if (_priv.divUl == e.target) mouseIN = true;

		if (!mouseIN) {
			var all = _priv.divClk.getElementsByTagName("*");
			for (var i = 0, max = all.length; i < max; i++) {
				if (all[i] == e.target) {
					return false;
				}
			}
			if (_priv.divClk == e.target) return false;

			dom.activeElement.blur();
			_self.ShowDiv(e,"ONCLOSE");
		}
	}

	_self.removeEvent = function (eventname) {
		_eventHandler[eventname] = null;
		_eventParam[eventname] = null;
	}

	_self.creatSelOpt = function (DomSel) {
		DomSel.options.length = 0;
		if (_priv.li == null) return;
		for (var objid in _priv.li) {
			if (_priv.li[objid].style.display == "none") continue;
			var varItem = new Option(_priv.li[objid].innerHTML.replace(/\<.*?\>/g, ""), _priv.li[objid].id, false, false);
			DomSel.options.add(varItem);
		}
		util.addEvent(DomSel, "change", _self.optionClick, DomSel);
		DomSel.value = _priv.selValue;
		_priv.DomSel = DomSel;
	}

	_self.setDisabled = function (disabled) {
		_priv.disabled = disabled;
		if (_priv.DomSel) _priv.DomSel.disabled = disabled;
		_self.eventhandler(null, "DISABLED", null);
	}

	_self.getThis = function (varible) {
		return eval(varible);
	}
}
