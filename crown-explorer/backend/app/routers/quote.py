"""Goalserve data-capture page.

Serves a single self-contained HTML page at ``/sports/quote/goalserve`` that
lets an operator capture, in the browser, the goalserve HTTP feed this stack
already exposes same-origin:

* **HTTP** - ``GET /api/external/events?limit=2000`` (the goalserve in-play
  snapshot list).  A single button triggers ONE fetch per click; there is no
  polling and no WebSocket (deliberately disabled for now).

Every observation is stamped with the browser clock and buffered in memory.
Two CSV exports are offered: an events CSV (one row per observed event, key
``main_odds`` columns flattened plus full raw JSON) and an odds CSV (one row
per market outcome).

The page is dependency-free (inline JS/CSS) so it rides the existing SPA CSP
(``script-src 'unsafe-inline'``, ``connect-src 'self'``) unchanged.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/sports/quote/goalserve", response_class=HTMLResponse, include_in_schema=False)
def goalserve_quote_page() -> HTMLResponse:
    return HTMLResponse(content=_PAGE)


_PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Goalserve 数据采集 · CSV 导出</title>
<style>
  :root{
    --bg:#0b0f17; --panel:#121826; --panel2:#0f1420; --line:#1f2937;
    --txt:#e5e7eb; --mut:#94a3b8; --acc:#38bdf8; --ok:#22c55e; --warn:#f59e0b;
    --err:#ef4444; --ws:#a78bfa; --http:#34d399;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--txt);font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  header{padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
  header h1{margin:0;font-size:16px;font-weight:600}
  header .sub{color:var(--mut);font-size:12px;margin-top:3px}
  main{padding:14px 18px;max-width:1320px}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .card .k{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .card .v{font-size:22px;font-weight:700;margin-top:4px}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--err)}
  .dot.on{background:var(--ok)}
  .dot.idle{background:var(--mut)}
  .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  fieldset{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 12px}
  legend{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:0 6px}
  button{background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 13px;cursor:pointer;font:inherit}
  button:hover{border-color:var(--acc)}
  button:disabled{opacity:.45;cursor:not-allowed}
  button.primary{background:var(--acc);color:#04222e;border-color:var(--acc);font-weight:700}
  button.danger{border-color:var(--err);color:#fecaca}
  input[type=number]{background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:90px;font:inherit}
  label{color:var(--mut)}
  .tbl-wrap{border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:46vh}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{position:sticky;top:0;background:var(--panel);color:var(--mut);font-weight:600}
  tr:hover td{background:#0c1322}
  .src-ws{color:var(--ws);font-weight:700}
  .src-http{color:var(--http);font-weight:700}
  .muted{color:var(--mut)}
  .log{margin-top:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:8px 10px;max-height:140px;overflow:auto;font-size:11px;color:var(--mut)}
  code{color:var(--acc)}
</style>
</head>
<body>
<header>
  <h1>Goalserve 数据采集 → CSV</h1>
  <div class="sub">点击「获取一次数据」从 Goalserve 的 <code>HTTP</code>(<span class="src-http">/api/external/events</span>)拉取一次带时间戳的数据，并导出为 CSV。单次触发，不轮询、不使用 WebSocket。所有数据仅缓存在本浏览器内存中。<br>底部「单场全部盘口」可选择某一场比赛，调用 <span class="src-http">/api/external/events/{id}/markets</span> 查看并导出该场的<strong>完整</strong>市场列表（让球/半场/角球/波胆 等所有盘口）。</div>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="k">HTTP 状态</div><div class="v"><span id="httpDot" class="dot idle"></span><span id="httpState">就绪</span></div></div>
    <div class="card"><div class="k">已采集记录</div><div class="v" id="cntTotal">0</div></div>
    <div class="card"><div class="k">获取次数</div><div class="v" id="cntFetches">0</div></div>
    <div class="card"><div class="k">最近一次事件数</div><div class="v" id="cntEvents">0</div></div>
  </div>

  <fieldset>
    <legend>HTTP 单次获取</legend>
    <div class="row">
      <button id="fetchOnce" class="primary">获取一次数据</button>
      <span class="muted">每次点击拉取一次 <code>/api/external/events?limit=2000</code>，按事件逐条追加到缓存。</span>
    </div>
  </fieldset>

  <fieldset>
    <legend>导出 / 清空</legend>
    <div class="row">
      <button id="dlEvents" class="primary">下载事件 CSV</button>
      <button id="dlOdds" class="primary">下载赔率明细 CSV（长表）</button>
      <button id="clear" class="danger">清空缓存</button>
      <label>缓存上限 <input id="capInput" type="number" min="1000" step="1000" value="500000"></label>
    </div>
  </fieldset>

  <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th>采集时间(本地)</th><th>源</th><th>事件ID</th><th>联赛</th>
        <th>主队</th><th>客队</th><th>比分</th><th>状态</th><th>分钟</th>
        <th>主胜</th><th>平</th><th>客胜</th><th>让球线</th><th>大小线</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <fieldset style="margin-top:14px">
    <legend>单场全部盘口（Goalserve 完整书）</legend>
    <div class="row">
      <select id="evSelect" style="background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 9px;min-width:320px;font:inherit"></select>
      <input id="evIdInput" type="number" placeholder="或直接输入事件ID" style="width:160px">
      <button id="loadMarkets" class="primary">获取该场全部盘口</button>
      <button id="dlMarkets" class="primary">下载全部盘口 CSV</button>
      <span class="muted">调用 <code>/api/external/events/{id}/markets</code>，展示该场所有市场与选项。</span>
    </div>
    <div id="mktMeta" class="muted" style="margin-bottom:8px"></div>
    <div class="tbl-wrap" style="max-height:52vh">
      <table>
        <thead><tr>
          <th>#</th><th>市场名称</th><th>market_id</th><th>选项</th><th>赔率</th><th>让分/线</th>
        </tr></thead>
        <tbody id="mktBody"></tbody>
      </table>
    </div>
  </fieldset>

  <div class="log" id="log"></div>
</main>

<script>
"use strict";
(function(){
  // -------- buffer ----------------------------------------------------------
  // Each record: { t:epochMs, src:'http', ev:Object }
  var buf = [];
  var nFetches = 0, lastEventCount = 0;
  var PREVIEW_MAX = 200;          // table only renders the most recent rows
  var cap = 500000;

  var $ = function(id){ return document.getElementById(id); };
  function log(msg){
    var el = $('log');
    var line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    el.textContent = line + '\n' + el.textContent;
  }
  function pad(n){ return n < 10 ? '0'+n : ''+n; }
  function isoLocal(ms){
    var d = new Date(ms);
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '
      + pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'.'
      + String(d.getMilliseconds()).padStart(3,'0');
  }
  function num(v){ return (v===null||v===undefined||v==='') ? '' : v; }
  function score(ev){
    var h = ev.score_home, a = ev.score_away;
    if(h===null||h===undefined){ return ''; }
    return h + ':' + (a===null||a===undefined?'':a);
  }

  // -------- counters / preview ---------------------------------------------
  function refreshCounters(){
    $('cntTotal').textContent = buf.length;
    $('cntFetches').textContent = nFetches;
    $('cntEvents').textContent = lastEventCount;
  }
  function appendPreview(rec){
    var tb = $('tbody');
    var ev = rec.ev || {};
    var mo = ev.main_odds || {};
    var tr = document.createElement('tr');
    function td(txt, cls){ var c=document.createElement('td'); c.textContent=txt; if(cls)c.className=cls; tr.appendChild(c); }
    td(isoLocal(rec.t));
    td(rec.src.toUpperCase(), 'src-http');
    td(num(ev.id));
    td(num(ev.league_name));
    td(num(ev.home));
    td(num(ev.away));
    td(score(ev));
    td(num(ev.status));
    td(num(ev.elapsed_minute));
    td(num(mo.m_h));
    td(num(mo.m_n));
    td(num(mo.m_c));
    td(num(mo.re_line));
    td(num(mo.ou_line));
    tb.insertBefore(tr, tb.firstChild);
    while(tb.childElementCount > PREVIEW_MAX){ tb.removeChild(tb.lastChild); }
  }

  function record(src, ev){
    if(!ev || (ev.id===undefined || ev.id===null)) { return; }
    if(buf.length >= cap){
      // drop oldest to stay within the cap (ring-ish behaviour)
      buf.shift();
    }
    var rec = { t: Date.now(), src: src, ev: ev };
    buf.push(rec);
    appendPreview(rec);
    refreshCounters();
  }

  // -------- HTTP single fetch ----------------------------------------------
  var httpBusy = false;
  function setHttpState(on, txt){
    $('httpDot').className = 'dot ' + (on?'on':'idle');
    $('httpState').textContent = txt;
  }
  $('fetchOnce').onclick = function(){
    if(httpBusy){ return; }
    httpBusy = true;
    $('fetchOnce').disabled = true;
    setHttpState(true, '获取中…');
    fetch('/api/external/events?limit=2000', { headers:{'Accept':'application/json'}, cache:'no-store' })
      .then(function(r){ if(!r.ok){ throw new Error('HTTP '+r.status); } return r.json(); })
      .then(function(j){
        var items = (j && j.items) ? j.items : (Array.isArray(j)?j:[]);
        lastEventCount = items.length;
        for(var i=0;i<items.length;i++){ record('http', items[i]); }
        populateEventSelect(items);
        nFetches++;
        refreshCounters();
        setHttpState(false, '就绪');
        log('获取一次成功：'+items.length+' 个事件');
      })
      .catch(function(e){
        setHttpState(false, '失败');
        log('HTTP 获取失败: '+e.message);
      })
      .finally(function(){
        httpBusy = false;
        $('fetchOnce').disabled = false;
      });
  };

  // -------- CSV export ------------------------------------------------------
  function csvCell(v){
    if(v===null||v===undefined){ return ''; }
    var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    if(/[",\n\r]/.test(s)){ s = '"' + s.replace(/"/g,'""') + '"'; }
    return s;
  }
  function downloadCsv(filename, rows){
    var csv = rows.map(function(r){ return r.map(csvCell).join(','); }).join('\r\n');
    // Prepend UTF-8 BOM so Excel renders Chinese team/league names correctly.
    var blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
  function stamp(){
    var d = new Date();
    return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
  }
  $('dlEvents').onclick = function(){
    if(!buf.length){ log('缓存为空，无法导出'); return; }
    var head = ['captured_iso','captured_epoch_ms','source','event_id',
      'league_name','home','away','score_home','score_away','status','elapsed_minute',
      'ml_home','ml_draw','ml_away','ah_line','ah_home','ah_away','ou_line','ou_over','ou_under',
      'main_odds_json','raw_json'];
    var rows = [head];
    for(var i=0;i<buf.length;i++){
      var rec = buf[i], ev = rec.ev||{}, mo = ev.main_odds||{};
      rows.push([
        isoLocal(rec.t), rec.t, rec.src, ev.id,
        ev.league_name, ev.home, ev.away, ev.score_home, ev.score_away, ev.status, ev.elapsed_minute,
        mo.m_h, mo.m_n, mo.m_c, mo.re_line, mo.re_h, mo.re_c, mo.ou_line, mo.ou_over, mo.ou_under,
        mo, ev
      ]);
    }
    downloadCsv('goalserve-events-'+stamp()+'.csv', rows);
    log('已导出事件 CSV：'+(rows.length-1)+' 行');
  };
  $('dlOdds').onclick = function(){
    if(!buf.length){ log('缓存为空，无法导出'); return; }
    var head = ['captured_iso','captured_epoch_ms','source','event_id',
      'league_name','home','away','score_home','score_away','status','elapsed_minute',
      'market_key','outcome','price','handicap'];
    var rows = [head];
    // Flatten the known main_odds key-groups into long-format outcome rows.
    function emit(rec, ev, key, outcome, price, hdp){
      if(price===null||price===undefined||price===''||price===0){ return; }
      rows.push([ isoLocal(rec.t), rec.t, rec.src, ev.id,
        ev.league_name, ev.home, ev.away, ev.score_home, ev.score_away, ev.status, ev.elapsed_minute,
        key, outcome, price, (hdp===undefined?'':hdp) ]);
    }
    for(var i=0;i<buf.length;i++){
      var rec = buf[i], ev = rec.ev||{}, mo = ev.main_odds||{};
      emit(rec,ev,'ML','home',mo.m_h); emit(rec,ev,'ML','draw',mo.m_n); emit(rec,ev,'ML','away',mo.m_c);
      emit(rec,ev,'Spread','home',mo.re_h,mo.re_line); emit(rec,ev,'Spread','away',mo.re_c,mo.re_line);
      emit(rec,ev,'Totals','over',mo.ou_over,mo.ou_line); emit(rec,ev,'Totals','under',mo.ou_under,mo.ou_line);
      emit(rec,ev,'HT_ML','home',mo.ht_h); emit(rec,ev,'HT_ML','draw',mo.ht_n); emit(rec,ev,'HT_ML','away',mo.ht_c);
      emit(rec,ev,'Spread_HT','home',mo.reh_h,mo.reh_line); emit(rec,ev,'Spread_HT','away',mo.reh_c,mo.reh_line);
      emit(rec,ev,'Totals_HT','over',mo.ouh_over,mo.ouh_line); emit(rec,ev,'Totals_HT','under',mo.ouh_under,mo.ouh_line);
      emit(rec,ev,'BTTS','yes',mo.btts_y); emit(rec,ev,'BTTS','no',mo.btts_n);
    }
    downloadCsv('goalserve-odds-'+stamp()+'.csv', rows);
    log('已导出赔率明细 CSV：'+(rows.length-1)+' 行');
  };
  $('clear').onclick = function(){
    buf = []; nFetches = 0; lastEventCount = 0;
    $('tbody').innerHTML = '';
    refreshCounters();
    log('已清空缓存');
  };
  $('capInput').onchange = function(){
    cap = Math.max(1000, parseInt($('capInput').value,10)||500000);
    log('缓存上限设为 '+cap);
  };

  // -------- 单场全部盘口 (full book) ----------------------------------------
  // The events list carries a condensed `main_odds` only; the FULL Goalserve
  // book lives behind /api/external/events/{id}/markets. This panel fetches
  // and renders every market + outcome for one selected event.
  var lastMarkets = null;          // last { event, bookmakers } payload
  var lastMarketsEid = null;

  function populateEventSelect(items){
    var sel = $('evSelect');
    var prev = sel.value;
    // de-dup by id (the buffer appends across fetches; the select shouldn't).
    var seen = {}, opts = [];
    for(var i=0;i<items.length;i++){
      var ev = items[i] || {};
      if(ev.id===undefined || ev.id===null || seen[ev.id]) { continue; }
      seen[ev.id] = true;
      var lbl = '#'+ev.id+' · '+(ev.home||'?')+' vs '+(ev.away||'?')
        + ' · '+(ev.league_name||'')
        + (ev.market_count!=null ? ' ('+ev.market_count+'盘)' : '');
      opts.push({ v:String(ev.id), t:lbl });
    }
    opts.sort(function(a,b){ return a.t<b.t?-1:(a.t>b.t?1:0); });
    sel.innerHTML = '';
    var ph = document.createElement('option');
    ph.value=''; ph.textContent='— 选择一场比赛（'+opts.length+'）—';
    sel.appendChild(ph);
    for(var k=0;k<opts.length;k++){
      var o = document.createElement('option');
      o.value = opts[k].v; o.textContent = opts[k].t;
      sel.appendChild(o);
    }
    if(prev){ sel.value = prev; }
  }

  // Each market's `odds` row is either a passthrough {selection,price,handicap}
  // or a field-keyed {home,draw,away,over,under,yes,no,hdp,label,price,...}.
  // Flatten either shape into [{outcome, price, hdp}] rows.
  var _META = { hdp:1, handicap:1, line:1, label:1, selection:1, market_id:1,
    market_id_int:1, market_name:1, name:1, updated_at_iso:1, updated_at_ts:1 };
  function outcomeRows(row){
    if(!row || typeof row!=='object'){ return []; }
    var hdp = (row.handicap!=null?row.handicap:(row.hdp!=null?row.hdp:(row.line!=null?row.line:'')));
    if(row.selection!=null || (row.price!=null && row.label==null)){
      var nm = (row.selection!=null?row.selection:(row.label!=null?row.label:''));
      return [{ outcome:nm, price:row.price, hdp:hdp }];
    }
    if(row.label!=null && row.price!=null){
      return [{ outcome:row.label, price:row.price, hdp:hdp }];
    }
    var out = [];
    for(var k in row){
      if(!Object.prototype.hasOwnProperty.call(row,k) || _META[k]){ continue; }
      var v = row[k];
      if(typeof v==='object'){ continue; }
      var label = (row.label!=null? row.label+' / '+k : k);
      out.push({ outcome:label, price:v, hdp:hdp });
    }
    return out;
  }

  function flattenBook(payload){
    // → [{idx, market_name, market_id, outcome, price, hdp}]
    var bks = (payload && payload.bookmakers) || [];
    var rows = [], idx = 0;
    for(var b=0;b<bks.length;b++){
      var mkts = (bks[b] && bks[b].markets) || [];
      for(var m=0;m<mkts.length;m++){
        idx++;
        var mk = mkts[m] || {};
        var mname = mk.market_name || mk.name || '';
        var mid = mk.market_id || mk.market_id_int || '';
        var odds = mk.odds || [];
        var emitted = false;
        for(var o=0;o<odds.length;o++){
          var ors = outcomeRows(odds[o]);
          for(var x=0;x<ors.length;x++){
            rows.push({ idx:idx, market_name:mname, market_id:mid,
              outcome:ors[x].outcome, price:ors[x].price, hdp:ors[x].hdp });
            emitted = true;
          }
        }
        if(!emitted){ rows.push({ idx:idx, market_name:mname, market_id:mid, outcome:'', price:'', hdp:'' }); }
      }
    }
    return rows;
  }

  function renderMarkets(payload){
    var tb = $('mktBody');
    tb.innerHTML = '';
    var rows = flattenBook(payload);
    var lastIdx = null;
    for(var i=0;i<rows.length;i++){
      var r = rows[i];
      var tr = document.createElement('tr');
      function td(txt){ var c=document.createElement('td'); c.textContent=(txt===null||txt===undefined?'':txt); tr.appendChild(c); }
      var firstOfMarket = (r.idx!==lastIdx);
      td(firstOfMarket ? r.idx : '');
      td(firstOfMarket ? r.market_name : '');
      td(firstOfMarket ? r.market_id : '');
      td(r.outcome);
      td(r.price);
      td(r.hdp);
      tb.appendChild(tr);
      lastIdx = r.idx;
    }
  }

  function selectedEid(){
    var typed = ($('evIdInput').value||'').trim();
    if(typed){ return typed; }
    return ($('evSelect').value||'').trim();
  }

  var mktBusy = false;
  $('loadMarkets').onclick = function(){
    if(mktBusy){ return; }
    var eid = selectedEid();
    if(!eid){ log('请先选择或输入一个事件ID'); return; }
    mktBusy = true;
    $('loadMarkets').disabled = true;
    $('mktMeta').textContent = '加载中…';
    fetch('/api/external/events/'+encodeURIComponent(eid)+'/markets',
          { headers:{'Accept':'application/json'}, cache:'no-store' })
      .then(function(r){ if(!r.ok){ throw new Error('HTTP '+r.status); } return r.json(); })
      .then(function(j){
        lastMarkets = j; lastMarketsEid = eid;
        var ev = j.event || {};
        var bks = j.bookmakers || [];
        var nMkt = 0;
        for(var b=0;b<bks.length;b++){ nMkt += ((bks[b]&&bks[b].markets)||[]).length; }
        $('mktMeta').textContent = '#'+eid+'  '+(ev.home||'?')+' vs '+(ev.away||'?')
          + ' · ' + (ev.league_name||'') + ' · 来源=' + (j.source||'?')
          + ' · 庄家=' + (bks.map(function(x){return x.bookmaker;}).join(',')||'-')
          + ' · 市场数=' + nMkt + ' (total_markets=' + (j.total_markets!=null?j.total_markets:'?') + ')';
        renderMarkets(j);
        log('已加载 #'+eid+' 全部盘口：'+nMkt+' 个市场');
      })
      .catch(function(e){
        $('mktMeta').textContent = '失败: '+e.message;
        log('加载全部盘口失败: '+e.message);
      })
      .finally(function(){ mktBusy=false; $('loadMarkets').disabled=false; });
  };

  $('dlMarkets').onclick = function(){
    if(!lastMarkets){ log('请先「获取该场全部盘口」'); return; }
    var ev = lastMarkets.event || {};
    var rows = flattenBook(lastMarkets);
    var head = ['event_id','home','away','league_name','source',
      'market_idx','market_name','market_id','outcome','price','handicap'];
    var out = [head];
    for(var i=0;i<rows.length;i++){
      var r = rows[i];
      out.push([ lastMarketsEid, ev.home, ev.away, ev.league_name, lastMarkets.source,
        r.idx, r.market_name, r.market_id, r.outcome, r.price, r.hdp ]);
    }
    downloadCsv('goalserve-fullbook-'+lastMarketsEid+'-'+stamp()+'.csv', out);
    log('已导出全部盘口 CSV：'+(out.length-1)+' 行');
  };

  refreshCounters();
  log('就绪。点击「获取一次数据」拉取，然后导出 CSV。');
})();
</script>
</body>
</html>
"""
