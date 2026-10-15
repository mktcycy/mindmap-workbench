/* 心智圖工具 — storage layer + editor
   資料存放：填了 CONFIG.SUPABASE_URL / KEY 就走雲端共用，沒填就存在這台瀏覽器。 */
(function(){
  "use strict";

  var CONFIG = {
    SUPABASE_URL: "https://rzriqsevesjngggbzpuu.supabase.co",
    SUPABASE_KEY: "sb_publishable_vv2PX4US87KFDm7v7SXi5w_NKX_2jr8",  /* publishable key，本來就是公開給前端用的 */
    TABLE: "mindmaps"
  };

  var ORX = 4000, ORY = 3000, GAPX = 56, GAPY = 16, PH = "（未命名）";
  var DEPTH_VARS = ["--d0","--d1","--d2","--d3","--d4"];
  var LS_KEY = "mindmap-workbench:v1";

  var el = {
    maplist: document.getElementById("maplist"), railCount: document.getElementById("railCount"),
    btnNew: document.getElementById("btnNew"), btnNew2: document.getElementById("btnNew2"),
    led: document.getElementById("led"), ledText: document.getElementById("ledText"),
    titleIn: document.getElementById("titleIn"), metaTxt: document.getElementById("metaTxt"),
    btnSave: document.getElementById("btnSave"), btnFit: document.getElementById("btnFit"),
    notice: document.getElementById("notice"), stage: document.getElementById("stage"),
    canvas: document.getElementById("canvas"), wires: document.getElementById("wires"),
    nodes: document.getElementById("nodes"), tb: document.getElementById("tb"),
    blank: document.getElementById("blank"), toast: document.getElementById("toast"),
    zIn: document.getElementById("zIn"), zOut: document.getElementById("zOut"), zReset: document.getElementById("zReset"),
    np: document.getElementById("np"), npUrl: document.getElementById("npUrl"), npNote: document.getElementById("npNote"),
    npOk: document.getElementById("npOk"), npCancel: document.getElementById("npCancel"),
    bubble: document.getElementById("bubble"),
    q: document.getElementById("q"), qn: document.getElementById("qn"), qPrev: document.getElementById("qPrev"),
    qNext: document.getElementById("qNext"), qClear: document.getElementById("qClear")
  };

  var ICON = {
    link: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
        + '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.9.9"/>'
        + '<path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.9-.9"/></svg>',
    note: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
        + '<path d="M3 4h10M3 8h10M3 12h6"/></svg>'
  };

  var iconCache = {};
  function icon(kind){
    if(!iconCache[kind]) iconCache[kind] = new DOMParser().parseFromString(ICON[kind], "image/svg+xml").documentElement;
    return iconCache[kind].cloneNode(true);
  }
  /* 只放行 http / https，擋掉 javascript: 之類的網址 */
  function safeUrl(raw){
    var u = (raw || "").trim();
    if(!u) return "";
    if(!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
    return /^https?:\/\/\S+$/i.test(u) ? u : "";
  }

  var S = {
    remote: {}, work: {}, order: [], dirty: {}, fresh: {},
    cur: null, sel: null, editing: null,
    view: {x:0, y:0, k:1}, pos: {}, saving: false,
    q: "", hits: [], hitIdx: 0
  };

  function uid(n){ var s="", a="abcdefghijklmnopqrstuvwxyz0123456789"; n=n||7;
    for(var i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function clamp(v,a,b){ return v<a?a:v>b?b:v; }
  var toastT=0;
  function toast(msg){ el.toast.textContent=msg; el.toast.hidden=false;
    clearTimeout(toastT); toastT=setTimeout(function(){ el.toast.hidden=true; }, 2600); }
  function notice(msg, bad){
    if(!msg){ el.notice.hidden=true; return; }
    el.notice.textContent=msg; el.notice.className="notice"+(bad?" bad":""); el.notice.hidden=false;
  }

  /* ================= storage ================= */
  var Store = (function(){
    var cloud = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
    var base = cloud ? CONFIG.SUPABASE_URL.replace(/\/+$/,"") + "/rest/v1/" + CONFIG.TABLE : null;
    function headers(extra){
      var h = { "apikey": CONFIG.SUPABASE_KEY, "Authorization": "Bearer " + CONFIG.SUPABASE_KEY,
                "Content-Type": "application/json" };
      if(extra) for(var k in extra) h[k]=extra[k];
      return h;
    }
    function fail(res){
      return res.text().then(function(t){
        var m = t; try { m = (JSON.parse(t).message || t); } catch(_){}
        throw new Error("HTTP " + res.status + (m ? "：" + m : ""));
      });
    }
    function lsRead(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch(_){ return {}; } }
    function lsWrite(o){ localStorage.setItem(LS_KEY, JSON.stringify(o)); }

    return {
      cloud: cloud,
      list: function(){
        if(!cloud){
          var o = lsRead();
          return Promise.resolve(Object.keys(o).map(function(k){ return o[k]; })
            .sort(function(a,b){ return (a.createdAt||0)-(b.createdAt||0); }));
        }
        return fetch(base + "?select=*&order=created_at.asc", { headers: headers() })
          .then(function(r){ return r.ok ? r.json() : fail(r); })
          .then(function(rows){
            return rows.map(function(r){
              return { id:r.id, title:r.title, rootId:r.data && r.data.rootId, nodes:r.data && r.data.nodes,
                       createdAt:Number(r.created_at), updatedAt:Number(r.updated_at), nodeCount:r.node_count };
            }).filter(function(d){ return d.rootId && d.nodes; });
          });
      },
      save: function(doc){
        if(!cloud){
          var o = lsRead(); o[doc.id] = clone(doc); lsWrite(o); return Promise.resolve();
        }
        var row = { id: doc.id, title: doc.title, data: { rootId: doc.rootId, nodes: doc.nodes },
                    created_at: doc.createdAt, updated_at: doc.updatedAt, node_count: doc.nodeCount };
        return fetch(base + "?on_conflict=id",
          { method:"POST", headers: headers({ "Prefer":"resolution=merge-duplicates,return=minimal" }),
            body: JSON.stringify(row) })
          .then(function(r){ if(!r.ok) return fail(r); });
      },
      remove: function(id){
        if(!cloud){ var o = lsRead(); delete o[id]; lsWrite(o); return Promise.resolve(); }
        return fetch(base + "?id=eq." + encodeURIComponent(id),
          { method:"DELETE", headers: headers({ "Prefer":"return=minimal" }) })
          .then(function(r){ if(!r.ok) return fail(r); });
      }
    };
  })();

  /* ================= model ================= */
  function newMap(){
    var rid = uid();
    var nodes = {}; nodes[rid] = {id:rid, text:"中心主題", parent:null, side:"R", seq:0};
    return { id: uid(10), title:"未命名心智圖", rootId: rid, nodes: nodes, createdAt: Date.now() };
  }
  function kids(m, id){
    var out=[]; for(var k in m.nodes){ if(m.nodes[k].parent===id) out.push(m.nodes[k]); }
    out.sort(function(a,b){ return (a.seq||0)-(b.seq||0); }); return out;
  }
  function depth(m, id){ var d=0, n=m.nodes[id]; while(n && n.parent){ d++; n=m.nodes[n.parent]; } return d; }
  function nodeCount(m){ return Object.keys(m.nodes).length; }
  function markDirty(){ if(S.cur){ S.dirty[S.cur]=true; renderList(); renderTop(); } }

  function addNode(parentId){
    var m = S.work[S.cur]; if(!m || !m.nodes[parentId]) return null;
    var id = uid(), sibs = kids(m, parentId), sd = m.nodes[parentId].side || "R";
    if(m.nodes[parentId].parent === null){
      var r=0,l=0; sibs.forEach(function(s){ s.side==="L"?l++:r++; });
      sd = l < r ? "L" : "R";
    }
    m.nodes[id] = { id:id, text:"", parent:parentId, side:sd, seq: sibs.length ? (sibs[sibs.length-1].seq||0)+1 : 0 };
    markDirty(); S.sel = id; render(); edit(id, true); return id;
  }
  function addSibling(id){
    var m = S.work[S.cur]; var n = m && m.nodes[id];
    if(!n || n.parent === null) return;
    var sibs = kids(m, n.parent), at = -1;
    sibs.forEach(function(s,i){ if(s.id===id) at=i; });
    var nid = uid();
    m.nodes[nid] = { id:nid, text:"", parent:n.parent, side:n.side, seq:(n.seq||0)+0.5 };
    sibs.splice(at+1, 0, m.nodes[nid]);
    sibs.forEach(function(s,i){ m.nodes[s.id].seq = i; });
    markDirty(); S.sel = nid; render(); edit(nid, true);
  }
  function delNode(id){
    var m = S.work[S.cur]; var n = m && m.nodes[id];
    if(!n || n.parent === null) return;
    var sub = kids(m, id).length;
    var txt = (n.text || PH).slice(0,14);
    if(sub && !confirm("刪除「"+txt+"」會連同底下 "+sub+" 層分支一起刪除，確定嗎？")) return;
    (function wipe(x){ kids(m, x).forEach(function(c){ wipe(c.id); }); delete m.nodes[x]; })(id);
    S.sel = n.parent; markDirty(); render();
  }

  /* ================= node text editing ================= */
  function edit(id, selectAll){
    var node = el.nodes.querySelector('[data-id="'+id+'"]'); if(!node) return;
    S.editing = id;
    node.textContent = S.work[S.cur].nodes[id].text || "";
    node.contentEditable = "true";
    node.focus();
    var r = document.createRange(), sl = window.getSelection();
    r.selectNodeContents(node);
    if(!selectAll && node.textContent) r.collapse(false);
    sl.removeAllRanges(); sl.addRange(r);
    el.tb.hidden = true;
  }
  function commit(keep){
    var id = S.editing; if(!id) return;
    var node = el.nodes.querySelector('[data-id="'+id+'"]');
    S.editing = null;
    if(!node) return;
    var txt = (node.textContent||"").replace(/\s+/g," ").trim();
    node.contentEditable = "false";
    var m = S.work[S.cur]; if(!m || !m.nodes[id]) return;
    if(txt !== m.nodes[id].text){ m.nodes[id].text = txt; markDirty(); }
    if(!keep) render();
  }

  /* ================= layout ================= */
  /* 把符合搜尋字串的片段包進 <mark> */
  function putText(parent, text, q){
    if(!q){ parent.appendChild(document.createTextNode(text)); return; }
    var lower = text.toLowerCase(), i = 0, at;
    while((at = lower.indexOf(q, i)) >= 0){
      if(at > i) parent.appendChild(document.createTextNode(text.slice(i, at)));
      var mk = document.createElement("mark");
      mk.textContent = text.slice(at, at + q.length);
      parent.appendChild(mk);
      i = at + q.length;
    }
    if(i < text.length) parent.appendChild(document.createTextNode(text.slice(i)));
  }
  /* 節點文字、備註、網址任一命中都算 */
  function matches(n, q){
    if(!q) return false;
    return (n.text || "").toLowerCase().indexOf(q) >= 0
        || (n.note || "").toLowerCase().indexOf(q) >= 0
        || (n.url  || "").toLowerCase().indexOf(q) >= 0;
  }

  function renderNodes(){
    var m = S.work[S.cur], q = S.q;
    el.nodes.textContent = ""; el.wires.textContent = "";
    el.nodes.classList.toggle("searching", !!q);
    S.hits = [];
    if(!m) return;
    Object.keys(m.nodes).forEach(function(id){
      var n = m.nodes[id], d = depth(m, id);
      var hit = matches(n, q);
      if(hit) S.hits.push(id);
      var b = document.createElement("div");
      b.className = "node" + (n.parent===null ? " root" : "") + (S.sel===id ? " sel" : "") + (hit ? " hit" : "");
      b.dataset.id = id;
      b.style.setProperty("--nc", "var("+DEPTH_VARS[Math.min(d, DEPTH_VARS.length-1)]+")");
      if(n.text){ putText(b, n.text, q); }
      else { var i=document.createElement("span"); i.className="ph"; i.textContent=PH; b.appendChild(i); }

      var url = safeUrl(n.url), note = (n.note || "").trim();
      if(url || note){
        var bag = document.createElement("span"); bag.className = "badges";
        if(url){
          var a = document.createElement("a");
          a.className = "ic link"; a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.title = "開啟 " + url; a.appendChild(icon("link"));
          bag.appendChild(a);
        }
        if(note){
          var nb = document.createElement("button");
          nb.className = "ic note"; nb.type = "button"; nb.title = "看備註"; nb.appendChild(icon("note"));
          bag.appendChild(nb);
        }
        b.appendChild(bag);
      }
      el.nodes.appendChild(b);
    });
  }

  function layout(){
    var m = S.work[S.cur]; S.pos = {};
    if(!m) return;
    var size = {};
    Array.prototype.forEach.call(el.nodes.children, function(b){
      size[b.dataset.id] = { w: b.offsetWidth, h: b.offsetHeight };
    });
    var root = m.rootId, hCache = {};
    function sub(id){
      if(hCache[id] != null) return hCache[id];
      var ch = kids(m, id), t = 0;
      ch.forEach(function(c,i){ t += sub(c.id) + (i ? GAPY : 0); });
      return (hCache[id] = Math.max(size[id] ? size[id].h : 30, t));
    }
    function place(id, anchorX, cy, dir){
      var s = size[id] || {w:80,h:30};
      S.pos[id] = { x: dir > 0 ? anchorX : anchorX - s.w, y: cy - s.h/2, w: s.w, h: s.h, dir: dir };
      var ch = kids(m, id);
      if(!ch.length) return;
      var total = 0; ch.forEach(function(c,i){ total += sub(c.id) + (i ? GAPY : 0); });
      var cursor = cy - total/2;
      var nextX = dir > 0 ? (S.pos[id].x + s.w + GAPX) : (S.pos[id].x - GAPX);
      ch.forEach(function(c){
        var hh = sub(c.id);
        place(c.id, nextX, cursor + hh/2, dir);
        cursor += hh + GAPY;
      });
    }
    var rs = size[root] || {w:120,h:40};
    S.pos[root] = { x: ORX - rs.w/2, y: ORY - rs.h/2, w: rs.w, h: rs.h, dir: 1 };
    var top = kids(m, root), right = [], left = [];
    top.forEach(function(n){ (n.side === "L" ? left : right).push(n); });
    [[right,1],[left,-1]].forEach(function(pair){
      var list = pair[0], dir = pair[1];
      if(!list.length) return;
      var total = 0; list.forEach(function(c,i){ total += sub(c.id) + (i ? GAPY : 0); });
      var cursor = ORY - total/2;
      var ax = dir > 0 ? (S.pos[root].x + rs.w + GAPX) : (S.pos[root].x - GAPX);
      list.forEach(function(c){
        var hh = sub(c.id);
        place(c.id, ax, cursor + hh/2, dir);
        cursor += hh + GAPY;
      });
    });

    Array.prototype.forEach.call(el.nodes.children, function(b){
      var p = S.pos[b.dataset.id]; if(!p) return;
      b.style.left = p.x + "px"; b.style.top = p.y + "px";
    });

    var svgns = "http://www.w3.org/2000/svg", frag = document.createDocumentFragment();
    Object.keys(m.nodes).forEach(function(id){
      var n = m.nodes[id]; if(n.parent === null) return;
      var a = S.pos[n.parent], c = S.pos[id]; if(!a || !c) return;
      var dir = c.dir;
      var x1 = dir > 0 ? a.x + a.w : a.x, y1 = a.y + a.h/2;
      var x2 = dir > 0 ? c.x : c.x + c.w, y2 = c.y + c.h/2;
      if(m.nodes[n.parent].parent === null) x1 = a.x + (dir>0 ? a.w : 0);
      var mx = (x1 + x2)/2;
      var path = document.createElementNS(svgns, "path");
      path.setAttribute("d", "M"+x1+","+y1+" C"+mx+","+y1+" "+mx+","+y2+" "+x2+","+y2);
      path.setAttribute("fill","none");
      path.setAttribute("stroke","var("+DEPTH_VARS[Math.min(depth(m,id), DEPTH_VARS.length-1)]+")");
      path.setAttribute("stroke-width","1.6");
      path.setAttribute("stroke-opacity","0.6");
      path.setAttribute("stroke-linecap","round");
      frag.appendChild(path);
    });
    el.wires.appendChild(frag);
  }

  function bbox(){
    var ids = Object.keys(S.pos); if(!ids.length) return null;
    var x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
    ids.forEach(function(id){ var p=S.pos[id];
      x1=Math.min(x1,p.x); y1=Math.min(y1,p.y); x2=Math.max(x2,p.x+p.w); y2=Math.max(y2,p.y+p.h); });
    return {x1:x1,y1:y1,x2:x2,y2:y2,w:x2-x1,h:y2-y1};
  }
  function applyView(){
    el.canvas.style.transform = "translate("+S.view.x+"px,"+S.view.y+"px) scale("+S.view.k+")";
    placeToolbar();
    if(!el.bubble.hidden) showBubble(el.bubble.dataset.id);
    if(npFor) openPropsReposition();
  }
  function openPropsReposition(){
    var r = anchorRect(npFor); if(!r) return;
    var w = el.np.offsetWidth, h = el.np.offsetHeight;
    el.np.style.left = clamp(r.cx, w/2 + 10, r.sw - w/2 - 10) + "px";
    el.np.style.top = (r.below + h + 10 > r.sh ? Math.max(10, r.above - h) : r.below) + "px";
  }
  function fit(){
    var b = bbox(); if(!b) return;
    var sw = el.stage.clientWidth, sh = el.stage.clientHeight, pad = 56;
    var k = clamp(Math.min((sw-pad*2)/Math.max(b.w,1), (sh-pad*2)/Math.max(b.h,1)), 0.3, 1.1);
    S.view.k = k;
    S.view.x = (sw - b.w*k)/2 - b.x1*k;
    S.view.y = (sh - b.h*k)/2 - b.y1*k;
    applyView();
  }
  function zoomAt(cx, cy, factor){
    var k2 = clamp(S.view.k*factor, 0.3, 2.4), f = k2/S.view.k;
    S.view.x = cx - (cx - S.view.x)*f;
    S.view.y = cy - (cy - S.view.y)*f;
    S.view.k = k2; applyView();
  }
  function placeToolbar(){
    var m = S.work[S.cur];
    if(!m || !S.sel || !m.nodes[S.sel] || S.editing){ el.tb.hidden = true; return; }
    var node = el.nodes.querySelector('[data-id="'+S.sel+'"]');
    if(!node){ el.tb.hidden = true; return; }
    var sr = el.stage.getBoundingClientRect(), nr = node.getBoundingClientRect();
    el.tb.hidden = false;
    var tw = el.tb.offsetWidth || 240;
    el.tb.style.left = clamp(nr.left - sr.left + nr.width/2, tw/2 + 8, sr.width - tw/2 - 8) + "px";
    el.tb.style.top = Math.max(el.tb.offsetHeight + 10, nr.top - sr.top - 8) + "px";
    var isRoot = m.nodes[S.sel].parent === null;
    el.tb.querySelector('[data-act="sib"]').disabled = isRoot;
    el.tb.querySelector('[data-act="del"]').disabled = isRoot;
  }

  /* ================= 超連結 / 備註 ================= */
  var npFor = null;
  function anchorRect(id){
    var node = el.nodes.querySelector('[data-id="'+id+'"]');
    if(!node) return null;
    var sr = el.stage.getBoundingClientRect(), nr = node.getBoundingClientRect();
    return { sw: sr.width, sh: sr.height, cx: nr.left - sr.left + nr.width/2,
             below: nr.bottom - sr.top + 10, above: nr.top - sr.top - 10 };
  }
  function openProps(id, field){
    var m = S.work[S.cur]; var n = m && m.nodes[id]; if(!n) return;
    hideBubble();
    npFor = id;
    el.npUrl.value = n.url || "";
    el.npNote.value = n.note || "";
    el.np.hidden = false;
    var r = anchorRect(id);
    if(r){
      var w = el.np.offsetWidth, h = el.np.offsetHeight;
      el.np.style.left = clamp(r.cx, w/2 + 10, r.sw - w/2 - 10) + "px";
      el.np.style.top = (r.below + h + 10 > r.sh ? Math.max(10, r.above - h) : r.below) + "px";
    }
    (field === "note" ? el.npNote : el.npUrl).focus();
    (field === "note" ? el.npNote : el.npUrl).select();
  }
  function closeProps(){ el.np.hidden = true; npFor = null; }
  function applyProps(){
    var id = npFor; if(!id) return;
    var m = S.work[S.cur]; var n = m && m.nodes[id];
    if(!n){ closeProps(); return; }
    var raw = el.npUrl.value.trim(), url = safeUrl(raw), note = el.npNote.value.trim();
    if(raw && !url){ toast("網址看起來不對，只接受 http:// 或 https:// 開頭的連結"); el.npUrl.focus(); return; }
    var before = (n.url||"") + " " + (n.note||"");
    if(url) n.url = url; else delete n.url;
    if(note) n.note = note; else delete n.note;
    if(before !== (n.url||"") + " " + (n.note||"")) markDirty();
    closeProps(); render();
  }
  function showBubble(id){
    var m = S.work[S.cur]; var n = m && m.nodes[id];
    if(!n || !n.note){ hideBubble(); return; }
    closeProps();
    el.bubble.textContent = n.note;
    el.bubble.hidden = false;
    var r = anchorRect(id);
    if(r){
      var w = el.bubble.offsetWidth, h = el.bubble.offsetHeight;
      el.bubble.style.left = clamp(r.cx, w/2 + 10, r.sw - w/2 - 10) + "px";
      el.bubble.style.top = (r.below + h + 10 > r.sh ? Math.max(10, r.above - h) : r.below) + "px";
    }
  }
  function hideBubble(){ el.bubble.hidden = true; }

  /* ================= 搜尋 ================= */
  function centerOn(id){
    var p = S.pos[id]; if(!p) return;
    S.view.x = el.stage.clientWidth/2 - (p.x + p.w/2) * S.view.k;
    S.view.y = el.stage.clientHeight/2 - (p.y + p.h/2) * S.view.k;
    applyView();
  }
  function renderSearch(){
    var on = !!S.q, has = S.hits.length;
    if(S.hitIdx >= has) S.hitIdx = 0;
    el.q.disabled = !S.work[S.cur];
    el.qClear.hidden = !on;
    el.qPrev.hidden = el.qNext.hidden = !(on && has > 1);
    el.qn.hidden = !on;
    if(on){
      el.qn.textContent = has ? (S.hitIdx + 1) + " / " + has : "沒有符合";
      el.qn.className = "qn" + (has ? "" : " none");
      if(has){
        var cue = S.hits[S.hitIdx];
        Array.prototype.forEach.call(el.nodes.children, function(b){
          b.classList.toggle("cue", b.dataset.id === cue);
        });
      }
    }
  }
  function runSearch(raw){
    var q = (raw || "").trim().toLowerCase();
    if(q === S.q) return;
    S.q = q; S.hitIdx = 0;
    render();
  }
  function step(d){
    if(!S.hits.length) return;
    S.hitIdx = (S.hitIdx + d + S.hits.length) % S.hits.length;
    renderSearch();
    centerOn(S.hits[S.hitIdx]);
  }
  function clearSearch(focus){
    el.q.value = ""; S.q = ""; S.hitIdx = 0; render();
    if(focus) el.q.focus();
  }

  /* ================= chrome ================= */
  function listRows(){
    var seen = {}, rows = [];
    S.order.forEach(function(id){ if(S.work[id]){ seen[id]=1; rows.push(id); } });
    Object.keys(S.work).forEach(function(id){ if(!seen[id]) rows.push(id); });
    return rows;
  }
  function renderList(){
    var rows = listRows();
    el.maplist.textContent = "";
    el.railCount.textContent = rows.length ? "我的心智圖 · " + rows.length : "我的心智圖";
    if(!rows.length){
      var d = document.createElement("div");
      d.className = "empty-rail";
      d.textContent = "清單是空的。按「＋ 新增」開始第一張心智圖。";
      el.maplist.appendChild(d);
      return;
    }
    rows.forEach(function(id){
      var m = S.work[id];
      var li = document.createElement("li");
      if(id === S.cur) li.className = "on";
      var pick = document.createElement("button");
      pick.className = "pick"; pick.textContent = m.title || "未命名心智圖";
      pick.onclick = function(){ open(id); };
      li.appendChild(pick);
      if(S.dirty[id]){ var p=document.createElement("i"); p.className="pip"; p.title="有未儲存的變更"; li.appendChild(p); }
      var c = document.createElement("span"); c.className="cnt"; c.textContent = nodeCount(m); li.appendChild(c);
      var kill = document.createElement("button");
      kill.className="kill"; kill.textContent="\u00d7"; kill.title="刪除這張心智圖";
      kill.onclick = function(e){ e.stopPropagation(); dropMap(id); };
      li.appendChild(kill);
      el.maplist.appendChild(li);
    });
  }
  function when(ts){
    var d = new Date(ts), n = new Date();
    var hm = String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
    if(d.toDateString() === n.toDateString()) return hm;
    return (d.getMonth()+1) + "/" + d.getDate() + " " + hm;
  }
  function renderTop(){
    var m = S.work[S.cur];
    el.titleIn.disabled = !m; el.btnFit.disabled = !m;
    if(!m){ el.titleIn.value=""; el.metaTxt.textContent=""; el.btnSave.disabled=true; el.btnSave.textContent="已儲存"; return; }
    if(document.activeElement !== el.titleIn) el.titleIn.value = m.title || "";
    var saved = S.remote[S.cur];
    el.metaTxt.textContent = nodeCount(m) + " 個節點"
      + (saved && saved.updatedAt ? " · 存檔於 " + when(saved.updatedAt) : (S.fresh[S.cur] ? " · 尚未存檔" : ""));
    if(S.saving){ el.btnSave.disabled = true; el.btnSave.textContent = "儲存中…"; }
    else if(S.dirty[S.cur]){ el.btnSave.disabled = false; el.btnSave.textContent = "儲存變更"; }
    else { el.btnSave.disabled = true; el.btnSave.textContent = "已儲存"; }
  }
  function render(){
    el.blank.hidden = !!S.work[S.cur];
    hideBubble();
    if(!S.editing) renderNodes();
    layout(); renderList(); renderTop(); placeToolbar(); renderSearch();
  }
  function open(id){
    if(S.editing) commit(true);
    S.cur = id; S.sel = S.work[id] ? S.work[id].rootId : null;
    render(); fit();
  }

  /* ================= persistence ================= */
  function docBody(m){
    return { id: m.id, title: m.title || "未命名心智圖", rootId: m.rootId, nodes: m.nodes,
             createdAt: m.createdAt || Date.now(), updatedAt: Date.now(), nodeCount: nodeCount(m) };
  }
  function save(){
    var m = S.work[S.cur]; if(!m || S.saving) return;
    if(S.editing) commit(true);
    S.saving = true; renderTop();
    var body = docBody(S.work[S.cur]), id = m.id;
    Store.save(body).then(function(){
      S.saving = false; delete S.dirty[id]; delete S.fresh[id];
      S.remote[id] = body;
      if(S.order.indexOf(id) < 0) S.order.push(id);
      renderList(); renderTop(); toast("已存檔：" + body.title);
    }, function(e){
      S.saving = false; renderTop();
      toast("存檔失敗：" + (e && e.message ? e.message : "未知錯誤"));
    });
  }
  function dropMap(id){
    var m = S.work[id]; if(!m) return;
    if(!confirm("刪除心智圖「" + (m.title||"未命名") + "」？這個動作無法復原。")) return;
    var wasCur = (id === S.cur), fresh = S.fresh[id];
    delete S.work[id]; delete S.dirty[id]; delete S.remote[id]; delete S.fresh[id];
    S.order = S.order.filter(function(x){ return x !== id; });
    if(wasCur){ var rows = listRows(); S.cur = rows[0] || null; S.sel = S.cur ? S.work[S.cur].rootId : null; }
    render(); if(S.cur) fit();
    if(!fresh) Store.remove(id).then(null, function(e){ toast("刪除沒有同步成功：" + (e.message||"")); });
  }
  function create(){
    var m = newMap();
    S.work[m.id] = m; S.dirty[m.id] = true; S.fresh[m.id] = true;
    S.cur = m.id; S.sel = m.rootId;
    render(); fit();
    toast("新的心智圖已建立，記得按「儲存變更」存檔");
  }

  function refresh(first){
    return Store.list().then(function(rows){
      var ids = [];
      rows.forEach(function(d){
        ids.push(d.id);
        S.remote[d.id] = d;
        if(!S.dirty[d.id]){
          S.work[d.id] = { id:d.id, title:d.title, rootId:d.rootId, nodes:clone(d.nodes), createdAt:d.createdAt };
        }
      });
      Object.keys(S.work).forEach(function(id){
        if(ids.indexOf(id) < 0 && !S.fresh[id] && !S.dirty[id]) delete S.work[id];
      });
      S.order = ids;
      if(!S.work[S.cur]) S.cur = listRows()[0] || null;
      if(S.cur && !S.sel) S.sel = S.work[S.cur].rootId;
      render();
      if(first && S.cur) fit();
      el.led.className = "led live";
      el.ledText.textContent = Store.cloud ? "雲端存檔 · 已連線" : "本機存檔（這台瀏覽器）";
    }, function(e){
      el.led.className = "led off"; el.ledText.textContent = "連不上資料庫";
      notice("讀不到雲端資料（" + (e && e.message ? e.message : "未知錯誤") + "）。網路恢復後重新整理即可；在那之前新增的內容請先別關掉分頁。", true);
      render();
    });
  }

  /* ================= events ================= */
  el.btnNew.onclick = create; el.btnNew2.onclick = create;
  el.btnSave.onclick = save;
  el.btnFit.onclick = fit;
  el.zIn.onclick = function(){ zoomAt(el.stage.clientWidth/2, el.stage.clientHeight/2, 1.2); };
  el.zOut.onclick = function(){ zoomAt(el.stage.clientWidth/2, el.stage.clientHeight/2, 1/1.2); };
  el.zReset.onclick = function(){
    S.view.k = 1;
    S.view.x = el.stage.clientWidth/2 - ORX;
    S.view.y = el.stage.clientHeight/2 - ORY;
    applyView();
  };

  var qT = 0;
  el.q.addEventListener("input", function(){
    clearTimeout(qT);
    var v = el.q.value;
    qT = setTimeout(function(){ runSearch(v); }, 130);
  });
  el.q.addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); clearTimeout(qT); runSearch(el.q.value); step(e.shiftKey ? -1 : 1); }
    else if(e.key === "Escape"){ e.preventDefault(); clearSearch(true); }
  });
  el.qPrev.onclick = function(){ step(-1); };
  el.qNext.onclick = function(){ step(1); };
  el.qClear.onclick = function(){ clearSearch(true); };

  el.titleIn.addEventListener("input", function(){
    var m = S.work[S.cur]; if(!m) return;
    m.title = el.titleIn.value; markDirty();
  });
  el.titleIn.addEventListener("keydown", function(e){ if(e.key === "Enter") el.titleIn.blur(); });

  el.tb.addEventListener("click", function(e){
    var b = e.target.closest("button[data-act]"); if(!b || b.disabled) return;
    var act = b.dataset.act, id = S.sel; if(!id) return;
    if(act === "child") addNode(id);
    else if(act === "sib") addSibling(id);
    else if(act === "rename") edit(id, true);
    else if(act === "link") openProps(id, "url");
    else if(act === "note") openProps(id, "note");
    else if(act === "del") delNode(id);
  });

  el.npOk.onclick = applyProps;
  el.npCancel.onclick = closeProps;
  el.np.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ e.stopPropagation(); closeProps(); }
    else if(e.key === "Enter" && (e.target === el.npUrl || e.metaKey || e.ctrlKey)){ e.preventDefault(); applyProps(); }
  });
  el.bubble.addEventListener("click", hideBubble);

  el.nodes.addEventListener("click", function(e){
    var nb = e.target.closest(".ic.note");
    if(nb){
      e.preventDefault(); e.stopPropagation();
      var host = nb.closest(".node");
      if(!el.bubble.hidden && el.bubble.dataset.id === host.dataset.id){ hideBubble(); return; }
      el.bubble.dataset.id = host.dataset.id;
      showBubble(host.dataset.id);
      return;
    }
    if(e.target.closest(".ic.link")) e.stopPropagation();
  });

  el.nodes.addEventListener("mousedown", function(e){
    if(e.target.closest(".ic")) { e.stopPropagation(); return; }
    var n = e.target.closest(".node"); if(!n) return;
    if(S.editing === n.dataset.id) return;
    e.stopPropagation();
    hideBubble(); if(npFor && npFor !== n.dataset.id) closeProps();
    if(S.editing) commit(false);
    S.sel = n.dataset.id;
    Array.prototype.forEach.call(el.nodes.children, function(b){ b.classList.toggle("sel", b.dataset.id === S.sel); });
    placeToolbar();
  });
  el.nodes.addEventListener("dblclick", function(e){
    var n = e.target.closest(".node"); if(!n) return;
    S.sel = n.dataset.id; edit(n.dataset.id, true);
  });
  el.nodes.addEventListener("keydown", function(e){
    if(!S.editing) return;
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); commit(false); }
    else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); commit(false); }
    else if(e.key === "Tab"){ e.preventDefault(); e.stopPropagation(); var p=S.editing; commit(true); render(); addNode(p); }
  });
  el.nodes.addEventListener("blur", function(e){
    if(S.editing && e.target.classList && e.target.classList.contains("node")) commit(false);
  }, true);
  el.nodes.addEventListener("paste", function(e){
    if(!S.editing) return;
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData("text") || "";
    document.execCommand("insertText", false, t.replace(/\s+/g," ").trim());
  });

  document.addEventListener("keydown", function(e){
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")){ e.preventDefault(); save(); return; }
    if((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F") && S.work[S.cur]){
      e.preventDefault(); el.q.focus(); el.q.select(); return;
    }
    if(typing) return;
    if(e.key === "Escape" && (!el.np.hidden || !el.bubble.hidden)){ hideBubble(); closeProps(); return; }
    if(!S.work[S.cur] || !S.sel) return;
    if((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")){ e.preventDefault(); openProps(S.sel, "url"); return; }
    if(e.key === "Tab"){ e.preventDefault(); addNode(S.sel); }
    else if(e.key === "Enter"){ e.preventDefault(); addSibling(S.sel); }
    else if(e.key === "F2"){ e.preventDefault(); edit(S.sel, true); }
    else if(e.key === "Delete" || e.key === "Backspace"){ e.preventDefault(); delNode(S.sel); }
    else if(e.key === "Escape"){ S.sel = null; render(); }
  });

  var pan = null;
  el.stage.addEventListener("mousedown", function(e){
    if(e.target.closest(".node") || e.target.closest(".tb") || e.target.closest(".zoom")
       || e.target.closest(".blank") || e.target.closest(".np") || e.target.closest(".bubble")) return;
    if(S.editing) commit(false);
    hideBubble(); closeProps();
    pan = { sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
    el.stage.classList.add("drag");
  });
  window.addEventListener("mousemove", function(e){
    if(!pan) return;
    S.view.x = pan.vx + (e.clientX - pan.sx);
    S.view.y = pan.vy + (e.clientY - pan.sy);
    applyView();
  });
  window.addEventListener("mouseup", function(){ pan = null; el.stage.classList.remove("drag"); });
  el.stage.addEventListener("wheel", function(e){
    e.preventDefault();
    var r = el.stage.getBoundingClientRect();
    var f = Math.pow(0.9988, e.deltaY * (e.deltaMode === 1 ? 18 : 1));
    zoomAt(e.clientX - r.left, e.clientY - r.top, clamp(f, 0.8, 1.25));
  }, {passive:false});

  var tp = null;
  function dist(t){ return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }
  el.stage.addEventListener("touchstart", function(e){
    if(e.target.closest(".node") || e.target.closest(".tb") || e.target.closest(".zoom")) return;
    if(e.touches.length === 1) tp = {mode:"pan", sx:e.touches[0].clientX, sy:e.touches[0].clientY, vx:S.view.x, vy:S.view.y};
    else if(e.touches.length === 2) tp = {mode:"pinch", d:dist(e.touches), k:S.view.k};
  }, {passive:true});
  el.stage.addEventListener("touchmove", function(e){
    if(!tp) return;
    if(tp.mode === "pan" && e.touches.length === 1){
      S.view.x = tp.vx + (e.touches[0].clientX - tp.sx);
      S.view.y = tp.vy + (e.touches[0].clientY - tp.sy);
      applyView();
    } else if(tp.mode === "pinch" && e.touches.length === 2){
      var r = el.stage.getBoundingClientRect();
      var cx = (e.touches[0].clientX + e.touches[1].clientX)/2 - r.left;
      var cy = (e.touches[0].clientY + e.touches[1].clientY)/2 - r.top;
      var want = clamp(tp.k * (dist(e.touches)/tp.d), 0.3, 2.4);
      zoomAt(cx, cy, want/S.view.k);
    }
  }, {passive:true});
  el.stage.addEventListener("touchend", function(){ tp = null; }, {passive:true});

  window.addEventListener("resize", placeToolbar);
  window.addEventListener("beforeunload", function(e){
    if(Object.keys(S.dirty).length){ e.preventDefault(); e.returnValue = ""; }
  });
  if(Store.cloud){
    window.addEventListener("focus", function(){ if(!Object.keys(S.dirty).length) refresh(false); });
  }

  /* ================= boot ================= */
  render();
  el.ledText.textContent = Store.cloud ? "連線中…" : "本機存檔（這台瀏覽器）";
  if(!Store.cloud){
    notice("這份是本機版：心智圖存在你這台電腦的瀏覽器裡（localStorage），換裝置或清除瀏覽資料就看不到了。");
  }
  refresh(true);
})();
