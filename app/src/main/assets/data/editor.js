/* ============================================================
   data/editor.js — 编辑 UI 层（管理员编辑 / 普通用户纠错 / 管理台）
   ------------------------------------------------------------
   角色：
     管理员（?admin=1 进入）  可直接编辑、新增、删除，并确认他人提交
     普通用户（默认）        只能提交纠错建议，等待管理员确认
   依赖：data/backend.js（AtlasBackend / AtlasPatch / AtlasTable）
   说明：本文件的“权限”只是流程约束（本地页面无法真正防篡改），
         部署服务器时把 backend.js 换成 HTTP 实现即可获得真权限。
   ============================================================ */
(function () {
  'use strict';

  if (!window.AtlasBackend || !window.AtlasPatch) return;
  var B = window.AtlasBackend, P = window.AtlasPatch, T = window.AtlasTable;

  /* ============================================================
     0. 基础工具
     ============================================================ */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('data-') === 0 || k === 'type' || k === 'value' || k === 'placeholder' ||
               k === 'rows' || k === 'title' || k === 'accept' || k === 'href' || k === 'download') n.setAttribute(k, attrs[k]);
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function getPath(o, path) {
    var ps = path.split('.'), v = o;
    for (var i = 0; i < ps.length; i++) { if (v == null) return undefined; v = v[ps[i]]; }
    return v;
  }
  function setPath(o, path, val) {
    var ps = path.split('.'), v = o;
    for (var i = 0; i < ps.length - 1; i++) { if (v[ps[i]] == null) v[ps[i]] = {}; v = v[ps[i]]; }
    v[ps[ps.length - 1]] = val;
  }
  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ''); }
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
  }
  function isAdmin() { return B.isAdmin(); }

  /* ---------- 提示条 ---------- */
  var toastBox = null;
  function toast(msg, kind, ms) {
    if (!toastBox) { toastBox = el('div', { class: 'ed-toasts' }); document.getElementById('stage').appendChild(toastBox); }
    var t = el('div', { class: 'ed-toast ' + (kind || 'info'), html: msg });
    toastBox.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, (ms || 2600));
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, (ms || 2600) + 400);
  }

  /* ---------- 样式 ---------- */
  function injectCSS() {
    var css = ''
    + '.ed-panel{position:absolute;left:12px;top:60px;bottom:12px;width:470px;z-index:34;background:linear-gradient(180deg,#2a1c0e,#1a1208);border:1px solid #a87b3a;border-radius:4px;box-shadow:0 6px 26px rgba(0,0,0,.55);display:flex;flex-direction:column;color:#efe0c0;font-family:"Noto Serif SC",serif;font-size:13px;}'
    + '.ed-panel-hd{padding:10px 14px;border-bottom:1px solid #5a3a1c;display:flex;align-items:center;gap:8px;}'
    + '.ed-panel-hd .t{font-family:"Ma Shan Zheng",serif;font-size:18px;color:#f3d896;flex:1;}'
    + '.ed-panel-bd{flex:1;overflow-y:auto;padding:12px 14px;}'
    + '.ed-panel-ft{padding:10px 14px;border-top:1px solid #5a3a1c;display:flex;gap:8px;flex-wrap:wrap;}'
    + '.ed-x{cursor:pointer;color:#c9a874;font-size:20px;line-height:1;background:none;border:none;}'
    + '.ed-row{margin-bottom:9px;}'
    + '.ed-row label{display:block;color:#c9a874;font-size:11px;margin-bottom:3px;}'
    + '.ed-row input[type=text],.ed-row input[type=number],.ed-row textarea,.ed-row select{width:100%;box-sizing:border-box;background:rgba(255,248,232,.06);border:1px solid #5a3a1c;border-radius:3px;color:#efe0c0;padding:5px 7px;font-family:inherit;font-size:13px;}'
    + '.ed-row textarea{min-height:80px;line-height:1.6;resize:vertical;}'
    + '.ed-row .hint{color:#7a6a52;font-size:11px;margin-top:2px;}'
    + '.ed-2col{display:flex;gap:8px;}.ed-2col>*{flex:1;}'
    + '.ed-btn{cursor:pointer;background:rgba(168,123,58,.2);border:1px solid #a87b3a;color:#efe0c0;border-radius:3px;padding:5px 12px;font-family:inherit;font-size:12px;}'
    + '.ed-btn:hover{background:rgba(168,123,58,.42);}'
    + '.ed-btn.pri{background:#8c2a1f;border-color:#c05a4a;}'
    + '.ed-btn.pri:hover{background:#a83a2a;}'
    + '.ed-btn.mini{padding:2px 8px;font-size:11px;}'
    + '.ed-btn[disabled]{opacity:.45;cursor:not-allowed;}'
    + '.ed-tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;border:1px solid #a87b3a;color:#f3d896;}'
    + '.ed-tag.g{background:rgba(60,140,90,.3);border-color:#4a8a5a;}'
    + '.ed-tag.r{background:rgba(150,50,40,.3);border-color:#a84a3a;}'
    + '.ed-toasts{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:60;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;}'
    + '.ed-toast{background:rgba(28,18,8,.94);border:1px solid #a87b3a;color:#f3d896;padding:7px 16px;border-radius:4px;font-size:13px;font-family:"Noto Serif SC",serif;box-shadow:0 3px 12px rgba(0,0,0,.45);transition:opacity .3s;max-width:520px;}'
    + '.ed-toast.warn{border-color:#c9a02a;color:#ffd98a;}'
    + '.ed-toast.err{border-color:#c05a4a;color:#ffb0a0;}'
    + '.ed-toast.out{opacity:0;}'
    + '.ed-modal{position:absolute;inset:0;z-index:50;background:rgba(6,10,14,.62);display:flex;align-items:center;justify-content:center;}'
    + '.ed-modal .box{width:760px;max-width:94%;max-height:86%;background:linear-gradient(180deg,#2a1c0e,#1a1208);border:1px solid #a87b3a;border-radius:5px;display:flex;flex-direction:column;color:#efe0c0;font-family:"Noto Serif SC",serif;font-size:13px;box-shadow:0 10px 40px rgba(0,0,0,.6);}'
    + '.ed-modal .box.wide{width:900px;}'
    + '.ed-tabs{display:flex;gap:6px;border-bottom:1px solid #5a3a1c;padding:8px 12px 0;}'
    + '.ed-tab{cursor:pointer;padding:5px 12px;border:1px solid #5a3a1c;border-bottom:none;border-radius:3px 3px 0 0;color:#c9a874;font-size:12px;}'
    + '.ed-tab.on{background:rgba(168,123,58,.28);color:#f3d896;}'
    + '.ed-list{max-height:52vh;overflow-y:auto;}'
    + '.ed-item{border:1px solid #4a3018;border-radius:3px;padding:8px 10px;margin-bottom:7px;background:rgba(255,248,232,.04);}'
    + '.ed-item .hd{display:flex;align-items:center;gap:8px;margin-bottom:4px;}'
    + '.ed-item .hd .n{color:#f3d896;flex:1;}'
    + '.ed-diff{font-size:12px;line-height:1.75;margin:3px 0;color:#d8c8a0;}'
    + '.ed-diff .f{color:#9fb8d4;}'
    + '.ed-diff .b{color:#c98a7a;text-decoration:line-through;}'
    + '.ed-diff .a{color:#9fd4a8;}'
    + '.ed-sec{margin-bottom:14px;}'
    + '.ed-sec h4{color:#f3d896;font-family:"Ma Shan Zheng",serif;font-size:15px;margin:0 0 7px;font-weight:400;}'
    + '.ed-kv{color:#a89878;font-size:12px;line-height:1.8;}'
    + '.ed-children .ci{display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px dashed #3a2812;}'
    + '.ed-children .ci span{flex:1;}'
    + 'svg#map.picking{cursor:crosshair !important;}'
    + '.ed-poi-item{cursor:pointer;padding:5px 8px;margin:3px 0;background:rgba(232,160,80,.10);border-left:3px solid #e8a050;border-radius:3px;transition:background .15s;}'
    + '.ed-poi-item:hover{background:rgba(232,160,80,.26);}'
    + '.ed-poi-item.on{background:rgba(232,160,80,.34);border-left-color:#ffd98a;}'
    + '.ed-poi-item .pn{color:#ffd98a;font-size:13px;}'
    + '.ed-poi-item .pd{color:#b8a888;font-size:11.5px;line-height:1.6;margin-top:2px;}'
    + '.ed-poi-item .pc{color:#7a6a52;font-size:10.5px;margin-top:2px;}'
    + '.ed-badge{font-size:11px;padding:3px 9px;border-radius:9px;border:1px solid #a87b3a;color:#c9a874;}'
    + '.ed-badge.admin{background:rgba(140,42,31,.45);color:#f3d896;}'
    + '.ed-pubbar{display:flex;align-items:center;gap:9px;padding:9px 14px;font-size:12px;line-height:1.5;border-bottom:1px solid #5a3a1c;}'
    + '.ed-pubbar .m{flex:1;}'
    + '.ed-pubbar .m b{color:#ffd98a;}'
    + '.ed-pubbar.warn{background:rgba(168,123,58,.24);color:#f0dba6;}'
    + '.ed-pubbar.ok{background:rgba(80,140,90,.16);color:#b8d8b0;}'
    + '.ed-pubbar.mute{background:rgba(255,248,232,.04);color:#a89878;}'
    + '.ed-btn.sm{font-size:11.5px;padding:3px 10px;}';
    document.head.appendChild(el('style', { text: css }));
  }

  /* ============================================================
     1. 字段规格（编辑 / 纠错 共用）
     ============================================================ */
  var SPECS = {
    event: [
      ['name', '标题', 'text'],
      ['year', '年份', 'number', '负数=公元前；如 -221'],
      ['region', '地区', 'region'],
      ['era', '所属朝代', 'era'],
      ['importance', '重要度（1-5）', 'number'],
      ['lat', '纬度', 'number', '-90 ~ 90'],
      ['lng', '经度', 'number', '-180 ~ 180'],
      ['place', '地理位置', 'text', '省·城市，如「河南·洛阳」；地图标点用它命名'],
      ['icon', '图标', 'text', '留空=五角星 ★；可填 diamond/triangle/square/circle/cross/wye/asterisk，或图片 URL'],
      ['blurb', '一句话简介', 'text'],
      ['detail', '详情', 'textarea'],
      ['figures', '人物', 'text', '多人用「、」分隔'],
      ['video.bili', 'B站关键词', 'text'],
      ['video.yt', 'YouTube关键词', 'text']
    ],
    sub: [
      ['name', '标题', 'text'],
      ['year', '年份', 'number'],
      ['lat', '纬度', 'number'],
      ['lng', '经度', 'number'],
      ['place', '地理位置', 'text', '省·城市，如「河南·洛阳」；地图标点用它命名'],
      ['icon', '图标', 'text', '留空=星号 ＊；可填 star/diamond/triangle/square/circle/cross/wye，或图片 URL'],
      ['importance', '重要度（1-5）', 'number'],
      ['blurb', '一句话简介', 'text'],
      ['figures', '人物', 'text', '多人用「、」分隔']
    ],
    era: [
      ['name', '名称', 'text'],
      ['region', '地区', 'region'],
      ['start', '起始年', 'number', '负数=公元前'],
      ['end', '结束年', 'number'],
      ['chain', '文明链', 'chain', '外国轴分组（中国轴不参与）'],
      ['stages', '历史分期', 'text', '格式「名称:起~止; 名称:起~止」，如「初唐:618~713; 盛唐:713~755」；留空=用默认表/自动分期'],
      ['period', '大分期', 'text', '中国轴九大分期：先秦/秦汉/魏晋南北朝/隋唐/辽宋夏金/元/明/清/近现代；留空=按年代自动归属'],
      ['importance', '重要度（1-5）', 'number'],
      ['lat', '纬度', 'number'],
      ['lng', '经度', 'number'],
      ['place', '地理位置', 'text', '省·城市，如「陕西·西安」；地图标点用它命名'],
      ['l2Zoom', 'L2显示缩放（%）', 'number', '时间轴放大到此百分比时显示 L2 重要事件；默认 500'],
      ['l3Zoom', 'L3显示缩放（%）', 'number', '时间轴放大到此百分比时显示 L3 次要事件；默认 550'],
      ['blurb', '一句话简介', 'text'],
      ['detail', '详情', 'textarea', '点击朝代时在抽屉里展示（和事件一样）']
    ],
    poi: [
      ['name', '名称', 'text'],
      ['lat', '纬度', 'number'],
      ['lng', '经度', 'number'],
      ['desc', '说明', 'textarea']
    ]
  };
  var KIND_CN = { era: 'L1 朝代', event: 'L2 重要事件', sub: 'L3 次要事件', poi: '景点' };

  function fieldText(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
  }

  /* ============================================================
     2. 侧边表单面板（编辑 / 纠错 / 新增）
     ============================================================ */
  var panelNode = null, picker = null;

  function closePanel() {
    if (panelNode && panelNode.parentNode) panelNode.parentNode.removeChild(panelNode);
    panelNode = null; picker = null;
    window.__edOpen = null;
  }

  // mode: 'edit'(管理员) | 'correct'(用户纠错) | 'new'(管理员新增)
  function openForm(kind, obj, mode) {
    closePanel();
    var spec = SPECS[kind] || SPECS.event;
    var inputs = {};
    var titleOf = (mode === 'new' || mode === 'newChild') ? ('新增' + KIND_CN[kind])
      : (mode === 'correct' ? '纠错提交 · ' + KIND_CN[kind] : '编辑 · ' + KIND_CN[kind]);

    var body = el('div', { class: 'ed-panel-bd' });
    if (mode === 'correct') {
      body.appendChild(el('div', { class: 'ed-kv', html: '下面只填<b>需要修改</b>的字段，留空的字段不会被提交。<br>提交后由管理员确认，确认前不会改变页面内容。' }));
      body.appendChild(el('div', { style: 'height:8px' }));
      body.appendChild(el('div', { class: 'ed-row' }, [
        el('label', { text: '原内容（参考，不可改）' }),
        el('div', { class: 'ed-kv', text: fieldText(getPath(obj, 'name')) })
      ]));
    }

    spec.forEach(function (f) {
      var path = f[0], label = f[1], type = f[2], hint = f[3];
      var row = el('div', { class: 'ed-row' });
      row.appendChild(el('label', { text: label }));
      var input;
      var cur = getPath(obj, path);
      if (type === 'textarea') {
        input = el('textarea', { rows: 4 });
        input.value = fieldText(cur);
      } else if (type === 'region') {
        input = el('select');
        [['china', '中国'], ['foreign', '外国']].forEach(function (o) {
          var op = el('option', { value: o[0], text: o[1] });
          if ((cur || 'foreign') === o[0]) op.selected = true;
          input.appendChild(op);
        });
      } else if (type === 'era') {
        input = el('select');
        var opts = [['', '（未归属）']];
        ((typeof DATA !== 'undefined' && DATA.eras) || []).forEach(function (r) { opts.push([r.id, r.name + '（' + r.id + '）']); });
        opts.forEach(function (o) {
          var op = el('option', { value: o[0], text: o[1] });
          if ((cur || '') === o[0]) op.selected = true;
          input.appendChild(op);
        });
      } else if (type === 'chain') {
        input = el('select');
        var copts = [['', '（默认）']];
        var cl = (window.AtlasChains && AtlasChains.list) ? AtlasChains.list() : [];
        cl.forEach(function (c) { copts.push([c.id, c.name]); });
        copts.forEach(function (o) {
          var op = el('option', { value: o[0], text: o[1] });
          if ((cur || '') === o[0]) op.selected = true;
          input.appendChild(op);
        });
      } else if (type === 'number') {
        input = el('input', { type: 'number', value: (cur === null || cur === undefined) ? '' : cur });
      } else {
        input = el('input', { type: 'text', value: fieldText(cur) });
      }
      inputs[path] = { input: input, type: type };
      row.appendChild(input);
      if (hint) row.appendChild(el('div', { class: 'hint', text: hint }));
      if (path === 'lat' || path === 'lng') {
        row.appendChild(el('button', {
          class: 'ed-btn mini', type: 'button', text: '📍 地图取点',
          onclick: function () { startPick(path, inputs, inputs[path].input); }
        }));
      }
      body.appendChild(row);
    });

    // 子事件管理（事件表单内）
    if (kind === 'event') body.appendChild(childrenSection(obj));

    // 纠错理由
    var reasonInput = null;
    if (mode === 'correct') {
      reasonInput = el('textarea', { rows: 2, placeholder: '可补充依据/出处（可选）' });
      body.appendChild(el('div', { class: 'ed-row' }, [el('label', { text: '纠错理由' }), reasonInput]));
    }

    var ft = el('div', { class: 'ed-panel-ft' });
    var save = el('button', { class: 'ed-btn pri', text: mode === 'correct' ? '提交纠错' : '保存' });
    save.addEventListener('click', function () {
      var values = collect(inputs);
      if (mode === 'correct') doSubmitCorrection(kind, obj, values, reasonInput ? reasonInput.value : '');
      else doSave(kind, obj, values, mode === 'new');
    });
    ft.appendChild(save);
    ft.appendChild(el('button', { class: 'ed-btn', text: '取消', onclick: closePanel }));
    if (mode === 'edit' && obj && obj.__key) {
      ft.appendChild(el('button', {
        class: 'ed-btn', text: '🗑 删除此条',
        onclick: function () {
          if (!confirm('确定删除「' + fieldText(obj.name) + '」？\n（可在“管理台 → 本机修改”里撤销）')) return;
          var patch = B.loadPatch();
          patch.deleted[obj.__key] = 1;
          delete patch.records[obj.__key];
          B.savePatch(patch);
          refreshAll();
          closePanel();
          toast('已删除：' + fieldText(obj.name), 'warn');
        }
      }));
    }

    panelNode = el('div', { class: 'ed-panel' }, [
      el('div', { class: 'ed-panel-hd' }, [
        el('span', { class: 't', text: titleOf }),
        el('button', { class: 'ed-x', text: '×', onclick: closePanel })
      ]),
      body, ft
    ]);
    document.getElementById('stage').appendChild(panelNode);
    window.__edOpen = { kind: kind, mode: mode, close: closePanel };
    if (mode === 'correct') save.scrollIntoView && null;
  }

  function collect(inputs) {
    var out = {};
    Object.keys(inputs).forEach(function (path) {
      var it = inputs[path], v = it.input.value;
      if (it.type === 'number') out[path] = (String(v).trim() === '') ? null : Number(v);
      else if (path === 'figures') out[path] = String(v).trim() === '' ? [] : String(v).split(/[、,，;；\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      else out[path] = String(v);
    });
    return out;
  }

  // 子事件区块
  function childrenSection(obj) {
    var wrap = el('div', { class: 'ed-sec ed-children' });
    wrap.appendChild(el('h4', { text: '子事件' }));
    var kids = (obj && obj.children) || [];
    if (!kids.length) wrap.appendChild(el('div', { class: 'ed-kv', text: '（暂无子事件）' }));
    kids.forEach(function (c) {
      var row = el('div', { class: 'ci' }, [
        el('span', { text: '· ' + fieldText(c.name) + '（' + fieldText(c.year) + '）' }),
        el('button', { class: 'ed-btn mini', text: '编辑', type: 'button', onclick: function () { openForm('sub', c, 'edit'); } })
      ]);
      wrap.appendChild(row);
    });
    wrap.appendChild(el('div', { style: 'height:6px' }));
    wrap.appendChild(el('button', {
      class: 'ed-btn mini', text: '＋ 新增子事件', type: 'button',
      onclick: function () { openForm('sub', { __parentName: obj.name, name: '', year: 0, lat: 0, lng: 0, importance: 3, blurb: '', figures: [] }, 'newChild'); }
    }));
    return wrap;
  }

  /* ============================================================
     3. 保存（管理员）
     ============================================================ */
  function doSave(kind, obj, values, isNew) {
    var patch = B.loadPatch();
    var spec = SPECS[kind] || SPECS.event;
    if (isNew || !obj.__key) {
      // 新增：用标题生成稳定键
      var nm = String(values.name || '').trim();
      if (!nm) return toast('请先填写标题', 'err');
      var key;
      if (kind === 'event') key = P.KEYS.ev(nm);
      else if (kind === 'era') key = P.KEYS.er('e' + Date.now().toString(36));
      else if (kind === 'sub') key = P.KEYS.sub(obj.__parentName || '', nm);
      else key = P.KEYS.poi(obj.__parentName || '', nm);
      if (patch.records[key] && patch.records[key].__new) return toast('已存在同名条目：' + nm, 'err');
      if (kind === 'event' && P.getDATA().events.some(function (e) { return e.__key === key; })) {
        return toast('已存在同名事件「' + nm + '」，请换个标题', 'err', 4000);
      }
      // 表单里是扁平点号路径（如 video.bili），补丁里要写成嵌套结构
      var newRec = { __new: true };
      spec.forEach(function (f) {
        var path = f[0];
        if (!(path in values)) return;
        setPath(newRec, path, values[path]);
      });
      patch.records[key] = newRec;
      delete patch.deleted[key];
      B.savePatch(patch);
      refreshAll();
      closePanel();
      return toast('已新增：' + nm, 'info');
    }
    var key2 = obj.__key;
    var rec = patch.records[key2] || {};
    var changed = [];
    spec.forEach(function (f) {
      var path = f[0];
      if (!(path in values)) return;
      var nv = values[path], cur = getPath(obj, path);
      if (path === 'figures') {
        if ((cur || []).join('、') !== (nv || []).join('、')) { rec.figures = nv; changed.push('人物'); }
        return;
      }
      if (path === 'video.bili' || path === 'video.yt') {
        var sub = path.split('.')[1];
        var oldV = (obj.video && obj.video[sub]) || '';
        if (String(oldV) !== String(nv || '')) { rec.video = rec.video || {}; rec.video[sub] = nv; changed.push(f[1]); }
        return;
      }
      if (path === 'era') {
        if (String(cur || '') !== String(nv || '')) { rec.era = nv; changed.push(f[1]); }
        return;
      }
      var a = (cur === null || cur === undefined) ? '' : String(cur);
      var b = (nv === null || nv === undefined) ? '' : String(nv);
      if (a !== b) { rec[path] = nv; changed.push(f[1]); }
    });
    if (!changed.length) return toast('没有检测到改动', 'warn');
    // 标题改了要保留稳定键：记录里存新名字即可
    patch.records[key2] = rec;
    delete patch.deleted[key2];
    B.savePatch(patch);
    refreshAll();
    toast('已保存（' + changed.join('、') + '）<br>可在「管理台 → 本机修改」撤销', 'info', 3400);
  }

  /* ============================================================
     4. 纠错提交（普通用户）
     ============================================================ */
  function doSubmitCorrection(kind, obj, values, reason) {
    var spec = SPECS[kind] || SPECS.event;
    var changes = {}, before = {};
    spec.forEach(function (f) {
      var path = f[0];
      if (!(path in values)) return;
      var nv = values[path], cur = getPath(obj, path);
      var a = Array.isArray(cur) ? cur.join('、') : ((cur === null || cur === undefined) ? '' : String(cur));
      var b = Array.isArray(nv) ? nv.join('、') : ((nv === null || nv === undefined) ? '' : String(nv));
      if (path === 'video.bili' || path === 'video.yt') {
        var sub = path.split('.')[1];
        var o = (obj.video && obj.video[sub]) || '';
        if (String(o) !== String(nv || '')) { changes[path] = nv; before[path] = o; }
        return;
      }
      if (a !== b) { changes[path] = nv; before[path] = Array.isArray(cur) ? cur : cur; }
    });
    if (!Object.keys(changes).length) return toast('没有检测到需要提交的修改', 'warn');
    B.addSubmission({
      targetKey: obj.__key, kind: kind,
      targetName: fieldText(obj.name),
      changes: changes, before: before, reason: reason || '',
      author: '本机访客'
    });
    closePanel();
    toast('已提交 ' + Object.keys(changes).length + ' 项修改建议<br>管理员在「管理台 → 待审提交」中确认后生效', 'info', 4200);
  }

  /* ============================================================
     5. 抽屉挂载动作按钮
     ============================================================ */
  function attachDrawerActions(d, type) {
    if (!d || typeof d !== 'object') return;
    var content = document.getElementById('drawer-content');
    if (!content) return;
    var kind = (type === 'era') ? 'era' : (String(d.__key || '').indexOf('sub:') === 0 ? 'sub' : 'event');
    var bar = el('div', { class: 'ed-sec', style: 'border-top:1px dashed #5a3a1c;margin-top:14px;padding-top:10px;' });
    if (isAdmin()) {
      bar.appendChild(el('button', { class: 'ed-btn pri', text: '✎ 编辑此条', onclick: function () { openForm(kind, d, 'edit'); } }));
      bar.appendChild(el('span', { style: 'width:8px;display:inline-block' }));
      bar.appendChild(el('button', { class: 'ed-btn', text: '🔗 景点', onclick: function () { openPoiManager(d); } }));
    } else {
      bar.appendChild(el('button', { class: 'ed-btn', text: '✎ 我要纠错', onclick: function () { openForm(kind, d, 'correct'); } }));
      bar.appendChild(el('div', { class: 'hint', text: '提交后由管理员确认，确认前不会改动页面内容。' }));
    }
    bar.appendChild(el('div', { class: 'ed-kv', style: 'margin-top:6px;', text: '稳定ID：' + (d.__key || '(无)') }));
    // 相关景点：清单插在操作按钮之前，操作按钮保持在最底部
    if (kind === 'event') {
      try { appendPoiSection(content, d); } catch (e) { console.warn('[editor] 景点展示失败', e); }
    }
    content.appendChild(bar);
  }

  /* ============================================================
     6. 景点管理（挂在事件下）
     ============================================================ */
  function openPoiManager(hostEvent) {
    var map = (typeof POI_MAP !== 'undefined' && POI_MAP) || {};
    var key = hostEvent.name;
    var list = map[key] || null;
    if (!list) {   // 允许事件名带/不带括号注记
      Object.keys(map).forEach(function (n) { if (P.norm(n) === P.norm(hostEvent.name)) list = map[n]; });
    }
    var body = el('div', { class: 'ed-panel-bd' });
    body.appendChild(el('div', { class: 'ed-kv', html: '景点数据（<b>注：当前页面尚未展示景点</b>，此处仅做数据维护）' }));
    body.appendChild(el('div', { style: 'height:8px' }));
    (list || []).forEach(function (p) {
      body.appendChild(el('div', { class: 'ed-item' }, [
        el('div', { class: 'hd' }, [
          el('span', { class: 'n', text: p.name }),
          el('span', { class: 'ed-kv', text: p.lat + ', ' + p.lng }),
          el('button', { class: 'ed-btn mini', text: '编辑', onclick: function () { p.__parentName = hostEvent.name; openForm('poi', p, 'edit'); } })
        ]),
        el('div', { class: 'ed-kv', text: p.desc || '' })
      ]));
    });
    if (!list || !list.length) body.appendChild(el('div', { class: 'ed-kv', text: '（该事件暂无景点条目）' }));
    body.appendChild(el('div', { style: 'height:8px' }));
    body.appendChild(el('button', {
      class: 'ed-btn mini', text: '＋ 新增景点',
      onclick: function () { openForm('poi', { __parentName: hostEvent.name, name: '', lat: 0, lng: 0, desc: '' }, 'new'); }
    }));
    closePanel();
    panelNode = el('div', { class: 'ed-panel' }, [
      el('div', { class: 'ed-panel-hd' }, [el('span', { class: 't', text: '景点 · ' + hostEvent.name }), el('button', { class: 'ed-x', text: '×', onclick: closePanel })]),
      body
    ]);
    document.getElementById('stage').appendChild(panelNode);
    if (list) list.forEach(function (p) { if (!p.__key) p.__key = P.KEYS.poi(hostEvent.name, p.name); });
  }

  /* ============================================================
     6.5 景点展示（抽屉列表，点击定位）——面向所有访问者
     地图上不再画景点标点，只在点击某条景点时放大定位过去。
     ============================================================ */

  // 按事件取景点：
  //   同一事件在基座与分片里可能各有一份景点数据（分片那份通常更全），这里合并去重；
  //   匹配用“稳定键里的原始父名”，所以事件改过名也照样能找到。
  function poisOf(ev) {
    var map = P.getPOI() || {};
    if (!ev || !ev.name) return [];
    var orig = (ev.__key && String(ev.__key).indexOf('ev:') === 0) ? String(ev.__key).slice(3) : '';
    var cur = P.norm(ev.name);
    var out = [], seen = {};
    Object.keys(map).forEach(function (k) {
      var nk = P.norm(k);
      if (nk !== orig && nk !== cur) return;
      (map[k] || []).forEach(function (p) {
        var pk = String(p.name || '');
        if (seen[pk]) return;
        seen[pk] = 1; out.push(p);
      });
    });
    return out;
  }

  // 抽屉里的景点清单（管理员与访客都可见）
  function appendPoiSection(content, ev) {
    var pois = poisOf(ev);
    if (!pois.length) return 0;
    var sec = el('div', { class: 'ed-sec', style: 'border-top:1px dashed #5a3a1c;margin-top:14px;padding-top:10px;' });
    sec.appendChild(el('div', { class: 'ed-kv', html: '<b style="color:#f3d896">相关景点（' + pois.length + '）</b>　<span style="color:#7a6a52">点击可在地图上定位</span>' }));
    pois.forEach(function (p) {
      var item = el('div', { class: 'ed-poi-item', title: '点击在地图上定位' }, [
        el('div', { class: 'pn', text: '◆ ' + p.name }),
        el('div', { class: 'pd', text: p.desc || '' }),
        el('div', { class: 'pc', text: '经度 ' + p.lng + ' · 纬度 ' + p.lat })
      ]);
      item.addEventListener('click', function () {
        try { window.focusMap(p.lat, p.lng, 5, p.name); } catch (e) {}
        var all = sec.querySelectorAll('.ed-poi-item');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
        item.classList.add('on');
      });
      sec.appendChild(item);
    });
    content.appendChild(sec);
    return pois.length;
  }

  /* ============================================================
     7. 地图取点
     ============================================================ */
  function startPick(path, inputs, input) {
    picker = { path: path, inputs: inputs };
    document.getElementById('map').classList.add('picking');
    toast('请在地图上点击目标位置（按 Esc 取消）', 'info', 4000);
  }
  function screenToLatLng(cx, cy) {
    var node = document.getElementById('map');
    var r = node.getBoundingClientRect();
    var mx = (cx - r.left) * (CFG.W / r.width);
    var my = (cy - r.top) * (CFG.H / r.height);
    var x = (mx - mapTransform.tx) / mapTransform.k;
    var y = (my - mapTransform.ty) / mapTransform.k;
    var ll = projection.invert([x, y]);
    if (!ll || isNaN(ll[0]) || isNaN(ll[1])) return null;
    if (Math.abs(ll[1]) > 89 || Math.abs(ll[0]) > 180) return null;
    return { lng: Number(ll[0].toFixed(4)), lat: Number(ll[1].toFixed(4)) };
  }
  function bindPicker() {
    var node = document.getElementById('map');
    node.addEventListener('click', function (ev) {
      if (!picker) return;
      ev.preventDefault(); ev.stopPropagation();
      var p = screenToLatLng(ev.clientX, ev.clientY);
      if (!p) { toast('这个位置取不到经纬度，换个点试试', 'warn'); return; }
      if (picker.inputs['lng']) picker.inputs['lng'].input.value = p.lng;
      if (picker.inputs['lat']) picker.inputs['lat'].input.value = p.lat;
      toast('已取点：经度 ' + p.lng + '，纬度 ' + p.lat, 'info');
      picker = null;
      node.classList.remove('picking');
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && picker) { picker = null; node.classList.remove('picking'); toast('已取消取点', 'warn'); }
    });
  }

  /* ============================================================
     8. 管理台
     ============================================================ */
  function openConsole() {
    var body = el('div', { class: 'ed-panel-bd', style: 'padding:0;' });
    var tabs = el('div', { class: 'ed-tabs' });
    var pane = el('div', { class: 'ed-list', style: 'padding:12px 14px;' });
    var pubBar = el('div', { class: 'ed-pubbar' });   // 顶部「是否已发布给所有人」状态条
    var box = el('div', { class: 'box wide' }, [
      el('div', { class: 'ed-panel-hd' }, [el('span', { class: 't', text: '⚙ 管理台' }), el('button', { class: 'ed-x', text: '×', onclick: function () { closeModal(); } })]),
      pubBar, tabs, pane
    ]);
    var modal = el('div', { class: 'ed-modal' }, [box]);
    var view = 'pending';

    /* 本机修改只对这台设备生效 —— 这里始终显示「是否已发布到 data/patch.js」 */
    function renderPub() {
      var s;
      try { s = B.publishStatus(); } catch (e) { return; }
      clear(pubBar);
      pubBar.className = 'ed-pubbar';
      if (s.pending > 0) {
        pubBar.className = 'ed-pubbar warn';
        pubBar.appendChild(el('span', { class: 'i', text: '📦' }));
        pubBar.appendChild(el('span', { class: 'm', html: '本机修改 <b>' + s.local + '</b> 项，其中 <b>' + s.pending + '</b> 项<b>尚未发布</b> —— 目前只有这台电脑的浏览器能看到' }));
        pubBar.appendChild(el('button', {
          class: 'ed-btn pri sm', text: '导出 patch.js 发布', onclick: function () {
            download('patch.js', B.exportPatchJS(), 'text/javascript');
            toast('已导出 patch.js<br>用它<b>覆盖项目里的 data/patch.js</b>，之后所有访问者都能看到这些修改', 'info', 6200);
            setTimeout(renderPub, 60);
          }
        }));
      } else if (s.local > 0) {
        pubBar.className = 'ed-pubbar ok';
        pubBar.appendChild(el('span', { class: 'i', text: '✅' }));
        pubBar.appendChild(el('span', { class: 'm', html: '本机修改 <b>' + s.local + '</b> 项，<b>已全部发布</b>（与 data/patch.js 一致，所有人可见）' }));
      } else {
        pubBar.className = 'ed-pubbar mute';
        pubBar.appendChild(el('span', { class: 'i', text: 'ℹ️' }));
        pubBar.appendChild(el('span', { class: 'm', text: '暂无本机修改。导入表格或编辑后，这里会提醒你是否已发布给所有人。' }));
      }
    }

    function tabBtn(id, label) {
      var b = el('div', { class: 'ed-tab' + (view === id ? ' on' : ''), text: label });
      b.addEventListener('click', function () { view = id; render(); });
      return b;
    }
    function render() {
      clear(tabs); clear(pane);
      renderPub();
      var pend = B.listSubmissions().filter(function (s) { return s.status === 'pending'; }).length;
      tabs.appendChild(tabBtn('pending', '待审提交' + (pend ? '（' + pend + '）' : '')));
      tabs.appendChild(tabBtn('local', '本机修改'));
      tabs.appendChild(tabBtn('io', '导入 / 导出'));
      if (view === 'pending') renderPending(pane, render);
      else if (view === 'local') renderLocal(pane, render);
      else renderIO(pane, render);
    }
    function closeModal() { if (modal.parentNode) modal.parentNode.removeChild(modal); window.__atlasRefreshPub = null; }
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.getElementById('stage').appendChild(modal);
    window.__atlasRefreshPub = renderPub;   // 供「导入 / 保存」后刷新顶部状态条
    render();
  }

  function pathLabel(p) {
    return ({ name: '标题', year: '年份', region: '地区', era: '所属朝代', importance: '重要度',
      lat: '纬度', lng: '经度', blurb: '一句话简介', detail: '详情', figures: '人物',
      'video.bili': 'B站关键词', 'video.yt': 'YouTube关键词', start: '起始年', end: '结束年', desc: '说明' })[p] || p;
  }
  function fmtVal(v) {
    if (Array.isArray(v)) return v.join('、');
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function renderPending(pane, refresh) {
    var subs = B.listSubmissions().filter(function (s) { return s.status === 'pending'; });
    if (!subs.length) { pane.appendChild(el('div', { class: 'ed-kv', text: '暂无待审提交。' })); return; }
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('button', {
        class: 'ed-btn pri', text: '全部采纳（' + subs.length + '）',
        onclick: function () {
          if (!confirm('将采纳全部 ' + subs.length + ' 条提交？')) return;
          subs.forEach(function (s) { acceptSubmission(s); });
          refreshAll(); refresh(); toast('已全部采纳', 'info');
        }
      }),
      el('span', { style: 'width:8px;display:inline-block' }),
      el('button', { class: 'ed-btn', text: '导出提交队列 JSON', onclick: function () { download('待审提交-' + stamp() + '.json', B.exportSubmissionsJSON(), 'application/json'); } })
    ]));
    subs.forEach(function (s) {
      var item = el('div', { class: 'ed-item' });
      item.appendChild(el('div', { class: 'hd' }, [
        el('span', { class: 'n', text: (KIND_CN[s.kind] || s.kind) + ' · ' + (s.targetName || s.targetKey) }),
        el('span', { class: 'ed-kv', text: new Date(s.submittedAt).toLocaleString() })
      ]));
      Object.keys(s.changes || {}).forEach(function (p) {
        item.appendChild(el('div', { class: 'ed-diff', html: '<span class="f">' + pathLabel(p) + '</span>：<span class="b">' + (fmtVal((s.before || {})[p]) || '（空）') + '</span> → <span class="a">' + (fmtVal(s.changes[p]) || '（空）') + '</span>' }));
      });
      if (s.reason) item.appendChild(el('div', { class: 'ed-kv', text: '理由：' + s.reason }));
      item.appendChild(el('div', { class: 'ed-kv', text: '稳定ID：' + s.targetKey }));
      item.appendChild(el('div', { style: 'margin-top:6px;' }, [
        el('button', {
          class: 'ed-btn pri mini', text: '采纳', onclick: function () {
            acceptSubmission(s); refreshAll(); refresh(); toast('已采纳并生效', 'info');
          }
        }),
        el('span', { style: 'width:6px;display:inline-block' }),
        el('button', {
          class: 'ed-btn mini', text: '驳回', onclick: function () {
            B.updateSubmission(s.id, { status: 'rejected', handledAt: new Date().toISOString() });
            refresh(); toast('已驳回', 'warn');
          }
        })
      ]));
      pane.appendChild(item);
    });
  }
  function acceptSubmission(s) {
    var patch = B.loadPatch();
    var rec = patch.records[s.targetKey] || {};
    Object.keys(s.changes || {}).forEach(function (p) {
      if (p === 'video.bili' || p === 'video.yt') {
        var sub = p.split('.')[1];
        rec.video = rec.video || {}; rec.video[sub] = s.changes[p];
      } else rec[p] = s.changes[p];
    });
    patch.records[s.targetKey] = rec;
    delete patch.deleted[s.targetKey];
    B.savePatch(patch);
    B.updateSubmission(s.id, { status: 'accepted', handledAt: new Date().toISOString() });
  }

  function renderLocal(pane, refresh) {
    var patch = B.loadPatch();
    var keys = Object.keys(patch.records || {});
    var dels = Object.keys(patch.deleted || {});
    pane.appendChild(el('div', { class: 'ed-kv', html: '本机共 <b>' + keys.length + '</b> 条字段修改、<b>' + dels.length + '</b> 条删除。' }));
    pane.appendChild(el('div', { style: 'height:8px' }));
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('button', { class: 'ed-btn', text: '＋ 新增事件', onclick: function () {
        openForm('event', { name: '', year: 0, region: 'foreign', era: '', importance: 3, lat: 0, lng: 0, blurb: '', detail: '', figures: [], video: {} }, 'new');
      } }),
      el('span', { style: 'width:8px;display:inline-block' }),
      el('button', { class: 'ed-btn', text: '＋ 新增朝代', onclick: function () {
        openForm('era', { name: '', region: 'china', start: 0, end: 0, importance: 3, lat: 0, lng: 0, place: '', blurb: '', detail: '' }, 'new');
      } })
    ]));
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('button', { class: 'ed-btn pri', text: '导出 patch.js（让所有人看到）', onclick: function () { download('patch-' + stamp() + '.js', B.exportPatchJS(), 'text/javascript;charset=utf-8'); toast('已导出，覆盖到 data/patch.js 即可全站生效', 'info', 4000); } }),
      el('span', { style: 'width:8px;display:inline-block' }),
      el('button', { class: 'ed-btn', text: '导入 patch.js', onclick: function () { pickFile('.js,text/javascript', function (txt) { var p = B.importPatchJS(txt); B.savePatch(p); refreshAll(); refresh(); toast('已导入补丁', 'info'); }); } }),
      el('span', { style: 'width:8px;display:inline-block' }),
      el('button', {
        class: 'ed-btn', text: '清空本机修改', onclick: function () {
          if (!confirm('清空本机全部修改与删除标记？\n（页面会立即回到原始数据，此操作不可撤销）')) return;
          B.clearLocalPatch(); refreshAll(); refresh(); toast('已回到原始数据', 'warn');
        }
      })
    ]));
    if (!keys.length && !dels.length) { pane.appendChild(el('div', { class: 'ed-kv', text: '（还没有本机修改）' })); return; }
    keys.forEach(function (k) {
      var rec = patch.records[k];
      var item = el('div', { class: 'ed-item' });
      item.appendChild(el('div', { class: 'hd' }, [
        el('span', { class: 'n', text: (rec.__new ? '【新增】' : '') + (rec.name || k) }),
        el('span', { class: 'ed-kv', text: k })
      ]));
      Object.keys(rec).forEach(function (f) {
        if (f === '__new' || f === 'name') return;
        var v = rec[f];
        if (f === 'video') { v = 'B站：' + ((v && v.bili) || '') + ' / YT：' + ((v && v.yt) || ''); }
        item.appendChild(el('div', { class: 'ed-diff', html: '<span class="f">' + pathLabel(f) + '</span> → <span class="a">' + (fmtVal(v) || '（空）') + '</span>' }));
      });
      item.appendChild(el('div', { style: 'margin-top:6px;' }, [
        el('button', {
          class: 'ed-btn mini', text: '撤销此条', onclick: function () {
            var p2 = B.loadPatch(); delete p2.records[k]; B.savePatch(p2); refreshAll(); refresh(); toast('已撤销', 'warn');
          }
        })
      ]));
      pane.appendChild(item);
    });
    dels.forEach(function (k) {
      pane.appendChild(el('div', { class: 'ed-item' }, [
        el('div', { class: 'hd' }, [el('span', { class: 'n', text: '【已删除】' + k })]),
        el('div', { style: 'margin-top:6px;' }, [
          el('button', {
            class: 'ed-btn mini', text: '恢复', onclick: function () {
              var p2 = B.loadPatch(); delete p2.deleted[k]; B.savePatch(p2); refreshAll(); refresh(); toast('已恢复', 'info');
            }
          })
        ])
      ]));
    });
  }

  function renderIO(pane, refresh) {
    var incPoi = el('input', { type: 'checkbox' });

    /* --- 文明链多选（配合「按文明链导出」）--- */
    var chainBoxes = [];
    var chainWrap = el('div', { style: 'margin:6px 0 10px;line-height:2;padding:8px 10px;border:1px solid #5a3a1c;border-radius:4px;background:rgba(168,123,58,.10);' });
    var chainList = (window.__ATLAS_CHAINS && window.__ATLAS_CHAINS.list) || [];
    chainWrap.appendChild(el('label', { style: 'margin-right:12px;' }, [
      chainBoxes[0] = el('input', { type: 'checkbox', value: 'china' }),
      el('span', { text: ' 中国（参照轴）' })
    ]));
    chainList.forEach(function (c, i) {
      chainWrap.appendChild(el('label', { style: 'margin-right:12px;' }, [
        chainBoxes[i + 1] = el('input', { type: 'checkbox', value: c.id }),
        el('span', { text: ' ' + c.name })
      ]));
    });
    function pickedChains() {
      return chainBoxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    }
    function chainNameOf(id) {
      if (id === 'china') return '中国';
      for (var i = 0; i < chainList.length; i++) if (chainList[i].id === id) return chainList[i].name;
      return id;
    }
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('h4', { html: '① 导出为表格（Excel / CSV） <span style="font-size:11px;color:#8a7a5a;">· 支持按文明链导出</span>' }),
      el('div', { class: 'ed-kv', html: '导出的是 <b>UTF-8 CSV</b>，双击用 Excel 打开即可；改完<b>另存为 CSV 或 xlsx 都能导入</b>。<br>全部载入后约 <b>2547</b> 行（不含景点 563 行）。<br>新列：<b>事件层级</b> / <b>地理位置</b> / <b>图标</b>。' }),
      el('div', { style: 'margin:6px 0;' }, [incPoi, el('span', { class: 'ed-kv', text: ' 包含景点数据（约 2000 行，页面暂未展示，一般可不勾）' })]),
      el('div', { class: 'ed-kv', text: '按文明链导出（可多选；一个都不勾 = 用左边的「导出全部」）：' }),
      chainWrap,
      el('button', {
        class: 'ed-btn pri', text: '导出全部数据 CSV', onclick: function () {
          ensureAllLoaded(function () {
            var rows = P.buildExportRows(P.getDATA(), P.getPOI());
            if (!incPoi.checked) rows = rows.filter(function (r) { return r['类型'] !== '景点'; });
            var kc = {};
            rows.forEach(function (r) { kc[r['类型']] = (kc[r['类型']] || 0) + 1; });
            download('时空巧记数据-' + stamp() + '.csv', T.toCSV(rows), 'text/csv;charset=utf-8');
            toast('已导出 ' + rows.length + ' 行<br>朝代 ' + (kc['朝代'] || 0) + ' · 事件 ' + (kc['事件'] || 0) +
                  ' · 子事件 ' + (kc['子事件'] || 0) + ' · 景点 ' + (kc['景点'] || 0), 'info', 5600);
          });
        }
      }),
      el('button', {
        class: 'ed-btn', text: '按所选出 CSV', onclick: function () {
          var pick = pickedChains();
          if (!pick.length) { toast('先勾选至少一条文明链；若要全都导出，用左边的「导出全部数据」', 'warn', 4600); return; }
          ensureAllLoaded(function () {
            var rows = P.buildExportRows(P.getDATA(), P.getPOI(), pick);
            if (!incPoi.checked) rows = rows.filter(function (r) { return r['类型'] !== '景点'; });
            var kc = {};
            rows.forEach(function (r) { kc[r['类型']] = (kc[r['类型']] || 0) + 1; });
            download('时空巧记数据-筛选-' + stamp() + '.csv', T.toCSV(rows), 'text/csv;charset=utf-8');
            toast('已导出 ' + rows.length + ' 行（朝代 ' + (kc['朝代'] || 0) + ' · 事件 ' + (kc['事件'] || 0) +
                  ' · 子事件 ' + (kc['子事件'] || 0) + ' · 景点 ' + (kc['景点'] || 0) + '）<br>范围：' +
                  pick.map(chainNameOf).join('、'), 'info', 6200);
          });
        }
      })
    ]));
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('h4', { text: '② 从表格批量导入' }),
      el('div', { class: 'ed-kv', html: '支持 <b>.csv / .tsv / .xlsx</b>；中文编码（UTF-8 / GBK）自动识别。' +
        '导入前会先给你一份差异预览，确认后才生效。' }),
      el('div', { class: 'ed-kv', html: '· 改内容：直接改单元格<br>· 新增：把「稳定ID」列<b>留空</b>，填好类型与标题<br>· 删除：在「删除」列填 <b>是</b>' }),
      el('div', { style: 'margin-top:8px;' }, [
        el('button', {
          class: 'ed-btn pri', text: '选择表格文件…', onclick: function () {
            pickFile('.csv,.tsv,.xlsx,.txt', function (x, name) {
              var buf = (x instanceof ArrayBuffer) ? new Uint8Array(x) : x;
              // 先确保分片全部载入，否则分片里的事件会被误判成“稳定ID不存在”
              ensureAllLoaded(function () {
                T.parseTableBytes(buf, name).then(function (res) {
                  if (!res.rows.length) { toast('表格里没有读到数据行', 'err'); return; }
                  var diff = P.computeDiff(res.rows, P.getDATA(), P.getPOI());
                  openDiffPreview(res, diff, refresh);
                })['catch'](function (e) {
                  toast('读取失败：' + (e && e.message || e) + '<br>（若是 xlsx，可先另存为 CSV 再试）', 'err', 5200);
                });
              });
            }, true);
          }
        })
      ])
    ]));
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('h4', { text: '③ 提交队列（跨机器搬运）' }),
      el('div', { class: 'ed-kv', text: '普通用户在别的电脑上纠错后，可在“待审提交”里导出 JSON 发给你，你在这里导入。' }),
      el('div', { style: 'margin-top:6px;' }, [
        el('button', { class: 'ed-btn', text: '导出提交队列 JSON', onclick: function () { download('待审提交-' + stamp() + '.json', B.exportSubmissionsJSON(), 'application/json'); } }),
        el('span', { style: 'width:8px;display:inline-block' }),
        el('button', {
          class: 'ed-btn', text: '导入提交队列 JSON', onclick: function () {
            pickFile('.json,application/json', function (txt) {
              try {
                var r = B.importSubmissionsJSON(txt);
                refresh(); toast('导入完成：新增 ' + r.imported + ' 条，队列共 ' + r.total + ' 条', 'info', 4000);
              } catch (e) { toast('导入失败：' + e.message, 'err', 4600); }
            });
          }
        })
      ])
    ]));
    pane.appendChild(el('div', { class: 'ed-sec' }, [
      el('h4', { text: '④ 模式' }),
      el('div', { class: 'ed-kv', html: '当前为<b>管理员模式</b>（本机记住）。' }),
      el('div', { style: 'margin-top:6px;' }, [
        el('button', {
          class: 'ed-btn', text: '退出管理员模式', onclick: function () {
            B.setAdmin(false); toast('已退出管理员模式，刷新页面后生效', 'warn', 3600);
          }
        })
      ])
    ]));
  }

  /* ---------- 差异预览 ---------- */
  function openDiffPreview(res, diff, refresh) {
    var body = el('div', { class: 'ed-panel-bd' });
    body.appendChild(el('div', { class: 'ed-kv', html:
      '读到 <b>' + res.rows.length + '</b> 行数据：<br>' +
      '将<b>修改 ' + diff.updates.length + '</b> 条、' +
      '<b>新增 ' + diff.adds.length + '</b> 条、' +
      '<b>删除 ' + diff.deletes.length + '</b> 条，' +
      '未变化 ' + diff.unchanged + ' 条。' }));
    if (diff.errors.length) {
      body.appendChild(el('div', { class: 'ed-item', style: 'border-color:#a84a3a;margin-top:8px;' },
        [el('div', { class: 'hd' }, [el('span', { class: 'n', text: '⚠ ' + diff.errors.length + ' 行被忽略' })])]
          .concat(diff.errors.slice(0, 20).map(function (e) { return el('div', { class: 'ed-kv', text: e }); }))
          .concat(diff.errors.length > 20 ? [el('div', { class: 'ed-kv', text: '…其余 ' + (diff.errors.length - 20) + ' 条类似' })] : [])));
    }
    var shown = 0;
    function addGroup(title, arr, render1) {
      if (!arr.length) return;
      body.appendChild(el('h4', { text: title + '（' + arr.length + '）', style: 'color:#f3d896;margin:12px 0 6px;font-family:"Ma Shan Zheng",serif;font-weight:400;' }));
      arr.slice(0, 120).forEach(function (x) {
        if (shown > 300) return;
        shown++;
        body.appendChild(render1(x));
      });
    }
    addGroup('将修改', diff.updates, function (u) {
      var it = el('div', { class: 'ed-item' }, [el('div', { class: 'hd' }, [el('span', { class: 'n', text: (KIND_CN[u.kind] || u.kind) + ' · ' + u.title })])]);
      u.changes.forEach(function (c) {
        it.appendChild(el('div', { class: 'ed-diff', html: '<span class="f">' + c.field + '</span>：<span class="b">' + (fmtVal(c.before) || '（空）') + '</span> → <span class="a">' + (fmtVal(c.after) || '（空）') + '</span>' }));
      });
      return it;
    });
    addGroup('将新增', diff.adds, function (a) {
      return el('div', { class: 'ed-item' }, [
        el('div', { class: 'hd' }, [el('span', { class: 'n', text: '＋ ' + (KIND_CN[a.kind] || a.kind) + ' · ' + a.title })]),
        el('div', { class: 'ed-kv', text: '稳定ID：' + a.key })
      ]);
    });
    addGroup('将删除', diff.deletes, function (d) {
      return el('div', { class: 'ed-item', style: 'border-color:#a84a3a' }, [
        el('div', { class: 'hd' }, [el('span', { class: 'n', text: '🗑 ' + (KIND_CN[d.kind] || d.kind) + ' · ' + d.title })])
      ]);
    });

    var box = el('div', { class: 'box' }, [
      el('div', { class: 'ed-panel-hd' }, [el('span', { class: 't', text: '导入差异预览' }), el('button', { class: 'ed-x', text: '×', onclick: close })]),
      body,
      el('div', { class: 'ed-panel-ft' }, [
        el('button', {
          class: 'ed-btn pri', text: '确认导入（' + (diff.updates.length + diff.adds.length + diff.deletes.length) + ' 项）',
          onclick: function () {
            var patch = B.loadPatch();
            P.applyDiffToPatch(patch, diff);
            B.savePatch(patch);
            refreshAll();
            if (typeof window.__atlasRefreshPub === 'function') { try { window.__atlasRefreshPub(); } catch (e) {} }
            close(); refresh();
            toast('导入完成：修改 ' + diff.updates.length + '、新增 ' + diff.adds.length + '、删除 ' + diff.deletes.length, 'info', 4200);
          }
        }),
        el('button', { class: 'ed-btn', text: '取消', onclick: close })
      ])
    ]);
    var modal = el('div', { class: 'ed-modal' }, [box]);
    function close() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.getElementById('stage').appendChild(modal);
  }

  /* ---------- 文件选择 ---------- */
  // 分片是懒加载的：导出/导入前必须先把 10 个分片全部载入，
  // 否则只会拿到基座数据（导出会少一大半：300 行 vs 2547 行）
  var CHUNK_TOTAL = 10;   // 分片总数（与 data/loader.js 的 RANGES 对应）
  function ensureAllLoaded(cb) {
    var L = window.AtlasLoader;
    if (!L || typeof L.loadedCount !== 'function' || typeof L.loadAll !== 'function') { cb(); return; }
    if (L.loadedCount() >= CHUNK_TOTAL) { cb(); return; }
    toast('正在载入全部分片数据，请稍候…', 'info', 4000);
    Promise.resolve(L.loadAll()).then(function () {
      try { P.apply(); } catch (e) {}
      // 加载后校验：任一分片失败会被 loader 静默跳过，必须提示，避免导出不全却不知情
      var n = (typeof L.loadedCount === 'function') ? L.loadedCount() : CHUNK_TOTAL;
      if (n < CHUNK_TOTAL) {
        toast('注意：仅载入 ' + n + '/' + CHUNK_TOTAL + ' 个分片，导出的数据可能不全。<br>' +
              '请刷新页面重试；若反复失败，检查 data/chunk-*.js 是否都能访问。', 'warn', 7600);
      }
      cb();
    })['catch'](function () {
      toast('分片加载出错，导出的数据可能不全（请刷新重试）', 'warn', 7600);
      cb();
    });
  }

  function pickFile(accept, cb, asBuffer) {
    var inp = el('input', { type: 'file', accept: accept, style: 'display:none' });
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) { document.body.removeChild(inp); return; }
      var name = f.name;
      if (asBuffer) {
        f.arrayBuffer().then(function (buf) { cb(buf, name); document.body.removeChild(inp); })
          .catch(function (e) { toast('读取文件失败：' + e.message, 'err'); document.body.removeChild(inp); });
      } else {
        f.text().then(function (txt) { cb(txt, name); document.body.removeChild(inp); })
          .catch(function (e) { toast('读取文件失败：' + e.message, 'err'); document.body.removeChild(inp); });
      }
    });
    inp.click();
  }

  /* ============================================================
     9. 刷新
     ============================================================ */
  function renderTimeline() {
    try {
      // 2026-11-04：d3 缺失时（页面已由主脚本守卫给出提示）不要在这里重复刷错误
      if (typeof d3 === 'undefined') return;
      var t = (typeof currentTransform !== 'undefined' && currentTransform) ? currentTransform : d3.zoomIdentity;
      renderGrid(t); renderT1(t); renderT2(t); renderT3(t);
    } catch (e) { console.warn('[editor] 时间轴重绘失败', e); }
  }
  function refreshAll() {
    try { P.apply(); } catch (e) { console.warn(e); }
    // 朝代排序数组是 const：就地更新，让新增/改名/改起止年立即反映到时间轴
    try {
      var sorted = P.getDATA().eras.slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      if (typeof ERAS_SORTED !== 'undefined' && ERAS_SORTED) { ERAS_SORTED.length = 0; sorted.forEach(function (x) { ERAS_SORTED.push(x); }); }
    } catch (e) {}
    try { _eraColorMap = null; } catch (e) {}   // 新增朝代后要重建「朝代→配色」映射，否则新块是灰的
    renderTimeline();
  }
  window.onAtlasPatchApplied = renderTimeline;   // 分片加载完成后重绘

  /* ============================================================
     10. 启动
     ============================================================ */
  function init() {
    injectCSS();
    bindPicker();

    // 抽屉动作按钮
    if (typeof window.openDrawer === 'function') {
      var orig = window.openDrawer;
      window.openDrawer = function (d, type) {
        orig.apply(this, arguments);
        try {
          // 打开的是被文明链筛掉的时代 → 自动聚焦到它所在的链，否则用户看不到这个块
          if (type === 'era' && window.AtlasLanes && AtlasLanes.ensureVisible) AtlasLanes.ensureVisible(d);
          attachDrawerActions(d, type);
        } catch (e) { console.warn('[editor] 挂载抽屉按钮失败', e); }
      };
    }

    // 工具栏入口
    var tb = document.getElementById('toolbar');
    if (tb && isAdmin()) {
      // 只有管理员在工具栏露面；访客界面保持干净（纠错入口就在抽屉里）
      var badge = el('span', { class: 'ed-badge admin', text: '管理员模式' });
      badge.title = '当前可编辑并确认修改';
      tb.appendChild(badge);
      tb.appendChild(el('button', { class: 'ed-btn', text: '⚙ 管理台', onclick: openConsole }));
    }
    refreshAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 供 chains.js 等其他模块复用
  window.AtlasEditor = { toast: toast, refreshAll: refreshAll, openConsole: openConsole };

})();
