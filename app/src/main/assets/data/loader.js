/* 按时代分块懒加载器 */
(function(){
  /* 2026-10-20 修复：DATA 是 <script> 顶层 const，属于「全局词法绑定」而不是 window 属性。
     但 data/foreign-events.js 的自动合并、以及本文件里判断分片事件归属，都写成 window.DATA 取数据
     → 一直取到 undefined，补写的 600 多条外国事件从未合并进时间轴（只在数据文件里）。
     这里把它显式挂到 window，作为数据层的统一入口；已存在则不覆盖。 */
  try { if (typeof DATA !== 'undefined' && DATA && !window.DATA) window.DATA = DATA; } catch (e) {}
  const RANGES = {1:[-1e9,-2070],2:[-2070,-771],3:[-771,-221],4:[-221,220],5:[220,581],6:[581,960],7:[960,1368],8:[1368,1840],9:[1840,1945],10:[1945,1e9]};
  const loaded = new Set(); const loading = {};
  const _k = n => n.replace(/[（(].*?[)）]/g,'').trim();
  function inject(i){
    return new Promise(function(res){
      let tries = 0;
      (function attempt(){
        tries++;
        const s=document.createElement('script');
        s.src='data/chunk-'+String(i).padStart(2,'0')+'.js';
        s.onload=function(){res(true);};
        s.onerror=function(){
          // 偶发失败（网络抖动 / 缓存）自动重试，最多 3 次；仍失败才放弃
          if(tries<3) setTimeout(attempt, 300*tries); else res(false);
        };
        document.head.appendChild(s);
      })();
    });
  }
  function merge(i){
    const c=(window.__ATLAS_CHUNKS||{})[String(i)]; if(!c) return;
    const exist=new Set(DATA.events.map(function(e){return _k(e.name);}));
    (c.events||[]).forEach(function(e){
      /* 2026-10-20：分片里的「外国」事件是早期底稿，内容已由 data/foreign-events.js 统一提供。
         事件改名后按名去重会失效，同一件事会出现两遍（如「胡夫金字塔（约公元前26世纪）」与「胡夫大金字塔建成」）
         → 一律跳过；但 era 实际属于中国时代的（region 被误标的「孔子与老子」等）纠正后保留。 */
      if(e.region === 'foreign'){
        var er = null, list = (window.DATA && window.DATA.eras) || [];
        for(var n=0;n<list.length;n++){ if(list[n].id === e.era){ er = list[n]; break; } }
        if(!er || er.region === 'foreign') return;
        e.region = 'china';
      }
      var kk=_k(e.name);
      if(!exist.has(kk)){ DATA.events.push(e); exist.add(kk); }
      else {
        /* 2026-10-23：同名事件此前直接跳过，导致 atlas-data.js 里的「骨架条目」（detail 为空）把分片里的完整正文挡在外面。
           改为用分片内容补全空字段，不覆盖已有非空值。 */
        var tgt = null;
        for (var q=0;q<DATA.events.length;q++){ if(_k(DATA.events[q].name)===kk){ tgt=DATA.events[q]; break; } }
        if (tgt){
          ['blurb','detail','place','figures','keywords','video','lat','lng','icon'].forEach(function(f){
            var has = tgt[f]!==undefined && tgt[f]!==null && tgt[f]!=='' && !(Array.isArray(tgt[f]) && !tgt[f].length);
            if (!has && e[f]!==undefined && e[f]!==null && e[f]!=='') tgt[f]=e[f];
          });
        }
      } });
    Object.keys(c.poi||{}).forEach(function(n){ if(!POI_MAP[n]) POI_MAP[n]=[]; POI_MAP[n]=POI_MAP[n].concat(c.poi[n]); });
  }
  function load(i){
    if(loaded.has(i)) return Promise.resolve(true);
    if(loading[i]) return loading[i];
    loading[i]=inject(i).then(function(ok){ if(ok){ merge(i); loaded.add(i);} delete loading[i]; return ok; });
    return loading[i];
  }
  function ensureForDomain(d0,d1){
    const need=[];
    for(const i in RANGES){ if(RANGES[i][1]>=d0 && RANGES[i][0]<=d1) need.push(+i); }
    const todo=need.filter(function(i){return !loaded.has(i);});
    if(!todo.length) return Promise.resolve(false);
    return Promise.all(todo.map(load)).then(function(){return true;});
  }
  function loadAll(){ return Promise.all([1,2,3,4,5,6,7,8,9,10].map(load)); }
  window.AtlasLoader={ load:load, loadAll:loadAll, ensureForDomain:ensureForDomain,
    isLoaded:function(i){return loaded.has(i);}, loadedCount:function(){return loaded.size;} };
})();
