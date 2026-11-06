/* ============================================================
   data/backend.js — 数据修改层
   ------------------------------------------------------------
   职责：
     1) 稳定键 / 补丁应用（把“已确认的修改”覆盖到 DATA、POI_MAP 上）
     2) AtlasBackend：角色 + 存储适配器（本地用 localStorage，将来换服务器只需改这里）
     3) 提交队列（普通用户纠错 → 管理员审核）
     4) 表格读写：导出 CSV；导入 CSV / TSV / XLSX（自动识别编码与格式）
     5) 差异预览：导入前算出“将修改 / 新增 / 删除”各多少条

   本文件不依赖 DOM，可在 Node 中直接测试。
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     0. 基础工具
     ============================================================ */

  // 归一化：去掉括号注记（与 loader.js 的 _k 口径一致），用于生成稳定键
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[（(].*?[)）]/g, '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim();
  }
  function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  var KEYS = {
    ev:  function (name) { return 'ev:' + norm(name); },
    sub: function (parent, child) { return 'sub:' + norm(parent) + '/' + norm(child); },
    er:  function (id) { return 'er:' + String(id).trim(); },
    poi: function (parent, name) { return 'poi:' + norm(parent) + '/' + norm(name); },
    ce:  function (eraName, name) { return 'ce:' + norm(eraName) + '/' + norm(name); }
  };

  // 允许写入数据对象的字段白名单（防止脏字段被注入）
  var FIELDS = {
    event: ['name', 'year', 'region', 'era', 'place', 'lat', 'lng', 'icon', 'tier', 'importance', 'blurb', 'detail', 'figures', 'video', 'seq', 'seqN'],
    sub:   ['name', 'year', 'place', 'lat', 'lng', 'icon', 'importance', 'blurb', 'detail', 'figures', 'seq', 'seqN'],
    era:   ['name', 'region', 'start', 'end', 'place', 'lat', 'lng', 'icon', 'importance', 'blurb', 'chain', 'detail', 'l2Zoom', 'l3Zoom', 'stages', 'period', 'territory'],
    poi:   ['name', 'place', 'lat', 'lng', 'desc'],
    center:['name', 'faction', 'region', 'start', 'end', 'place', 'lat', 'lng', 'blurb']
  };
  var NUMERIC = { year: 1, lat: 1, lng: 1, importance: 1, start: 1, end: 1, l2Zoom: 1, l3Zoom: 1, tier: 1 };

  function coerce(field, value) {
    if (value === null || value === undefined) return value;
    if (field === 'figures') {
      if (Array.isArray(value)) return value.slice();
      var s = String(value).trim();
      return s === '' ? [] : s.split(/[、,，;；\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    if (field === 'video') {
      if (value && typeof value === 'object') return { bili: value.bili || '', yt: value.yt || '' };
      return { bili: String(value), yt: '' };
    }
    if (NUMERIC[field]) {
      // 兼容各种手写年份：「约-2070」「公元前221」「-202—公元8」「1911年10月10日」
      // 规则：取第一个数字；若标了「公元前 / 前 / BC」却写成正数，取负。
      var s = String(value).trim();
      if (s === '') return undefined;
      var m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return undefined;
      var n = Number(m[0]);
      if (isNaN(n)) return undefined;
      if (n > 0 && /公元前|前\s*\d|BC/i.test(s)) n = -n;
      return n;
    }
    return value;
  }

  // 只把白名单内的字段写进目标对象
  function assignFields(target, kind, rec) {
    var allow = FIELDS[kind] || [];
    allow.forEach(function (f) {
      if (!(f in rec)) return;
      if (rec[f] === undefined) return;
      var v = coerce(f, rec[f]);
      if (v === undefined) return;
      target[f] = v;
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }

  /* ============================================================
     1. 存储适配器（本地模式）
        将来部署服务器：把本段替换为 fetch 调用即可，上层 UI 不用动。
     ============================================================ */
  var LS = {
    patch: 'atlas.patch.local',
    role:  'atlas.role',
    subs:  'atlas.submissions'
  };
  var _mem = {};          // localStorage 不可用时的兜底
  var _lsOK = (function () {
    try {
      var k = '__atlas_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();
  function readRaw(k) {
    try { return _lsOK ? global.localStorage.getItem(k) : (_mem[k] || null); }
    catch (e) { return _mem[k] || null; }
  }
  function writeRaw(k, v) {
    try { if (_lsOK) { global.localStorage.setItem(k, v); return true; } } catch (e) {}
    _mem[k] = v; return false;
  }
  function removeRaw(k) {
    try { if (_lsOK) global.localStorage.removeItem(k); } catch (e) {}
    delete _mem[k];
  }
  function readJSON(k, dft) {
    var raw = readRaw(k);
    if (!raw) return dft;
    try { return JSON.parse(raw); } catch (e) { return dft; }
  }

  // DATA / POI_MAP 是主脚本里用 const 声明的“全局词法绑定”，不是 window 属性，
  // 所以必须用裸标识符取（typeof 守卫可同时兼容浏览器与 Node 测试环境）
  function getDATA() {
    try { if (typeof DATA !== 'undefined' && DATA) return DATA; } catch (e) {}
    return global.DATA || null;
  }
  function getPOI() {
    try { if (typeof POI_MAP !== 'undefined' && POI_MAP) return POI_MAP; } catch (e) {}
    return global.POI_MAP || null;
  }

  var AtlasBackend = {
    MODE: 'local',                 // 将来服务器模式改为 'server'
    storageAvailable: _lsOK,

    /* ---------- 角色 ---------- */
    // 本机方案：用 URL 参数切换并记住（?admin=1 进入管理员，?admin=0 退出）
    role: function () {
      try {
        var q = String(global.location && global.location.search || '');
        var m = /[?&]admin=([01])/.exec(q);
        if (m) {
          if (m[1] === '1') writeRaw(LS.role, 'admin');
          else removeRaw(LS.role);
        }
      } catch (e) {}
      return readRaw(LS.role) === 'admin' ? 'admin' : 'user';
    },
    isAdmin: function () { return this.role() === 'admin'; },
    setAdmin: function (on) { if (on) writeRaw(LS.role, 'admin'); else removeRaw(LS.role); },

    /* ---------- 补丁：文件补丁 + 本机补丁 合并（本机优先） ---------- */
    loadFilePatch: function () {
      var p = global.__ATLAS_PATCH;
      if (!p || typeof p !== 'object') return { version: 1, updatedAt: '', records: {}, deleted: {} };
      return {
        version: p.version || 1,
        updatedAt: p.updatedAt || '',
        records: p.records && typeof p.records === 'object' ? clone(p.records) : {},
        deleted: p.deleted && typeof p.deleted === 'object' ? clone(p.deleted) : {}
      };
    },
    loadLocalPatch: function () {
      var p = readJSON(LS.patch, null);
      if (!p || typeof p !== 'object') return { version: 1, updatedAt: '', records: {}, deleted: {} };
      return {
        version: p.version || 1,
        updatedAt: p.updatedAt || '',
        records: p.records && typeof p.records === 'object' ? p.records : {},
        deleted: p.deleted && typeof p.deleted === 'object' ? p.deleted : {}
      };
    },
    loadPatch: function () {
      var f = this.loadFilePatch(), l = this.loadLocalPatch();
      var out = { version: 1, updatedAt: l.updatedAt || f.updatedAt || '', records: {}, deleted: {} };
      Object.keys(f.records).forEach(function (k) { out.records[k] = f.records[k]; });
      Object.keys(l.records).forEach(function (k) { out.records[k] = l.records[k]; });
      Object.keys(f.deleted).forEach(function (k) { out.deleted[k] = 1; });
      Object.keys(l.deleted).forEach(function (k) { out.deleted[k] = 1; });
      return out;
    },
    savePatch: function (p) {
      p = p || { version: 1, records: {}, deleted: {} };
      p.version = p.version || 1;
      p.updatedAt = new Date().toISOString();
      return writeRaw(LS.patch, JSON.stringify(p));
    },
    clearLocalPatch: function () { removeRaw(LS.patch); },
    /* 本机修改 vs 已发布的 patch.js：pending = 本机有、文件里没有（或内容不同）的条目数 */
    publishStatus: function () {
      var f = this.loadFilePatch(), l = this.loadLocalPatch();
      var fk = {};
      Object.keys(f.records).forEach(function (k) { fk[k] = 'r:' + JSON.stringify(f.records[k]); });
      Object.keys(f.deleted).forEach(function (k) { fk[k] = 'd'; });
      var local = 0, pending = 0;
      Object.keys(l.records).forEach(function (k) {
        local++;
        if (fk[k] !== 'r:' + JSON.stringify(l.records[k])) pending++;
      });
      Object.keys(l.deleted).forEach(function (k) { local++; if (fk[k] !== 'd') pending++; });
      return { local: local, file: Object.keys(fk).length, pending: pending };
    },
    patchStats: function () {
      var p = this.loadPatch();
      var recs = Object.keys(p.records).length;
      var adds = Object.keys(p.records).filter(function (k) { return p.records[k].__new; }).length;
      return { records: recs, adds: adds, deleted: Object.keys(p.deleted).length };
    },

    /* ---------- 补丁文件导出 / 导入 ---------- */
    exportPatchJS: function (p) {
      p = p || this.loadPatch();
      var body = JSON.stringify(p, null, 2);
      return '/* 时空巧记 · 生效补丁  导出时间：' + new Date().toLocaleString() + '\n'
        + '   用法：覆盖 data/patch.js 即可让所有打开页面的人看到这些修改。\n'
        + '   回退：把 records / deleted 改回 {} 即恢复原始数据。 */\n'
        + 'window.__ATLAS_PATCH = ' + body + ';\n';
    },
    importPatchJS: function (text) {
      var m = String(text || '').match(/window\.__ATLAS_PATCH\s*=\s*([\s\S]*?);?\s*$/);
      var jsonText = m ? m[1] : String(text || '');
      jsonText = jsonText.replace(/;\s*$/, '');
      var obj;
      try { obj = JSON.parse(jsonText); }
      catch (e) {
        try { obj = (new Function('return (' + jsonText + ')'))(); }   // 容忍单引号等写法
        catch (e2) { throw new Error('补丁文件解析失败：不是合法的 patch 结构'); }
      }
      if (!obj || typeof obj !== 'object' || !obj.records) throw new Error('补丁文件缺少 records 字段');
      return obj;
    },

    /* ---------- 提交队列（纠错） ---------- */
    listSubmissions: function () { var a = readJSON(LS.subs, []); return Array.isArray(a) ? a : []; },
    addSubmission: function (s) {
      var all = this.listSubmissions();
      s = s || {};
      s.id = s.id || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      s.submittedAt = s.submittedAt || new Date().toISOString();
      s.status = s.status || 'pending';
      all.push(s);
      writeRaw(LS.subs, JSON.stringify(all));
      return s;
    },
    updateSubmission: function (id, patch) {
      var all = this.listSubmissions();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) { for (var k in patch) all[i][k] = patch[k]; break; }
      }
      writeRaw(LS.subs, JSON.stringify(all));
      return all;
    },
    removeSubmission: function (id) {
      var all = this.listSubmissions().filter(function (s) { return s.id !== id; });
      writeRaw(LS.subs, JSON.stringify(all));
      return all;
    },
    exportSubmissionsJSON: function () {
      return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), submissions: this.listSubmissions() }, null, 2);
    },
    importSubmissionsJSON: function (text) {
      var obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error('提交队列文件解析失败（应为 JSON）'); }
      var incoming = Array.isArray(obj) ? obj : (obj && obj.submissions) || [];
      if (!Array.isArray(incoming)) throw new Error('文件里没有 submissions 数组');
      var all = this.listSubmissions(), have = {}, add = 0;
      all.forEach(function (s) { have[s.id] = 1; });
      incoming.forEach(function (s) {
        if (!s || !s.id) { s = s || {}; s.id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
        if (have[s.id]) return;
        s.status = s.status || 'pending';
        all.push(s); have[s.id] = 1; add++;
      });
      writeRaw(LS.subs, JSON.stringify(all));
      return { imported: add, total: all.length };
    }
  };

  /* ============================================================
     2. 补丁应用
     ============================================================ */

  // 建立“当前名称 → 稳定键”索引，供表格导入时反查
  function buildIndex(DATA, POI_MAP) {
    var idx = { ev: {}, sub: {}, er: {}, poi: {}, erName: {}, erId: {} };
    (DATA.events || []).forEach(function (e) {
      if (!e.__key) e.__key = KEYS.ev(e.name);
      idx.ev[norm(e.name)] = e.__key;
      (e.children || []).forEach(function (c) {
        if (!c.__key) c.__key = KEYS.sub(e.name, c.name);
        idx.sub[norm(e.name) + '/' + norm(c.name)] = c.__key;
      });
    });
    (DATA.eras || []).forEach(function (r) {
      if (!r.__key) r.__key = KEYS.er(r.id);
      idx.er[r.id] = r.__key;
      idx.erName[norm(r.name)] = r.id;
      idx.erId[r.id] = r.name;
    });
    if (POI_MAP) {
      Object.keys(POI_MAP).forEach(function (pname) {
        (POI_MAP[pname] || []).forEach(function (p, i) {
          if (!p.__key) p.__key = KEYS.poi(pname, p.name);
          idx.poi[norm(pname) + '/' + norm(p.name)] = p.__key;
          idx.poi[norm(pname) + '/#' + i] = p.__key;
        });
      });
    }
    return idx;
  }

  function makeEvent(key, rec) {
    var e = { __key: key, __new: true, name: rec.name || '', year: 0, region: rec.region || 'foreign',
              lat: 0, lng: 0, importance: 3 };
    assignFields(e, 'event', rec);
    if (!e.blurb) e.blurb = '';
    return e;
  }

  // 把补丁覆盖到内存数据上；幂等，可在每次分片加载后重复调用
  function applyPatch() {
    var DATA = getDATA(), POI_MAP = getPOI();
    if (!DATA || !Array.isArray(DATA.events)) return false;

    var patch = AtlasBackend.loadPatch();
    var recs = patch.records || {}, del = patch.deleted || {};
    var idx = buildIndex(DATA, POI_MAP);

    // ---- 事件与子事件：先打键，再覆盖 ----
    DATA.events.forEach(function (e) {
      if (!e.__key) e.__key = KEYS.ev(e.name);
      var k = e.__key;
      if (recs[k]) assignFields(e, 'event', recs[k]);
      (e.children || []).forEach(function (c) {
        if (!c.__key) c.__key = KEYS.sub(e.name, c.name);
        if (recs[c.__key]) assignFields(c, 'sub', recs[c.__key]);
      });
    });

    // ---- 新增事件 / 子事件 ----
    Object.keys(recs).forEach(function (k) {
      var rec = recs[k];
      if (!rec || !rec.__new) return;
      if (k.indexOf('ev:') === 0) {
        if (!DATA.events.some(function (e) { return e.__key === k; })) DATA.events.push(makeEvent(k, rec));
      } else if (k.indexOf('sub:') === 0) {
        var parts = k.slice(4).split('/');
        var pkey = 'ev:' + parts[0];
        var parent = DATA.events.filter(function (e) { return e.__key === pkey; })[0];
        if (!parent) parent = DATA.events.filter(function (e) { return norm(e.name) === parts[0]; })[0];   // 父事件已改名时的兜底
        if (!parent) return;
        parent.children = parent.children || [];
        if (!parent.children.some(function (c) { return c.__key === k; })) {
          var c0 = { __key: k, __new: true, name: rec.name || '', year: 0, lat: 0, lng: 0, importance: 3, blurb: '' };
          assignFields(c0, 'sub', rec);
          parent.children.push(c0);
        }
      }
    });

    // ---- 删除 + 按键去重（防止分片把已改名的条目又并进来） ----
    var seen = {};
    DATA.events = DATA.events.filter(function (e) {
      if (!e.__key) e.__key = KEYS.ev(e.name);
      if (del[e.__key]) return false;
      if (seen[e.__key]) return false;
      seen[e.__key] = 1;
      if (Array.isArray(e.children)) {
        var cseen = {};
        e.children = e.children.filter(function (c) {
          if (!c.__key) c.__key = KEYS.sub(e.name, c.name);
          if (del[c.__key]) return false;
          if (cseen[c.__key]) return false;
          cseen[c.__key] = 1; return true;
        });
      }
      return true;
    });

    // ---- 朝代 ----
    if (Array.isArray(DATA.eras)) {
      DATA.eras.forEach(function (r) {
        if (!r.__key) r.__key = KEYS.er(r.id);
        if (recs[r.__key]) assignFields(r, 'era', recs[r.__key]);
        // 朝代的多个政治中心（era.centers）：多政权并立 / 迁都 / 陪都
        (r.centers || []).forEach(function (c) {
          if (!c.__key) c.__key = KEYS.ce(r.name, c.name);
          if (recs[c.__key]) assignFields(c, 'center', recs[c.__key]);
        });
      });
      Object.keys(recs).forEach(function (k) {
        if (k.indexOf('er:') !== 0 || !recs[k] || !recs[k].__new) return;
        if (!DATA.eras.some(function (r) { return r.__key === k; })) {
          var r0 = { __key: k, __new: true, id: k.slice(3), name: recs[k].name || '', region: recs[k].region || 'foreign',
                     start: 0, end: 0, lat: 0, lng: 0, importance: 3, blurb: '' };
          assignFields(r0, 'era', recs[k]);
          DATA.eras.push(r0);
        }
      });
      // 新增政治中心：键形如 ce:<朝代名>/<中心名>
      Object.keys(recs).forEach(function (k) {
        if (k.indexOf('ce:') !== 0 || !recs[k] || !recs[k].__new) return;
        var rest = k.slice(3), i = rest.indexOf('/');
        if (i < 0) return;
        var en = rest.slice(0, i), host = null;
        DATA.eras.forEach(function (r) { if (!host && norm(r.name) === en) host = r; });
        if (!host) return;
        host.centers = host.centers || [];
        if (host.centers.some(function (c) { return c.__key === k; })) return;
        var c0 = { __key: k, __new: true, name: recs[k].name || '', region: host.region,
                   start: 0, end: 0, lat: 0, lng: 0, place: '', blurb: '' };
        assignFields(c0, 'center', recs[k]);
        host.centers.push(c0);
      });
      // 政治中心：删除 + 去重
      DATA.eras.forEach(function (r) {
        if (!Array.isArray(r.centers)) return;
        var cseen = {};
        r.centers = r.centers.filter(function (c) {
          if (!c.__key) c.__key = KEYS.ce(r.name, c.name);
          if (del[c.__key]) return false;
          if (cseen[c.__key]) return false;
          cseen[c.__key] = 1; return true;
        });
      });
      var rseen = {};
      DATA.eras = DATA.eras.filter(function (r) {
        if (!r.__key) r.__key = KEYS.er(r.id);
        if (del[r.__key]) return false;
        if (rseen[r.__key]) return false;
        rseen[r.__key] = 1; return true;
      });
    }

    // ---- 景点 ----
    if (POI_MAP) {
      Object.keys(POI_MAP).forEach(function (pname) {
        var list = POI_MAP[pname] || [];
        list.forEach(function (p) {
          if (!p.__key) p.__key = KEYS.poi(pname, p.name);
          if (recs[p.__key]) assignFields(p, 'poi', recs[p.__key]);
        });
        var seenP = {};
        POI_MAP[pname] = list.filter(function (p) {
          if (!p.__key) p.__key = KEYS.poi(pname, p.name);
          if (del[p.__key]) return false;
          if (seenP[p.__key]) return false;
          seenP[p.__key] = 1; return true;
        });
      });
      // 新增景点：键形如 poi:<父事件标题>/<景点名>
      Object.keys(recs).forEach(function (k) {
        if (k.indexOf('poi:') !== 0 || !recs[k] || !recs[k].__new) return;
        var rest = k.slice(4);
        var i = rest.indexOf('/');
        if (i < 0) return;
        var pnorm = rest.slice(0, i);
        var pname = null;
        Object.keys(POI_MAP).forEach(function (n) { if (norm(n) === pnorm) pname = n; });
        if (!pname) {
          // 父事件存在但还没有景点列表
          var host = DATA.events.filter(function (e) { return norm(e.name) === pnorm; })[0];
          if (!host) return;
          pname = host.name;
        }
        POI_MAP[pname] = POI_MAP[pname] || [];
        if (POI_MAP[pname].some(function (p) { return p.__key === k; })) return;
        var p0 = { __key: k, __new: true, name: recs[k].name || '', lat: 0, lng: 0, desc: '' };
        assignFields(p0, 'poi', recs[k]);
        POI_MAP[pname].push(p0);
      });
    }

    // 时代归属规范化：era 可能被写成「时代名」（如 民国 / 晋 / 春秋（东周））
    // 或「已废弃的旧 id」（如 e-zhou），统一换算为当前时代表里的 id，避免"查无此朝"丢数据
    normalizeEraRefs(DATA);

    return true;
  }

  /* ============================================================
     3. 表格（CSV / TSV / XLSX）
     ============================================================ */
  var COLS = ['类型', '稳定ID', '事件层级', '标题', '父事件', '起始年', '结束年', '地区', '所属朝代', '文明链', '历史分期', '大分期', '政权', '疆域',
              '地理位置', '经度', '纬度', '图标', '重要度', '一句话简介', '详情', '人物', 'B站关键词', 'YouTube关键词',
              'L2显示缩放', 'L3显示缩放', '删除'];

  /* 文明链：名称 ↔ id 互转（注册表由 data/chains.js 提供） */
  function chainList() {
    var reg = global.__ATLAS_CHAINS;
    return (reg && reg.list && reg.list.length) ? reg.list : [{ id: 'other', name: '其他·跨区域' }];
  }
  function chainName(id) {
    if (!id) return '';
    var l = chainList();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].name;
    return String(id);
  }
  function chainId(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var l = chainList();
    for (var i = 0; i < l.length; i++) if (l[i].id === s || l[i].name === s) return l[i].id;
    return s;   // 未登记的链名原样保留，便于自定义
  }
  // 忽略“显式 chain 字段”的默认链（用于判断：清空单元格是否等于回到默认）
  function defaultChain(r) {
    if (!r) return '';
    if (r.region !== 'foreign') return '';
    var reg = global.__ATLAS_CHAINS;
    var d = reg && reg['default'];
    return (d && d[r.id]) || 'other';
  }
  function chainOfEra(r) {
    if (!r) return '';
    if (r.chain) return r.chain;
    return defaultChain(r);
  }

  /* 历史分期：默认表在 data/era-stages.js（window.__ATLAS_ERA_STAGES）。
     时代自己填了 stages 就用它；留空则回落到默认；都为空时返回 ''（前端会自动分三段）。*/
  function defaultStages(r) {
    if (!r) return '';
    var reg = global.__ATLAS_ERA_STAGES;
    return (reg && reg[r.id]) || '';
  }
  function eraStages(r) {
    if (!r) return '';
    return (r.stages != null && String(r.stages).trim() !== '') ? String(r.stages).trim() : defaultStages(r);
  }
  /* 疆域：默认表在 data/territory.js（window.__ATLAS_TERRITORY）。
     时代自己填了 territory 就用它；留空回落到默认表；都没有 = 无疆域。 */
  function defaultTerritory(r) {
    if (!r) return '';
    var reg = global.__ATLAS_TERRITORY;
    return (reg && reg[r.id]) || '';
  }
  function eraTerritory(r) {
    if (!r) return '';
    return (r.territory != null && String(r.territory).trim() !== '') ? String(r.territory).trim() : defaultTerritory(r);
  }
  /* 解析分期串：'名称:起~止; 名称:起~止'（分隔符可用 ~ - — 至；年份可为负） */
  function parseStages(s) {
    var out = [];
    String(s == null ? '' : s).split(/[;；]/).forEach(function (seg) {
      seg = seg.trim(); if (!seg) return;
      var m = /^([^:：]+)[:：]\s*(.+)$/.exec(seg);
      if (!m) return;
      var r = /(-?\d+)\s*[-~～—至]\s*(-?\d+)/.exec(m[2]);
      if (!r) return;
      out.push({ name: m[1].trim(), start: +r[1], end: +r[2] });
    });
    return out;
  }

  /* 中国轴「九大分期」：定义表在 data/china-periods.js（window.__ATLAS_CHINA_PERIODS）*/
  function periodList() {
    var reg = global.__ATLAS_CHINA_PERIODS;
    return (reg && reg.list && reg.list.length) ? reg.list : [];
  }
  function periodById(id) {
    if (!id) return null;
    var l = periodList();
    for (var i = 0; i < l.length; i++) if (l[i].id === id || l[i].name === id) return l[i];
    return null;
  }
  function periodName(id) { var p = periodById(id); return p ? p.name : (id || ''); }
  function defaultPeriod(r) {
    if (!r || r.region === 'foreign') return '';
    var reg = global.__ATLAS_CHINA_PERIODS;
    var a = (reg && reg.assign) || {};
    if (a[r.id]) return a[r.id];
    var s = (typeof r.start === 'number') ? r.start : null;
    if (s == null) return '';
    var l = periodList();
    for (var i = 0; i < l.length; i++) { if (s >= l[i].start && s < l[i].end) return l[i].id; }
    return l.length ? l[l.length - 1].id : '';
  }
  function eraPeriod(r) {
    if (!r || r.region === 'foreign') return '';
    var v = (r.period != null && String(r.period).trim() !== '') ? String(r.period).trim() : defaultPeriod(r);
    var p = periodById(v);
    return p ? p.id : v;      // 规范成 id（也接受直接填中文名）
  }
  /* 地理位置文本：优先用手工填的 place；
     没填就用坐标反查（前端 index.html 提供的 lookupLocation → {province, name}）。
     返回形如「陕西 · 西安」。 */
  function placeOf(o) {
    if (!o) return '';
    if (o.place) return String(o.place);
    var lat = o.lat, lng = o.lng;
    if (lat == null || lng == null || isNaN(+lat) || isNaN(+lng)) return '';
    var fn = (typeof global.lookupLocation === 'function') ? global.lookupLocation : null;
    if (!fn) return '';
    try {
      var loc = fn(+lat, +lng);
      if (!loc) return '';
      return loc.province ? (loc.province + ' · ' + loc.name) : String(loc.name || '');
    } catch (e) { return ''; }
  }
  var KIND_LABEL = { event: '事件', sub: '子事件', era: '朝代', poi: '景点', center: '政治中心' };
  var LABEL_KIND = { '事件': 'event', '子事件': 'sub', '朝代': 'era', '景点': 'poi', '政治中心': 'center' };

  function regionLabel(r) { return r === 'china' ? '中国' : (r === 'foreign' ? '外国' : (r || '')); }
  function regionValue(r) {
    var s = String(r == null ? '' : r).trim();
    if (s === '中国' || s === 'china' || s === 'cn') return 'china';
    if (s === '外国' || s === 'foreign' || s === 'world') return 'foreign';
    return s;
  }

  // 从当前内存数据生成导出表格行
  // 注意：按稳定键去重，保证“一个 ID 一行”——否则同名条目会让批量导入自相矛盾
  /* 按文明链筛选导出：
     filter 为空 → 全部导出
     filter=['egypt','rome'] → 只导出这些链的内容（含其下的时代/事件/子事件/景点）
     filter 里也可以写 'china'，把中国轴（参照轴）一并纳入 */
  function eraInChainFilter(r, set) {
    if (!set) return true;
    var c = (r.region === 'foreign') ? chainOfEra(r) : 'china';
    return set[c] === 1;
  }
  function buildExportRows(DATA, POI_MAP, chainFilter) {
    buildIndex(DATA, POI_MAP);
    var set = null;
    if (chainFilter && chainFilter.length) { set = {}; chainFilter.forEach(function (c) { set[c] = 1; }); }
    var rows = [], seen = {}, eraById = {}, evByNorm = {};
    (DATA.eras || []).forEach(function (r) { eraById[r.id] = r; });
    // 事件按 norm 口径建索引：POI_MAP 的键是「事件全名（可能带括号注记）」，
    // 与 DATA.events 的短名不一致，必须归一后再匹配宿主事件，否则景点会漏过滤
    (DATA.events || []).forEach(function (e) { var n = norm(e.name); if (!(n in evByNorm)) evByNorm[n] = e; });
    function fresh(key) { if (seen[key]) return false; seen[key] = 1; return true; }
    function evOK(e) {
      if (!set) return true;
      var era = eraById[e.era];
      return !!era && eraInChainFilter(era, set);
    }
    (DATA.eras || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); }).forEach(function (r) {
      if (!eraInChainFilter(r, set)) return;
      if (!fresh(r.__key)) return;
      rows.push(eraRow(r));
      // 朝代的多个政治中心：紧跟在该朝代行之后，各自一行
      (r.centers || []).forEach(function (c) {
        if (!c.__key) c.__key = KEYS.ce(r.name, c.name);
        if (!fresh(c.__key)) return;
        rows.push(centerRow(r, c));
      });
    });
    (DATA.events || []).slice().sort(function (a, b) { return (a.year || 0) - (b.year || 0); }).forEach(function (e) {
      if (!evOK(e)) return;
      if (!fresh(e.__key)) return;
      rows.push(evRow(e, '事件', ''));
      (e.children || []).slice().sort(function (a, b) { return (a.year || 0) - (b.year || 0); }).forEach(function (c) {
        if (!fresh(c.__key)) return;
        rows.push(evRow(c, '子事件', e.name));
      });
    });
    if (POI_MAP) {
      Object.keys(POI_MAP).forEach(function (pname) {
        // 景点跟随它所属的事件：按 norm 归一匹配宿主；
        // 事件被筛掉、或宿主不可考（无法判断属于哪条链）时一并省略
        if (set) {
          var host = evByNorm[norm(pname)];
          if (!host || !evOK(host)) return;
        }
        (POI_MAP[pname] || []).forEach(function (p) {
          if (!fresh(p.__key)) return;
          rows.push({ '类型': '景点', '稳定ID': p.__key, '事件层级': '—', '标题': p.name, '父事件': pname,
            '起始年': '', '结束年': '', '地区': '', '所属朝代': '', '文明链': '',
            '地理位置': placeOf(p), '经度': p.lng, '纬度': p.lat, '图标': '',
            '重要度': '', '一句话简介': p.desc || '',
            '详情': '', '人物': '', 'B站关键词': '', 'YouTube关键词': '', '删除': '' });
        });
      });
    }
    return rows;
  }
  /* 层级自动显隐的缩放阈值（%）：默认 500% 显示 L2、550% 显示 L3，可按朝代单独改 */
  var DEF_L2_ZOOM = 1000, DEF_L3_ZOOM = 1800;
  function eraZoom(r, lv) {
    var v = (lv === 2) ? r.l2Zoom : r.l3Zoom;
    return (typeof v === 'number' && v > 0) ? v : (lv === 2 ? DEF_L2_ZOOM : DEF_L3_ZOOM);
  }
  function eraRow(r) {
    var foreign = (r.region === 'foreign');
    return { '类型': '朝代', '稳定ID': r.__key,
      '事件层级': 'L1 朝代', '标题': r.name, '父事件': '',
      '起始年': r.start, '结束年': r.end, '地区': regionLabel(r.region), '所属朝代': '',
      '文明链': foreign ? chainName(chainOfEra(r)) : '',
      '历史分期': eraStages(r),
      '大分期': foreign ? '' : periodName(eraPeriod(r)),
      '疆域': eraTerritory(r),
      '地理位置': placeOf(r), '经度': r.lng, '纬度': r.lat, '图标': r.icon || '',
      '重要度': r.importance, '一句话简介': r.blurb || '',
      '详情': r.detail || '', '人物': '', 'B站关键词': '', 'YouTube关键词': '',
      'L2显示缩放': eraZoom(r, 2), 'L3显示缩放': eraZoom(r, 3), '删除': '' };
  }
  function centerRow(r, c) {
    var foreign = (r.region === 'foreign');
    return { '类型': '政治中心', '稳定ID': c.__key, '事件层级': '—',
      '标题': c.name, '父事件': r.name,
      '起始年': c.start, '结束年': c.end, '地区': regionLabel(r.region),
      '所属朝代': r.name, '文明链': foreign ? chainName(chainOfEra(r)) : '',
      '政权': c.faction || '',
      '地理位置': placeOf(c), '经度': c.lng, '纬度': c.lat, '图标': '',
      '重要度': '', '一句话简介': c.blurb || '',
      '详情': '', '人物': '', 'B站关键词': '', 'YouTube关键词': '', '删除': '' };
  }
  function evRow(e, kindLabel, parentName) {
    var eraName = '', eraObj = null;
    var DATA = getDATA();
    if (DATA && DATA.eras) {
      for (var i = 0; i < DATA.eras.length; i++) { if (DATA.eras[i].id === e.era) { eraObj = DATA.eras[i]; eraName = eraObj.name; break; } }
    }
    var tier3 = (kindLabel === '子事件' || e.tier === 3);
    return { '类型': kindLabel, '事件层级': (tier3 ? 'L3 次要事件' : 'L2 重要事件'),
      '稳定ID': e.__key, '标题': e.name, '父事件': parentName || '',
      '起始年': e.year, '结束年': '', '地区': regionLabel(e.region), '所属朝代': eraName || (e.era || ''),
      '文明链': (eraObj && eraObj.region === 'foreign') ? chainName(chainOfEra(eraObj)) : '',
      '地理位置': placeOf(e), '经度': e.lng, '纬度': e.lat, '图标': e.icon || '',
      '重要度': e.importance, '一句话简介': e.blurb || '',
      '详情': e.detail || '', '人物': (e.figures || []).join('、'),
      'B站关键词': (e.video && e.video.bili) || '', 'YouTube关键词': (e.video && e.video.yt) || '', '删除': '' };
  }

  // ---- CSV 序列化 ----
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows, cols, header) {
    cols = cols || COLS;
    var out = [cols.map(csvCell).join(',')];
    rows.forEach(function (r) { out.push(cols.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return '\uFEFF' + out.join('\r\n') + '\r\n';   // BOM：Excel 打开中文不乱码
  }

  // ---- CSV / TSV 解析（带引号、换行、CRLF 支持） ----
  function parseDSV(text, delim) {
    delim = delim || ',';
    var rows = [], row = [], cur = '', inQ = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function rowsToObjects(grid) {
    if (!grid.length) return { header: [], rows: [] };
    var header = grid[0].map(function (h) { return String(h || '').replace(/^\uFEFF/, '').trim(); });
    var rows = [];
    for (var i = 1; i < grid.length; i++) {
      var arr = grid[i];
      if (!arr || arr.every(function (v) { return String(v === null || v === undefined ? '' : v).trim() === ''; })) continue;
      var o = {};
      header.forEach(function (h, j) { if (h) o[h] = arr[j] === undefined ? '' : String(arr[j]); });
      rows.push(o);
    }
    return { header: header, rows: rows };
  }

  // ---- 编码识别：BOM → UTF-8；出现替换符 → 退回 GBK ----
  function decodeBytes(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    var s = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    if (s.indexOf('\uFFFD') >= 0) {
      try { return new TextDecoder('gbk').decode(u8); } catch (e) {}
    }
    return s;
  }

  // ---- XLSX 读取（零依赖：zip 解包 + deflate-raw 解压 + 正则取单元格） ----
  function u16(u8, p) { return u8[p] | (u8[p + 1] << 8); }
  function u32(u8, p) { return (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0; }

  function unzipEntries(u8) {
    var eocd = -1;
    for (var p = u8.length - 22; p >= 0 && p > u8.length - 66000; p--) {
      if (u8[p] === 0x50 && u8[p + 1] === 0x4b && u8[p + 2] === 0x05 && u8[p + 3] === 0x06) { eocd = p; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx / zip 文件');
    var count = u16(u8, eocd + 10), cdOff = u32(u8, eocd + 16);
    var entries = [], q = cdOff;
    for (var i = 0; i < count; i++) {
      if (u32(u8, q) !== 0x02014b50) break;
      var method = u16(u8, q + 10);
      var csize = u32(u8, q + 20);
      var nameLen = u16(u8, q + 28), extraLen = u16(u8, q + 30), cmtLen = u16(u8, q + 32);
      var lho = u32(u8, q + 42);
      var name = new TextDecoder('utf-8').decode(u8.subarray(q + 46, q + 46 + nameLen));
      entries.push({ name: name, method: method, csize: csize, lho: lho });
      q += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 xlsx，请另存为 CSV 后再导入');
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readXlsx(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var entries = unzipEntries(u8);
    var wanted = {};
    entries.forEach(function (en) {
      if (en.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(en.name)) wanted[en.name] = en;
    });
    async function get(name) {
      var en = wanted[name];
      if (!en) return null;
      var nl = u16(u8, en.lho + 26), el = u16(u8, en.lho + 28);
      var start = en.lho + 30 + nl + el;
      var raw = u8.subarray(start, start + en.csize);
      return en.method === 0 ? raw : await inflateRaw(raw);
    }
    // 共享字符串
    var shared = [];
    var ssBuf = await get('xl/sharedStrings.xml');
    if (ssBuf) {
      var ssXml = new TextDecoder('utf-8').decode(ssBuf);
      var siRe = /<si[^>]*>([\s\S]*?)<\/si>/g, m;
      while ((m = siRe.exec(ssXml))) {
        var inner = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
        var parts = [], tRe = /<t[^>]*>([\s\S]*?)<\/t>/g, mm;
        while ((mm = tRe.exec(inner))) parts.push(xmlUnescape(mm[1]));
        shared.push(parts.join(''));
      }
    }
    // 取第一个工作表
    var names = Object.keys(wanted).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort(function (a, b) {
        var na = +(a.match(/(\d+)\.xml$/) || [0, 0])[1], nb = +(b.match(/(\d+)\.xml$/) || [0, 0])[1];
        return na - nb;
      });
    if (!names.length) throw new Error('xlsx 里没有找到工作表');
    var sheetXml = new TextDecoder('utf-8').decode(await get(names[0]));
    return sheetToGrid(sheetXml, shared);
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function xmlUnescape(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function sheetToGrid(xml, shared) {
    var grid = [];
    var rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g, rm;
    while ((rm = rowRe.exec(xml))) {
      var cells = [], cRe = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cRe.exec(rm[1]))) {
        var attrs = cm[1] || '', body = cm[2] || '';
        var refM = /r="([A-Z]+\d+)"/.exec(attrs);
        var ci = refM ? colIndex(refM[1]) : cells.length;
        if (ci < 0) ci = cells.length;
        var tm = /t="([^"]+)"/.exec(attrs);
        var type = tm ? tm[1] : '';
        var val = '';
        if (type === 'inlineStr') {
          var it = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
          val = it ? xmlUnescape(it[1]) : '';
        } else {
          var vm = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
          var raw = vm ? xmlUnescape(vm[1]) : '';
          val = (type === 's') ? (shared[+raw] !== undefined ? shared[+raw] : '') : raw;
        }
        cells[ci] = val;
      }
      for (var i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      grid.push(cells);
    }
    return grid;
  }

  // ---- 统一入口：按字节判断是 xlsx 还是文本表 ----
  async function parseTableBytes(buf, filename) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var isZip = u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b;
    if (isZip) return rowsToObjects(await readXlsx(u8));
    var text = decodeBytes(u8);
    var head = text.slice(0, 2000);
    var delim = (head.split('\t').length > head.split(',').length) ? '\t' : ',';
    return rowsToObjects(parseDSV(text, delim));
  }

  /* ============================================================
     4. 差异计算与写回补丁
     ============================================================ */
  // 列 → 字段映射，按类型区分：事件/子事件用 year，朝代用 start/end，景点用 desc
  var COL_FIELDS = {
    event: { '标题': 'name', '起始年': 'year', '地区': 'region', '所属朝代': 'era',
             '地理位置': 'place', '经度': 'lng', '纬度': 'lat', '图标': 'icon',
             '重要度': 'importance', '一句话简介': 'blurb', '详情': 'detail', '人物': 'figures',
             'B站关键词': 'video.bili', 'YouTube关键词': 'video.yt' },
    era:   { '标题': 'name', '起始年': 'start', '结束年': 'end', '地区': 'region',
             '地理位置': 'place', '经度': 'lng', '纬度': 'lat', '图标': 'icon',
             '重要度': 'importance', '一句话简介': 'blurb', '详情': 'detail', '文明链': 'chain',
             '历史分期': 'stages', '大分期': 'period', '疆域': 'territory',
             'L2显示缩放': 'l2Zoom', 'L3显示缩放': 'l3Zoom' },
    poi:   { '标题': 'name', '地理位置': 'place', '经度': 'lng', '纬度': 'lat', '一句话简介': 'desc' },
    center:{ '标题': 'name', '政权': 'faction', '起始年': 'start', '结束年': 'end', '地区': 'region',
             '地理位置': 'place', '经度': 'lng', '纬度': 'lat', '一句话简介': 'blurb' }
  };
  COL_FIELDS.sub = COL_FIELDS.event;
  function isDeleteMark(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '是' || s === 'y' || s === 'yes' || s === '1' || s === '删除' || s === 'true';
  }

  // 把一行表格解析成 {kind, key, fields, isNew}
  function parseRow(row, idx) {
    var rawType = String(row['类型'] || '').trim();
    var kind = LABEL_KIND[rawType];
    // 「事件层级」列可反推类型
    var lv = String(row['事件层级'] || '').trim();
    var lvKind = /L1|朝代|时代/.test(lv) ? 'era'
               : /L3|子事件|次要事件/.test(lv) ? 'sub'
               : /L2|事件|重要事件/.test(lv) ? 'event'
               : null;
    // 「事件层级」列优先：可在表格里直接把一行在 L2 / L3 之间对调，系统以此为准
    if (lvKind && (kind === 'event' || kind === 'sub') && lvKind !== kind) kind = lvKind;
    else if (!kind && lvKind) kind = lvKind;
    // L3 若没有「父事件」→ 它不是谁的子事件，而是一条**独立的次要事件**（按事件存，仅标记层级）
    var lvFromSub = false;
    if (kind === 'sub' && !String(row['父事件'] || '').trim()) { kind = 'event'; lvFromSub = true; }
    if (!kind && (lv === '—' || /景点/.test(lv))) kind = 'poi';
    if (!kind) {
      var k0 = String(row['稳定ID'] || '').trim();
      if (k0.indexOf('er:') === 0) kind = 'era';
      else if (k0.indexOf('sub:') === 0) kind = 'sub';
      else if (k0.indexOf('ev:') === 0) kind = 'event';
      else if (k0.indexOf('poi:') === 0) kind = 'poi';
      else if (k0.indexOf('ce:') === 0) kind = 'center';
      else if (String(row['父事件'] || '').trim()) kind = 'sub';      // 有父事件 → 子事件
      else if (String(row['标题'] || '').trim()) kind = 'event';     // 只有标题 → 事件
    }
    if (!kind) {
      // 整行都空（Excel 末尾空行）→ 静默跳过
      var blank = Object.keys(row).every(function (k) { return String(row[k] == null ? '' : row[k]).trim() === ''; });
      if (blank) return { skip: true };
      return { error: '未知的类型「' + rawType + '」（可填：事件 / 子事件 / 朝代 / 景点 / 政治中心）' };
    }
    var title = String(row['标题'] || '').trim();
    var parent = String(row['父事件'] || '').trim();
    // 政治中心：名称优先「标题」，为空则取「地理位置」的城市段（如「河南 · 开封」→「开封」）
    var placeRaw = String(row['地理位置'] || '').trim();
    var placeCity = placeRaw ? (placeRaw.split(/[·・|,，\/]/).pop() || '').trim() : '';
    if (kind === 'center' && !title) title = placeCity;
    var key = String(row['稳定ID'] || '').trim();
    // 层级被改动（L2↔L3）时，稳定ID 前缀已不匹配 → 按新层级重算稳定键
    var keyKind = { ev: 'event', sub: 'sub', er: 'era', poi: 'poi', ce: 'center' }[(key.split(':')[0] || '')];
    if (key && keyKind && keyKind !== kind) key = '';
    if (!key) {
      if (kind === 'era') { if (title) key = 'er:' + norm(title); }
      else if (kind === 'event') { if (title) key = KEYS.ev(title); }
      else if (kind === 'sub') { if (title && parent) key = KEYS.sub(parent, title); }
      else if (kind === 'poi') { if (title && parent) key = KEYS.poi(parent, title); }
      else if (kind === 'center') { if (title && parent) key = KEYS.ce(parent, title); }
    }
    if (!key) return { error: '缺少稳定ID，且标题/父事件不足以定位' };
    var fields = {};
    var map = COL_FIELDS[kind] || {};
    Object.keys(map).forEach(function (col) {
      if (!(col in row)) return;
      var raw = row[col];
      if (raw === undefined || raw === null) return;
      var v = String(raw).trim();
      var f = map[col];
      if (f === 'video.bili' || f === 'video.yt') {
        if (v === '') return;
        fields.video = fields.video || {};
        if (f === 'video.bili') fields.video.bili = v; else fields.video.yt = v;
        return;
      }
      if (f === 'name') {
        if (v !== '') fields.name = v;
        else if (kind === 'center' && title) fields.name = title;   // 政治中心名称回落到「地理位置」
        return;
      }
      if (f === 'chain') { fields.chain = chainId(v); return; }   // 允许清空 = 回落到默认链
      if (f === 'era') { if (v !== '') fields.era = resolveEra(v, idx); return; }
      if (f === 'period') { if (v !== '') { var __pp = periodById(v); fields.period = __pp ? __pp.id : v; } return; }
      if (f === 'region') { if (v !== '') fields.region = regionValue(v); return; }
      if (f === 'figures') { fields.figures = coerce('figures', v); return; }
      if (v === '') return;
      var n = coerce(f, v);
      if (n !== undefined) fields[f] = n;
    });
    // 事件层级：L2 = 重要事件（默认），L3 = 次要事件（可独立、也可挂父事件下）
    if (kind === 'event') fields.tier = (/L3|次要事件/.test(lv) || lvFromSub) ? 3 : 2;
    return { kind: kind, key: key, fields: fields, isNew: !idx.has(key), title: title, parent: parent, deleted: isDeleteMark(row['删除']) };
  }
  function resolveEra(v, idx) {
    var s = String(v).trim();
    if (idx.erId[s]) return s;                 // 直接是 id
    if (idx.erName[norm(s)]) return idx.erName[norm(s)];   // 按名称反查
    return s;
  }

  /* 加载后规范化事件的时代归属：
     era 可能是「时代名」（民国 / 晋 / 春秋（东周））、也可能是「已废弃的旧 id」（e-zhou）。
     先按 id/名称换算；仍无解时，若该事件属中国轴，尝试按年份唯一落入某个中国时代。
     返回修正条数。*/
  function normalizeEraRefs(DATA) {
    if (!DATA || !Array.isArray(DATA.events)) return 0;
    var erId = {}, erName = {};
    (DATA.eras || []).forEach(function (r) { erId[r.id] = r.name; erName[norm(r.name)] = r.id; });
    var idx = { erId: erId, erName: erName };
    var cn = (DATA.eras || []).filter(function (r) { return r.region === 'china'; });
    var fixed = 0, unresolved = 0;
    DATA.events.forEach(function (e) {
      if (e.era == null || e.era === '') return;
      var before = e.era;
      var after = resolveEra(before, idx);
      if (!erId[after] && e.region === 'china' && typeof e.year === 'number') {
        var hit = null, multi = false;
        cn.forEach(function (r) {
          if (typeof r.start !== 'number' || typeof r.end !== 'number') return;
          if (e.year >= r.start && e.year <= r.end) { if (!hit) hit = r.id; else if (hit !== r.id) multi = true; }
        });
        if (hit && !multi) after = hit;
      }
      if (erId[after]) { if (after !== before) { e.era = after; fixed++; } }
      else unresolved++;
    });
    if ((fixed || unresolved) && global.console) {
      console.info('[AtlasBackend] 时代归属规范化：修正 ' + fixed + ' 条' + (unresolved ? '，另有 ' + unresolved + ' 条无法归属' : ''));
    }
    return fixed;
  }

  function findTargets(DATA, POI_MAP, key) {
    var out = null;
    // 取“第一个”匹配，与导出（同样按稳定键取第一个）保持一致
    (DATA.events || []).forEach(function (e) {
      if (!out && e.__key === key) out = { obj: e, kind: 'event' };
      (e.children || []).forEach(function (c) { if (!out && c.__key === key) out = { obj: c, kind: 'sub' }; });
    });
    (DATA.eras || []).forEach(function (r) {
      if (!out && r.__key === key) out = { obj: r, kind: 'era' };
      (r.centers || []).forEach(function (c) { if (!out && c.__key === key) out = { obj: c, kind: 'center' }; });
    });
    if (POI_MAP) Object.keys(POI_MAP).forEach(function (p) {
      (POI_MAP[p] || []).forEach(function (x) { if (!out && x.__key === key) out = { obj: x, kind: 'poi' }; });
    });
    return out;
  }

  // 计算差异：返回 {updates, adds, deletes, unchanged, errors}
  function computeDiff(rows, DATA, POI_MAP) {
    DATA = DATA || getDATA(); POI_MAP = POI_MAP || getPOI();
    var idx = buildIndex(DATA, POI_MAP);
    var has = {};
    (DATA.events || []).forEach(function (e) { has[e.__key] = 1; (e.children || []).forEach(function (c) { has[c.__key] = 1; }); });
    (DATA.eras || []).forEach(function (r) { has[r.__key] = 1; (r.centers || []).forEach(function (c) { has[c.__key] = 1; }); });
    idx.poi && Object.keys(idx.poi).forEach(function (k) { if (k.indexOf('/#') < 0) has[idx.poi[k]] = 1; });
    var idxHas = { has: function (k) { return !!has[k]; } };

    var res = { updates: [], adds: [], deletes: [], unchanged: 0, errors: [] };
    rows.forEach(function (row, i) {
      var line = i + 2;   // 表格行号（含表头）
      var pr = parseRow(row, Object.assign({}, idx, idxHas));
      if (pr.skip) return;   // 空行：忽略
      if (pr.error) { res.errors.push('第 ' + line + ' 行：' + pr.error); return; }
      var isNew = !has[pr.key];
      // 显式规则：要新增就把“稳定ID”列留空；写了 ID 却查无此项 → 报错，避免打错字变成新增
      if (isNew && String(row['稳定ID'] || '').trim() !== '') {
        var extra = '';
        if (pr.kind === 'sub' && pr.parent) {
          var hasP = (DATA.events || []).some(function (e) { return e.name === pr.parent || norm(e.name) === norm(pr.parent); });
          if (!hasP) extra = '（父事件「' + pr.parent + '」当前也不存在，请先导入父事件，或把本行「稳定ID」清空）';
        }
        res.errors.push('第 ' + line + ' 行：稳定ID「' + pr.key + '」在数据中不存在' + extra + '（若要新增一条，请把“稳定ID”列留空）');
        return;
      }
      if (pr.deleted) {
        if (isNew) { res.errors.push('第 ' + line + ' 行：标记删除，但该条目不存在'); return; }
        res.deletes.push({ key: pr.key, title: pr.title, kind: pr.kind });
        return;
      }
      // 同批次新增的「朝代」立即登记进索引：这样本批次中按「所属朝代（时代名）」
      // 引用它的事件，导入时就能换算成正确的时代 id（否则会被存成中文名，导致“查无此朝”）
      if (pr.kind === 'era' && isNew) {
        var nid = pr.key.slice(3);
        if (nid) { idx.erId[nid] = pr.title; idx.erName[norm(pr.title)] = nid; }
      }
      if (isNew) {
        if (!pr.title) { res.errors.push('第 ' + line + ' 行：新增条目必须填标题'); return; }
        res.adds.push({ key: pr.key, kind: pr.kind, fields: pr.fields, title: pr.title, parent: pr.parent });
        return;
      }
      var t = findTargets(DATA, POI_MAP, pr.key);
      if (!t) { res.errors.push('第 ' + line + ' 行：找不到稳定ID「' + pr.key + '」对应的条目'); return; }
      var changes = [];
      Object.keys(pr.fields).forEach(function (f) {
        var before = t.obj[f], after = pr.fields[f];
        if (f === 'figures') {
          before = (t.obj.figures || []).join('、');
          after = (after || []).join('、');
          if (String(before) !== String(after)) changes.push({ field: '人物', before: before, after: after, rawField: 'figures', rawValue: pr.fields.figures });
          return;
        }
        if (f === 'video') { after = after || {}; before = t.obj.video || {};
          if ((before.bili || '') !== (after.bili || '')) changes.push({ field: 'B站关键词', before: before.bili || '', after: after.bili || '' });
          if ((before.yt || '') !== (after.yt || '')) changes.push({ field: 'YouTube关键词', before: before.yt || '', after: after.yt || '' });
          return;
        }
        if (f === 'chain') {
          var bch = chainOfEra(t.obj);
          var ach = after || defaultChain(t.obj);
          if (String(chainName(bch)) !== String(chainName(ach))) {
            changes.push({ field: '文明链', before: chainName(bch), after: chainName(ach), rawField: 'chain', rawValue: after });
          }
          return;
        }
        if (f === 'stages') {
          // 与「默认分期」一致 = 视为未设置 —— 保住"导出 → 原样导入"零差异
          var bst = eraStages(t.obj);
          var nst = String(after == null ? '' : after).trim();
          var eff = nst || defaultStages(t.obj);
          if (String(bst) !== String(eff)) {
            changes.push({ field: '历史分期', before: bst, after: eff, rawField: 'stages', rawValue: nst });
          }
          return;
        }
        if (f === 'territory') {
          // 同理：与默认疆域一致 = 视为未设置，保住往返零差异
          var btr = eraTerritory(t.obj);
          var ntr = String(after == null ? '' : after).trim();
          var efft = ntr || defaultTerritory(t.obj);
          if (String(btr) !== String(efft)) {
            changes.push({ field: '疆域', before: btr, after: efft, rawField: 'territory', rawValue: ntr });
          }
          return;
        }
        if (f === 'period') {
          // 同理：与默认大分期一致 = 视为未设置，保住往返零差异
          var bpn = periodName(eraPeriod(t.obj));
          var npd = after ? (periodById(after) ? periodById(after).id : after) : '';
          var epn = periodName(npd || defaultPeriod(t.obj));
          if (String(bpn) !== String(epn)) {
            changes.push({ field: '大分期', before: bpn, after: epn, rawField: 'period', rawValue: npd });
          }
          return;
        }
        if (f === 'l2Zoom' || f === 'l3Zoom') {
          // 导出时会自动补上默认值 —— 与默认值一致就当作「未设置」，保住往返零差异
          var dft = (f === 'l2Zoom') ? DEF_L2_ZOOM : DEF_L3_ZOOM;
          var cur = t.obj[f], nxt = (after === dft || after == null) ? undefined : after;
          if ((cur == null ? '' : cur) !== (nxt == null ? '' : nxt)) {
            changes.push({ field: f === 'l2Zoom' ? 'L2显示缩放' : 'L3显示缩放',
              before: cur == null ? '' : cur, after: nxt == null ? '' : nxt,
              rawField: f, rawValue: nxt });
          }
          return;
        }
        if (f === 'tier') {
          // 未标记视为 L2 —— 「导出→原样导入」不会因补了个 2 而误判为修改
          var tb3 = (t.obj.tier === 3) ? 3 : 2, ta3 = (after === 3) ? 3 : 2;
          if (tb3 !== ta3) {
            changes.push({ field: '事件层级',
              before: tb3 === 3 ? 'L3 次要事件' : 'L2 重要事件',
              after: ta3 === 3 ? 'L3 次要事件' : 'L2 重要事件',
              rawField: 'tier', rawValue: ta3 });
          }
          return;
        }
        if (f === 'era') {
          var bn = idx.erId[before] || before || '', an = idx.erId[after] || after || '';
          if (String(bn) !== String(an)) changes.push({ field: '所属朝代', before: bn, after: an });
          return;
        }
        if (f === 'place') {
          // 导出时「地理位置」可能由坐标自动补全 —— 与自动结果一致就不算修改，
          // 这样"导出→原样导入"依旧零差异；用户手工改过才记为一处修改。
          var autoPlace = placeOf(t.obj);
          var nowPlace = String(after == null ? '' : after).trim();
          if (String(t.obj.place || autoPlace).trim() !== nowPlace) {
            changes.push({ field: '地理位置', before: t.obj.place || '', after: nowPlace, rawField: 'place', rawValue: nowPlace });
          }
          return;
        }
        var b = before === undefined || before === null ? '' : before;
        var a = after === undefined || after === null ? '' : after;
        if (String(b) !== String(a)) {
          changes.push({ field: FIELD_LABEL[f] || f, before: b, after: a, rawField: f, rawValue: after });
        }
      });
      if (changes.length) res.updates.push({ key: pr.key, kind: pr.kind, title: pr.title || (t.obj.name || ''), changes: changes });
      else res.unchanged++;
    });
    return res;
  }
  var FIELD_LABEL = { name: '标题', year: '年份', region: '地区', lat: '纬度', lng: '经度',
    importance: '重要度', blurb: '一句话简介', detail: '详情', figures: '人物', start: '起始年', end: '结束年', desc: '说明',
    chain: '文明链', faction: '政权', territory: '疆域' };

  // 把差异写进补丁对象（返回新的补丁）
  function applyDiffToPatch(patch, diff) {
    patch = patch || { version: 1, records: {}, deleted: {} };
    patch.records = patch.records || {}; patch.deleted = patch.deleted || {};
    diff.updates.forEach(function (u) {
      var rec = patch.records[u.key] || {};
      u.changes.forEach(function (c) {
        var f = c.rawField;
        if (f) rec[f] = c.rawValue;
        else if (c.field === '所属朝代') rec.era = c.after;
        else if (c.field === 'B站关键词') rec.video = Object.assign(rec.video || {}, { bili: c.after });
        else if (c.field === 'YouTube关键词') rec.video = Object.assign(rec.video || {}, { yt: c.after });
      });
      patch.records[u.key] = rec;
    });
    diff.adds.forEach(function (a) {
      patch.records[a.key] = Object.assign({ __new: true }, a.fields, { name: a.title });
    });
    diff.deletes.forEach(function (d) { patch.deleted[d.key] = 1; if (patch.records[d.key]) delete patch.records[d.key]; });
    return patch;
  }

  /* ============================================================
     5. 导出接口
     ============================================================ */
  global.AtlasBackend = AtlasBackend;
  global.AtlasPatch = {
    KEYS: KEYS, norm: norm, getDATA: getDATA, getPOI: getPOI, COLS: COLS, KIND_LABEL: KIND_LABEL,
    buildIndex: buildIndex, apply: applyPatch,
    buildExportRows: buildExportRows, computeDiff: computeDiff, applyDiffToPatch: applyDiffToPatch,
    FIELDS: FIELDS, coerce: coerce, assignFields: assignFields, parseRow: parseRow,
    eraZoom: eraZoom, DEF_ZOOM: { l2: DEF_L2_ZOOM, l3: DEF_L3_ZOOM },
    eraStages: eraStages, defaultStages: defaultStages, parseStages: parseStages,
    eraTerritory: eraTerritory, defaultTerritory: defaultTerritory,
    eraPeriod: eraPeriod, defaultPeriod: defaultPeriod, periodList: periodList, periodName: periodName,
    savePatch: function (p) { return AtlasBackend.savePatch(p); },
    clearLocalPatch: function () { return AtlasBackend.clearLocalPatch(); },
    publishStatus: function () { return AtlasBackend.publishStatus(); }
  };
  global.AtlasTable = {
    COLS: COLS, toCSV: toCSV, parseDSV: parseDSV, rowsToObjects: rowsToObjects,
    decodeBytes: decodeBytes, readXlsx: readXlsx, parseTableBytes: parseTableBytes
  };

  /* ============================================================
     6. 启动：应用补丁 + 挂接懒加载钩子
     ============================================================ */
  try {
    var __D = getDATA();
    if (__D && Array.isArray(__D.events)) {
      AtlasBackend.role();     // 顺带处理 ?admin=1 参数
      applyPatch();
      if (global.AtlasLoader) {
        ['ensureForDomain', 'loadAll', 'load'].forEach(function (fn) {
          var orig = global.AtlasLoader[fn];
          if (typeof orig !== 'function') return;
          global.AtlasLoader[fn] = function () {
            var args = arguments;
            return Promise.resolve(orig.apply(global.AtlasLoader, args)).then(function (r) {
              applyPatch();          // 分片合并后再套一次补丁
              if (typeof global.onAtlasPatchApplied === 'function') { try { global.onAtlasPatchApplied(); } catch (e) {} }
              return r;
            });
          };
        });
      }
    }
  } catch (e) {
    if (global.console) console.warn('[AtlasBackend] 启动补丁失败：', e);
  }

})(typeof window !== 'undefined' ? window : globalThis);
