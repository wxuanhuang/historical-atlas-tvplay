/* ============================================================
   data/china-overview.js — 中国轴数据接口（原横向占位面板已移除）
   ------------------------------------------------------------
   2026-10-27 调整：
     · 点「中  国」轴标签改为展开窗口**左侧纵向**的「中国世界遗产」面板
       （index.html 的 #hp，61 项遗产 + 地图标注），
       原来铺满地图带的**横向占位框**（g.chinaLayer / chinaClip）连同它的
       入口绑定、悬停提示、Esc/缩放重绘钩子一并删除，避免与纵向面板双开。
     · 本文件只保留纯数据接口，供疆域图层与其它模块复用：
         chinaEras()        中国轴可见时代（按起始年排序）
         factionPalette()   一时代多政权时的并立政权配色（疆域图层依赖）
         collectCenters()   中国轴全部政治中心（供都城类功能复用）
   ============================================================ */
(function (global) {
  'use strict';

  /* 并立政权配色（同一时代多政权时按政权分色） */
  var FACTION_COLORS = ['#c9503a', '#3a7ca8', '#6a9c46', '#c99a3a', '#8e6cc0', '#3aa8a0',
                        '#b0603a', '#7a8c3a', '#b03a7a', '#4a6cc0', '#a88c3a', '#3a9a6c'];

  function hiddenMap() { return global.HIDDEN_ERA_IDS || {}; }

  function chinaEras() {
    var list = (typeof ERAS_SORTED !== 'undefined' && ERAS_SORTED) ? ERAS_SORTED : [];
    var h = hiddenMap();
    return list.filter(function (e) { return e.region !== 'foreign' && !h[e.id]; })
               .slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
  }
  function eraFactions(e) {
    var seen = {}, out = [];
    (e.centers || []).forEach(function (c) { if (c.faction && !seen[c.faction]) { seen[c.faction] = 1; out.push(c.faction); } });
    return out;
  }
  /* 仅「一时代多政权」需分色；返回 {faction:color} */
  function factionPalette() {
    var pal = {}, i = 0;
    chinaEras().forEach(function (e) {
      var fs = eraFactions(e);
      if (fs.length < 2) return;
      fs.forEach(function (f) { if (!(f in pal)) { pal[f] = FACTION_COLORS[i % FACTION_COLORS.length]; i++; } });
    });
    return pal;
  }
  /* 收集中国轴全部政治中心（无 centers 的时代回落到时代自带坐标） */
  function collectCenters() {
    var items = [];
    chinaEras().forEach(function (e) {
      var cs = (e.centers || []).filter(function (c) { return c && c.lat != null && c.lng != null; });
      if (cs.length) cs.forEach(function (c) { items.push({ era: e, c: c }); });
      else if (e.lat != null && e.lng != null) items.push({ era: e, c: { name: e.name, lng: e.lng, lat: e.lat, faction: '', start: e.start, end: e.end } });
    });
    return items;
  }

  global.AtlasChina = {
    chinaEras: chinaEras,
    collectCenters: collectCenters,
    factionPalette: factionPalette
  };
})(typeof window !== 'undefined' ? window : globalThis);
