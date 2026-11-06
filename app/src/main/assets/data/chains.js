/* ============================================================
   data/chains.js — 外国轴「文明链」体系
   ------------------------------------------------------------
   目的：外国轴 56 个时代互相重叠（248 对），下层色块根本看不到。
   做法（档②）：
     · 把 56 个时代归入 8 条语义文明链（+1 条兜底「其他」）
     · 点外国轴左侧标签 → 向上弹出半透明浮层，每个链一条泳道，一眼看全
     · 点某条泳道 → 主轴只显示该链（可多选），其余隐藏
     · 链内允许最多 2 行错开（MAX_ROWS），重叠从 248 对压到 5 处
     · 那 5 处只剩在「两河·西亚(3) / 美洲(2)」，因为这两链各有 4 个时代完全同时并存
   布局完全不变：浮层是临时态，收起即复原。

   依赖：主脚本的 CFG / xScale / ERAS_SORTED / getEraColor / visibleDomain 等
        （都是全局词法绑定，用裸标识符访问）
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     ① 链注册表（要增删链、改名，改这里即可）
     ============================================================ */
  var CHAINS = [
    { id: 'egypt',     name: '埃及',              color: '#d4a017' },
    { id: 'meso',      name: '两河·西亚',          color: '#c98a4a' },
    { id: 'islam',     name: '伊斯兰·奥斯曼',      color: '#5aa86a' },
    { id: 'classical', name: '希腊·罗马·拜占庭',   color: '#5a8ad4' },
    { id: 'europe',    name: '欧洲（中世纪→近代）', color: '#9a6ad4' },
    { id: 'southasia', name: '南亚',              color: '#d46a8a' },
    { id: 'eastasia',  name: '东亚·日本',          color: '#4ab0b0' },
    { id: 'america',   name: '美洲',              color: '#c9a24a' },
    { id: 'other',     name: '其他·跨区域',        color: '#8f8f8f' }
  ];

  // ② 默认归属（56 个外国时代全覆盖；id → 链）
  var DEFAULT = {
    // 埃及
    'egypt-old': 'egypt', 'egypt-mid': 'egypt', 'egypt-new': 'egypt', 'egypt-late': 'egypt',
    // 两河·西亚·波斯（并发最高，浮层内分 2 行）
    // 波斯线：阿契美尼德(波斯) → 安息 → 萨珊波斯 → …（伊斯兰化）… → 萨法维波斯
    'sumer': 'meso', 'assyria': 'meso', 'babylon': 'meso', 'phoenicia': 'meso',
    'israel': 'meso', 'persia': 'meso', 'parthia': 'meso', 'sassanid': 'meso',
    'safavid': 'meso',
    // 伊斯兰·奥斯曼（突厥—伊斯兰线：哈里发 → 塞尔柱 / 帖木儿 → 奥斯曼）
    'caliph-rash': 'islam', 'caliph-umay': 'islam', 'caliph-abbas': 'islam',
    'ottoman-rise': 'islam', 'ottoman-peak': 'islam', 'ottoman-dec': 'islam',
    'seljuk': 'islam', 'timurid': 'islam',
    // 希腊·罗马·拜占庭
    'minoan': 'classical', 'mycenaean': 'classical', 'greece-arch': 'classical',
    'greece-class': 'classical', 'greece-hell': 'classical',
    'rome-rep': 'classical', 'rome-emp': 'classical', 'byz': 'classical',
    // 欧洲（中世纪→近代；含维京 / 神圣罗马 / 基辅罗斯）
    'frankish': 'europe', 'medieval-early': 'europe', 'medieval-high': 'europe',
    'medieval-late': 'europe', 'renaiss': 'europe', 'explor': 'europe',
    'ind-rev': 'europe', 'e-modern': 'europe',
    'viking': 'europe', 'hre': 'europe', 'kyiv-rus': 'europe',
    // 南亚（补上笈多→莫卧儿之间的戒日王朝与德里苏丹国）
    'india-ivc': 'southasia', 'vedic': 'southasia', 'maurya': 'southasia',
    'kushan': 'southasia', 'gupta': 'southasia', 'mughal': 'southasia',
    'harsha': 'southasia', 'delhi': 'southasia',
    // 东亚·日本
    'jomon': 'eastasia', 'asuka': 'eastasia', 'nara': 'eastasia', 'heian': 'eastasia',
    'kamakura': 'eastasia', 'muromachi': 'eastasia', 'edo': 'eastasia', 'meiji': 'eastasia',
    // 美洲（浮层内分 2 行）
    'maya-classic': 'america', 'maya-post': 'america', 'aztec': 'america', 'inca': 'america',
    'col-am': 'america', 'us-ind': 'america', 'us-mod': 'america',
    // 其他
    'mongol': 'other'
  };

  window.__ATLAS_CHAINS = { list: CHAINS, 'default': DEFAULT };

  /* ============================================================
     ② 取值 / 筛选状态
     ============================================================ */
  var MAX_ROWS = 2;          // 同一链内最多 2 行（超出部分允许轻微重叠）
  var filter = [];           // [] = 全部显示
  global.__eraChainFilter = filter;

  function chainById(id) {
    for (var i = 0; i < CHAINS.length; i++) if (CHAINS[i].id === id) return CHAINS[i];
    return CHAINS[CHAINS.length - 1];
  }
  function nameOf(id) { return chainById(id).name; }
  function colorOf(id) { return chainById(id).color; }

  // 某个时代属于哪条链：补丁里显式改过就用它，否则用默认表
  function idOf(era) {
    if (!era) return 'other';
    if (era.chain) return era.chain;
    if (era.region !== 'foreign') return 'china';   // 中国轴不参与分链
    return DEFAULT[era.id] || 'other';
  }
  function isForeign(era) { return era && era.region === 'foreign'; }

  function getFilter() { return filter.slice(); }
  function setFilter(ids) {
    filter.length = 0;
    (ids || []).forEach(function (id) { if (filter.indexOf(id) < 0) filter.push(id); });
    refreshMainAxis();
  }
  function toggle(id) {
    var i = filter.indexOf(id);
    if (i >= 0) filter.splice(i, 1); else filter.push(id);
    refreshMainAxis();
  }
  function showAll() { filter.length = 0; refreshMainAxis(); }
  function isFocused(id) { return filter.length > 0 && filter.indexOf(id) >= 0; }
  function isHidden(era) {
    if (!isForeign(era)) return false;
    if (!filter.length) return false;
    return filter.indexOf(idOf(era)) < 0;
  }

  // 主动轴重绘（renderT1 的包装里会顺带刷新浮层）
  function refreshMainAxis() {
    try {
      var t = (typeof currentTransform !== 'undefined' && currentTransform) ? currentTransform : d3.zoomIdentity;
      if (typeof renderT1 === 'function') renderT1(t);
      if (typeof renderT2 === 'function') renderT2(t);   // 事件层（L2）也要跟着筛选重绘
      if (typeof renderT3 === 'function') renderT3(t);   // 子事件层（L3）
    } catch (e) { if (global.console) console.warn('[chains] 主轴重绘失败', e); }
  }

  /* ============================================================
     ③ 链内分行（贪心，最多 MAX_ROWS 行）
     ============================================================ */
  /* ------------------------------------------------------------
     链内「文明系」手工分组：同一条链里，有些时代属于同一条文明线
     （如希腊系 vs 罗马系），必须排在同一行 —— 哪怕时间上有轻微重叠，
     也好过两个文明来回穿插。没在这里列出的链，走下面的自动排布。
     ------------------------------------------------------------ */
  var LANE_GROUPS = {
    classical: [
      ['minoan', 'mycenaean', 'greece-arch', 'greece-class', 'greece-hell'],   // 希腊系一行
      ['rome-rep', 'rome-emp', 'byz']                                          // 罗马系一行
    ],
    southasia: [
      ['india-ivc', 'vedic', 'maurya', 'kushan'],                             // 上古—古典早期（孔雀接吠陀列国）
      ['gupta', 'harsha', 'delhi', 'mughal']                                  // 笈多及其后
    ],
    europe: [
      // 西欧：法兰克 → 中世纪（早/盛/晚）→ 文艺复兴 → 大航海 → 工业革命 → 近现代
      ['frankish', 'medieval-early', 'medieval-high', 'medieval-late', 'hre',
       'renaiss', 'explor', 'ind-rev', 'e-modern'],
      // 东欧·北欧：维京时代 → 基辅罗斯（留里克王朝本就是北欧人建立）
      ['viking', 'kyiv-rus']
    ],
    america: [
      // 土著文明：玛雅（古典/后古典）→ 阿兹特克 / 印加
      ['maya-classic', 'maya-post', 'aztec', 'inca'],
      // 殖民—现代：美洲殖民 → 美国独立 → 近现代美洲
      ['col-am', 'us-ind', 'us-mod']
    ]
  };

  function layoutRows(list, maxRows, chainId) {
    // ① 有手工分组 → 同系一行（允许轻微重叠），不同系分行
    if (chainId && LANE_GROUPS[chainId]) {
      var byId = {};
      list.forEach(function (e) { byId[e.id] = e; });
      var groups = LANE_GROUPS[chainId], out = [];
      groups.forEach(function (ids) {
        var row = ids.map(function (id) { return byId[id]; })
                     .filter(function (e) { return !!e; })
                     .sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
        if (row.length) out.push(row);
      });
      // 没写进分组的时代：塞进最空的一行，保证不丢
      var listed = {};
      groups.forEach(function (ids) { ids.forEach(function (id) { listed[id] = 1; }); });
      list.forEach(function (e) {
        if (listed[e.id]) return;
        if (!out.length) out.push([]);
        var r = 0;
        for (var i = 1; i < out.length; i++) if (out[i].length < out[r].length) r = i;
        out[r].push(e);
        out[r].sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      });
      return out;
    }
    maxRows = maxRows || MAX_ROWS;
    var rows = [];
    list.slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); }).forEach(function (e) {
      var ei = e.start || 0;
      // ① 先找「接得上」的行（该行末尾在 e 开始之前就已结束）。
      //    可放的行可能不止一条 → 取末尾结束最晚的那条（离 e 最近），
      //    这样同一条文明线（如奥斯曼·崛起→极盛→衰落）不容易被拆到两行。
      var target = -1, tEnd = -Infinity;
      for (var r = 0; r < rows.length && r < maxRows; r++) {
        var last = rows[r][rows[r].length - 1];
        var le = last.end || 0;
        if (le <= ei && le > tEnd) { tEnd = le; target = r; }
      }
      if (target >= 0) { rows[target].push(e); return; }
      // ② 没有接得上的行 → 还有空行就新开一行
      if (rows.length < maxRows) { rows.push([e]); return; }
      // ③ 行数已满且躲不开重叠：优先「与该行重叠的块最少」；
      //    并列时选「行末结束更早」的那条（更空，后续时代更容易接上）
      var best = 0, bestOv = Infinity, bestEnd = Infinity;
      for (var r2 = 0; r2 < rows.length; r2++) {
        var ov = 0;
        rows[r2].forEach(function (o) {
          if (ei < (o.end || 0) && (o.start || 0) < (e.end || 0)) ov++;
        });
        var lastEnd = (rows[r2][rows[r2].length - 1] || {}).end || 0;
        if (ov < bestOv || (ov === bestOv && lastEnd < bestEnd)) { bestOv = ov; bestEnd = lastEnd; best = r2; }
      }
      rows[best].push(e);
      rows[best].sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
    });
    return rows;
  }

  // 汇总：给测试与 UI 用
  function summarize(eras) {
    var out = {};
    CHAINS.forEach(function (c) { out[c.id] = { name: c.name, eras: [] }; });
    (eras || []).forEach(function (e) {
      if (!isForeign(e)) return;
      out[idOf(e)].eras.push(e);
    });
    Object.keys(out).forEach(function (k) {
      out[k].rows = layoutRows(out[k].eras, null, k).length;
      out[k].count = out[k].eras.length;
    });
    return out;
  }

  /* ============================================================
     ④ 浮层泳道 UI
     ============================================================ */
  var isOpen = false;
  var layer = null;          // 浮层根 g（屏幕坐标，和事件层同一套做法）
  var geom = null;           // 面板几何
  var lastT = null;

  var LANE_GAP = 2, HEAD_H = 28, TICK_H = 20, PAD = 6;
  var ROW_H = 20;   // 每个色块的目标高度：所有泳道统一（1 行的链、2 行的链都相同）

  // 一条链需要几行（1 或 2，取决于它的时代在时间上是否互相重叠）
  function rowCountOf(chainId) {
    var eras = (typeof ERAS_SORTED !== 'undefined' && ERAS_SORTED ? ERAS_SORTED : [])
      .filter(function (e) { return isForeign(e) && idOf(e) === chainId; });
    return Math.max(1, layoutRows(eras, null, chainId).length);
  }

  /* 面板几何：按「每条链占几行」分配高度 ——
     1 行的链占 1 层，2 行的链占 2 层。
     这样每个色块的高度都等于 ROW_H，和只有 1 行的泳道（如古埃及）完全一致，
     2 行的链不会把色块压扁，标注文字也就显示得下了。 */
  function panelGeometry() {
    var W = CFG.W;
    var counts = CHAINS.map(function (c) { return rowCountOf(c.id); });
    var totalRows = counts.reduce(function (a, b) { return a + b; }, 0);
    var bottom = CFG.AXIS.foreignY + 14;
    var maxTop = CFG.AXIS.mapTop + 40;          // 至少给地图留一点
    var rowH = ROW_H;
    var need = HEAD_H + totalRows * (rowH + LANE_GAP) + TICK_H + PAD * 2;
    var top = bottom - need;
    if (top < maxTop) {                          // 空间不够就等比压缩色块高度（下限 10）
      var avail = bottom - maxTop;
      rowH = Math.max(10, Math.floor((avail - HEAD_H - TICK_H - PAD * 2) / totalRows) - LANE_GAP);
      need = HEAD_H + totalRows * (rowH + LANE_GAP) + TICK_H + PAD * 2;
      top = bottom - need;
    }
    var tops = [], y = top + HEAD_H + PAD;
    counts.forEach(function (r) { tops.push(y); y += r * (rowH + LANE_GAP); });
    return {
      x: 14, y: top, w: W - 28, h: need,
      bottom: bottom, rowH: rowH, counts: counts, tops: tops,
      plotX: 20, plotW: W - 40,
      laneTop: top + HEAD_H + PAD
    };
  }

  // 第 i 条泳道占的总高度（1 行 = ROW_H，2 行 = 2*ROW_H + 间隔）
  function laneHeightOf(i) { return geom.counts[i] * (geom.rowH + LANE_GAP) - LANE_GAP; }

  function ensureLayer() {
    var svgSel = d3.select('#map');
    var old = svgSel.select('g.chainLayer');
    if (!old.empty()) old.remove();
    layer = svgSel.append('g').attr('class', 'chainLayer');
    // 裁剪：只让泳道里的色块显示在面板范围内
    var cid = 'chainClip';
    var defs = svgSel.select('defs');
    defs.select('#' + cid).remove();
    var cp = defs.append('clipPath').attr('id', cid);
    cp.append('rect');
    layer.attr('clip-path', 'url(#' + cid + ')');
    return layer;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    ensureLayer();
    buildFrame();
    refresh();
  }
  function close() {
    isOpen = false;
    if (layer) { layer.remove(); layer = null; }
  }
  function toggleOpen() { if (isOpen) close(); else open(); }

  // 面板骨架（只建一次）
  function buildFrame() {
    geom = panelGeometry();
    layer.selectAll('*').remove();

    // 面板背景（半透明，透出地图）
    layer.append('rect').attr('class', 'cl-bg')
      .attr('x', geom.x).attr('y', geom.y).attr('width', geom.w).attr('height', geom.h)
      .attr('rx', 5)
      .attr('fill', 'rgba(10,18,26,0.74)')
      .attr('stroke', '#a87b3a').attr('stroke-width', 1);

    // 让裁剪矩形跟上
    var cpRect = d3.select('#chainClip rect');
    cpRect.attr('x', geom.x + 2).attr('y', geom.y + 2)
      .attr('width', geom.w - 4).attr('height', geom.h - 4);

    // 标题行
    var head = geom.y + HEAD_H / 2 + 3;
    layer.append('text').attr('class', 'cl-title')
      .attr('x', geom.x + 12).attr('y', head)
      .attr('font-family', "'Ma Shan Zheng',serif").attr('font-size', 15)
      .attr('fill', '#f3d896').text('文明链 · 外国轴');

    var info = layer.append('text').attr('class', 'cl-info')
      .attr('x', geom.x + 132).attr('y', head)
      .attr('font-family', "'Noto Serif SC',serif").attr('font-size', 11)
      .attr('fill', '#9fb8d4');

    var btnAll = layer.append('g').attr('class', 'cl-btn cl-all').style('cursor', 'pointer');
    btnAll.append('rect').attr('x', geom.x + geom.w - 176).attr('y', geom.y + 6)
      .attr('width', 96).attr('height', 18).attr('rx', 3)
      .attr('fill', 'rgba(168,123,58,.22)').attr('stroke', '#a87b3a');
    btnAll.append('text').attr('x', geom.x + geom.w - 128).attr('y', head)
      .attr('text-anchor', 'middle').attr('font-family', "'Noto Serif SC',serif")
      .attr('font-size', 11).attr('fill', '#efe0c0').text('全部显示');
    btnAll.on('click', function (ev) { ev.stopPropagation(); showAll(); });

    var btnX = layer.append('g').attr('class', 'cl-btn cl-x').style('cursor', 'pointer');
    btnX.append('rect').attr('x', geom.x + geom.w - 68).attr('y', geom.y + 6)
      .attr('width', 56).attr('height', 18).attr('rx', 3)
      .attr('fill', 'rgba(168,123,58,.22)').attr('stroke', '#a87b3a');
    btnX.append('text').attr('x', geom.x + geom.w - 40).attr('y', head)
      .attr('text-anchor', 'middle').attr('font-family', "'Noto Serif SC',serif")
      .attr('font-size', 11).attr('fill', '#efe0c0').text('收起 ✕');
    btnX.on('click', function (ev) { ev.stopPropagation(); close(); });

    // 9 条泳道（骨架 + 链名 + 交互相应）
    // 泳道背景：明暗交替，一眼能看出色块属于哪条泳道
    CHAINS.forEach(function (c, i) {
      var y = laneTopOf(i), h = laneHeightOf(i);
      var base = (i % 2 === 0) ? 0.02 : 0.075;
      var g = layer.append('g').attr('class', 'cl-lane').attr('data-chain', c.id)
        .attr('data-base', base);
      g.append('rect').attr('class', 'cl-lane-hit')
        .attr('x', geom.x + 4).attr('y', y - LANE_GAP / 2)
        .attr('width', geom.w - 8).attr('height', h + LANE_GAP - 1)
        .attr('rx', 3).attr('fill', 'rgba(255,255,255,' + base + ')');
      g.append('rect').attr('class', 'cl-lane-mark')
        .attr('x', geom.x + 6).attr('y', y).attr('width', 3).attr('height', h)
        .attr('rx', 1.5).attr('fill', c.color).attr('opacity', 0.9);
      g.append('g').attr('class', 'cl-blocks');
      var downPt = null;
      g.style('cursor', 'pointer')
        .on('mousedown', function (ev) { downPt = { x: ev.clientX, y: ev.clientY }; })   // 不阻止冒泡 → 浮层内可拖时间轴
        .on('click', function (ev) {
          // 拖动时间轴也会走到 click：位移超过阈值就当成拖拽，不去聚焦泳道
          if (downPt && (Math.abs(ev.clientX - downPt.x) + Math.abs(ev.clientY - downPt.y) > 4)) { downPt = null; return; }
          downPt = null;
          ev.stopPropagation();
          if (ev.ctrlKey || ev.metaKey || ev.shiftKey) toggle(c.id);
          else if (isFocused(c.id) && filter.length === 1) showAll();
          else setFilter([c.id]);
        })
        .on('mouseenter', function () {
          // 悬停 = 最高一档亮度，明显盖过斑马纹的明暗差
          d3.select(this).select('.cl-lane-hit').attr('fill', 'rgba(255,255,255,0.22)');
          d3.select(this).select('.cl-lane-mark').attr('opacity', 1);
        })
        .on('mouseleave', function () {
          var b = +d3.select(this).attr('data-base');
          d3.select(this).select('.cl-lane-hit').attr('fill', 'rgba(255,255,255,' + b + ')');
          d3.select(this).select('.cl-lane-mark').attr('opacity', 0.9);
        });
    });

    // 文明名单独一层，盖在所有色块之上：滑动时间轴时不会被色块遮挡
    // （半透明 + 不接收鼠标事件，既不挡视线也不影响拖拽/点击）
    var names = layer.append('g').attr('class', 'cl-names');
    CHAINS.forEach(function (c, i) {
      var y = laneTopOf(i), h = laneHeightOf(i);
      names.append('text').attr('class', 'cl-lane-name').attr('data-chain', c.id)
        .attr('x', geom.x + 14).attr('y', y + h / 2 + 4.5)
        .attr('font-family', "'Noto Serif SC',serif")
        .attr('font-size', 14).attr('font-weight', 700)
        .attr('opacity', 0.9).attr('fill', '#e8d9b0')
        .attr('pointer-events', 'none').text(c.name);
    });

    // 底部刻度条
    layer.append('g').attr('class', 'cl-ticks');
  }

  function laneTopOf(i) { return geom.tops[i] != null ? geom.tops[i] : geom.laneTop; }

  // 每帧刷新：色块位置 + 刻度 + 状态文字
  function refresh(t) {
    if (!isOpen || !layer) return;
    if (t) lastT = t;
    var tr = lastT || ((typeof currentTransform !== 'undefined' && currentTransform) ? currentTransform : d3.zoomIdentity);
    var k = tr.k || 1;
    var dom = (typeof visibleDomain === 'function') ? visibleDomain(tr) : [CFG.YEAR_MIN, CFG.YEAR_MAX];
    var pad = (dom[1] - dom[0]) * 0.05;
    var lo = dom[0] - pad, hi = dom[1] + pad;

    // 状态文字
    var infoTxt = filter.length
      ? '当前聚焦：' + filter.map(nameOf).join(' + ') + '（Ctrl 点击可多选）'
      : '全部显示（点某条泳道即聚焦该文明链）';
    layer.select('.cl-info').text(infoTxt);

    CHAINS.forEach(function (c, i) {
      var y = laneTopOf(i);
      var g = layer.select('g.cl-lane[data-chain="' + c.id + '"]');
      var eras = (typeof ERAS_SORTED !== 'undefined' ? ERAS_SORTED : [])
        .filter(function (e) { return isForeign(e) && idOf(e) === c.id; });
      // 行分配
      var rows = layoutRows(eras, null, c.id);
      var flat = [];
      rows.forEach(function (row, ri) {
        row.forEach(function (e) {
          // 每行都用同一个高度 geom.rowH：2 行的链不再把色块压扁，文字照样显示得下
          flat.push({ e: e, row: ri, nRows: rows.length, rowH: geom.rowH, y: y + ri * (geom.rowH + LANE_GAP) });
        });
      });
      // 视野裁剪
      var vis = flat.filter(function (o) { return !(o.e.end < lo || o.e.start > hi); });

      var sel = g.select('g.cl-blocks').selectAll('g.cl-blk').data(vis, function (o) { return o.e.id; });
      sel.exit().remove();
      var en = sel.enter().append('g').attr('class', 'cl-blk');
      en.append('rect');
      en.append('text');
      en.merge(sel).each(function (o) {
        var gg = d3.select(this);
        var e = o.e;
        var x1 = tr.x + xScale(e.start) * k;
        var x2 = tr.x + xScale(e.end) * k;
        var w = Math.max(2, x2 - x1);
        var col = (typeof getEraColor === 'function') ? getEraColor(e.id) : '#888';
        var dim = (filter.length && !isFocused(c.id)) ? 0.28 : 0.92;
        gg.select('rect')
          .attr('x', x1).attr('y', o.y).attr('width', w).attr('height', o.rowH).attr('rx', 2)
          .attr('fill', col).attr('opacity', dim)
          .attr('stroke', isFocused(c.id) ? '#ffd700' : '#1a1208')
          .attr('stroke-width', isFocused(c.id) ? 1.2 : 0.6);
        // 名字：放得下才显示
        var nm = String(e.name || '');
        var show = w > nm.length * 9.6 && o.rowH >= 12;
        gg.select('text')
          .attr('x', x1 + 3).attr('y', o.y + o.rowH / 2 + 3.6)
          .attr('font-family', "'Noto Serif SC',serif")
          .attr('font-size', Math.min(11, Math.max(9, o.rowH - 4)))
          .attr('fill', '#fff8e8').attr('opacity', show ? Math.min(1, dim + 0.08) : 0)
          .attr('pointer-events', 'none').text(nm);
        gg.select('rect').style('cursor', 'pointer');
      });
      // 泳道被聚焦时，链名高亮（名字在独立的顶层 g 里，不在 lane 内）
      layer.select('g.cl-names .cl-lane-name[data-chain="' + c.id + '"]')
        .attr('fill', isFocused(c.id) ? '#ffd98a' : '#e8d9b0');
      g.select('.cl-lane-hit').attr('stroke', isFocused(c.id) ? '#ffd700' : 'none').attr('stroke-width', isFocused(c.id) ? 1 : 0);
    });

    // 底部刻度条（用主轴同一套步长）
    var ticks = layer.select('g.cl-ticks');
    var step = (typeof stepForZoom === 'function') ? stepForZoom(k) : 1000;
    var t0 = Math.ceil(lo / step) * step;
    var list = [];
    for (var y = t0; y <= hi && list.length < 80; y += step) list.push(y);
    var tsel = ticks.selectAll('g.cl-tick').data(list, function (d) { return d; });
    tsel.exit().remove();
    var ten = tsel.enter().append('g').attr('class', 'cl-tick');
    ten.append('line');
    ten.append('text');
    var ty = geom.y + geom.h - TICK_H + 12;
    ten.merge(tsel).each(function (yv) {
      var gg = d3.select(this);
      var x = tr.x + xScale(yv) * k;
      gg.select('line').attr('x1', x).attr('x2', x).attr('y1', ty - 5).attr('y2', ty + 1)
        .attr('stroke', '#8c5a2a').attr('stroke-width', 1);
      gg.select('text').attr('x', x).attr('y', ty + 11).attr('text-anchor', 'middle')
        .attr('font-family', "'IM Fell English',serif").attr('font-size', 10)
        .attr('fill', '#c9a874')
        .text(step >= 100 ? (yv < 0 ? (-yv) + ' BC' : yv + ' AD') : String(yv));
    });
  }

  /* ============================================================
     ⑤ 对外联动
     ============================================================ */
  // 抽屉/下拉/搜索定位到某个时代时调用：若它被筛掉了，就聚焦到它所在的链
  function ensureVisible(era) {
    if (!era || !isForeign(era)) return false;
    if (!isHidden(era)) return false;
    setFilter([idOf(era)]);
    if (global.AtlasEditor && global.AtlasEditor.toast) {
      global.AtlasEditor.toast('已聚焦到「' + nameOf(idOf(era)) + '」文明链', 'info', 3000);
    }
    return true;
  }

  // 下拉/搜索传进来的是轻量对象 {name,start,end}，这里换算成真正的时代对象
  // 优先按 id / name 精确匹配，退化为「起止年最接近」的外国时代
  function findEra(ref) {
    if (!ref) return null;
    var list = (typeof ERAS_SORTED !== 'undefined' && ERAS_SORTED) ? ERAS_SORTED : [];
    var i;
    if (ref.id) { for (i = 0; i < list.length; i++) if (list[i].id === ref.id) return list[i]; }
    if (ref.name) { for (i = 0; i < list.length; i++) if (list[i].name === ref.name) return list[i]; }
    if (ref.start !== undefined && ref.end !== undefined) {
      var best = null, bestD = Infinity;
      for (i = 0; i < list.length; i++) {
        var e = list[i];
        var d = Math.abs((e.start || 0) - ref.start) + Math.abs((e.end || 0) - ref.end);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best && bestD <= 400) return best;   // 差太多就别乱认
    }
    return null;
  }

  /* ============================================================
     ⑥ 启动：把外国轴标签变成可点击入口
     ============================================================ */
  function bindAxisEntry() {
    if (typeof d3 === 'undefined') return;   // 2026-11-04：d3 缺失时静默（主脚本守卫已在页面上提示）
    var svgSel = d3.select('#map');
    var node = null;
    svgSel.selectAll('.axis-label').each(function () {
      if (((this.textContent || '').replace(/\s+/g, '')) === '外国') node = this;
    });
    if (!node) return;
    var sel = d3.select(node);
    sel.style('cursor', 'pointer').attr('fill', '#a8532a');

    // 文明链入口 = 「外国」二字本身 + 它中间那颗圆点。
    // 圆点做成闪烁的「地理标点」（脉冲动画由 index.html 里的 .cl-entry-dot 样式提供），
    // 不再放任何文字标注 —— 提示只在鼠标悬停时用浮窗显示。
    var dot = null;
    svgSel.selectAll('circle').each(function () {
      var cy = parseFloat(this.getAttribute('cy'));
      var cx = parseFloat(this.getAttribute('cx'));
      if (isFinite(cy) && isFinite(cx) && Math.abs(cy - CFG.AXIS.foreignY) < 0.6 && cx < CFG.W / 2) dot = this;
    });
    var dotSel = dot ? d3.select(dot).attr('class', 'cl-entry-dot') : null;
    if (dotSel) dotSel.style('cursor', 'pointer');

    function onEnter(ev) {
      if (typeof showTooltip === 'function') showTooltip(ev, '<b>外国轴 · 文明链</b>点击查看详细文明链');
    }
    function onMove(ev) { if (typeof moveTooltip === 'function') moveTooltip(ev); }
    function onLeave() { if (typeof hideTooltip === 'function') hideTooltip(); }
    function onClick(ev) { ev.stopPropagation(); toggleOpen(); }
    function stopDown(ev) { ev.stopPropagation(); }   // 别让 svg 的拖拽缩放抢走这次点击

    sel.on('mouseenter', onEnter).on('mousemove', onMove).on('mouseleave', onLeave)
       .on('mousedown', stopDown).on('click', onClick);
    if (dotSel) {
      dotSel.on('mouseenter', onEnter).on('mousemove', onMove).on('mouseleave', onLeave)
            .on('mousedown', stopDown).on('click', onClick);
    }
  }

  global.AtlasChains = {
    list: function () { return CHAINS.slice(); },
    idOf: idOf, nameOf: nameOf, colorOf: colorOf,
    isForeign: isForeign, isHidden: isHidden, isFocused: isFocused,
    getFilter: getFilter, setFilter: setFilter, toggle: toggle, showAll: showAll,
    layoutRows: layoutRows, summarize: summarize, findEra: findEra
  };
  global.AtlasLanes = {
    open: open, close: close, toggle: toggleOpen, refresh: refresh,
    ensureVisible: ensureVisible, isOpen: function () { return isOpen; },
    geometry: panelGeometry                      // 供自检脚本核对泳道布局
  };

  // 挂到 renderT1 上：主轴重绘时顺带刷新浮层（缩放/平移/动画/重置都能跟上）
  if (typeof global.renderT1 === 'function') {
    var rt1 = global.renderT1;
    global.renderT1 = function (t) {
      var r = rt1.apply(this, arguments);
      try { if (isOpen) refresh(t); } catch (e) {}
      return r;
    };
  }

  function boot() {
    try { bindAxisEntry(); } catch (e) { if (global.console) console.warn('[chains] 入口绑定失败', e); }
    // 点空白处收起浮层
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) close(); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
