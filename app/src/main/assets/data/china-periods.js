/* ============================================================
   data/china-periods.js — 中国轴「九大分期」总览
   ------------------------------------------------------------
   用途：中国轴左侧「中⭕️国」点开后，浮层上层的【分期色带】用它画 9 大段；
         每个朝代归属哪一段，作为「大分期」列的默认值（CSV 可覆盖）。
   说明：
     · list 的年代区间**互不重叠、首尾相接**（便于铺满时间轴画色带）。
     · assign：朝代 id → 分期 id。用于给「大分期」列提供默认值；
       未列出的朝代按「年份落在哪个区间」自动归属。
   ============================================================ */
(function (global) {
  'use strict';

  var LIST = [
    { id: 'pre-qin',  name: '先秦',        start: -1700000, end: -221,  color: '#8c5a2a' },
    { id: 'qin-han',  name: '秦汉',        start: -221,     end: 220,   color: '#8c2a1f' },
    { id: 'wei-jin',  name: '魏晋南北朝',   start: 220,      end: 581,   color: '#5a2a7a' },
    { id: 'sui-tang', name: '隋唐',        start: 581,      end: 907,   color: '#1a5a6a' },
    { id: 'song',     name: '辽宋夏金',     start: 907,      end: 1271,  color: '#2a4a8c' },
    { id: 'yuan',     name: '元',          start: 1271,     end: 1368,  color: '#3f6b3f' },
    { id: 'ming',     name: '明',          start: 1368,     end: 1644,  color: '#8a5a1f' },
    { id: 'qing',     name: '清',          start: 1644,     end: 1912,  color: '#5a3a5a' },
    { id: 'modern',   name: '近现代',       start: 1912,     end: 2026,  color: '#7a2a2a' }
  ];

  var ASSIGN = {
    prehist: 'pre-qin', legend: 'pre-qin', xia: 'pre-qin', shang: 'pre-qin',
    'w-zhou': 'pre-qin', 'e-zhou': 'pre-qin', '春秋': 'pre-qin', '战国': 'pre-qin',
    qin: 'qin-han', '楚汉之争': 'qin-han', 'w-han': 'qin-han', xin: 'qin-han', 'e-han': 'qin-han',
    '3k': 'wei-jin', jin: 'wei-jin', ns: 'wei-jin',
    sui: 'sui-tang', tang: 'sui-tang',
    '5d': 'song', 'n-song': 'song', 's-song': 'song',
    yuan: 'yuan', ming: 'ming', qing: 'qing', roc: 'modern', prc: 'modern'
  };

  global.__ATLAS_CHINA_PERIODS = { list: LIST, assign: ASSIGN };
})(typeof window !== 'undefined' ? window : globalThis);
