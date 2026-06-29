// ==UserScript==
// @name         千寻宜 MinuteStars 自动答题器 Pro
// @namespace    https://pcs.minutestars.com/
// @version      4.9.19
// @author       JIA
// @match        *://*.minutestars.com/*
// @match        *://*.xuexiqiangguo.cn/*
// @match        *://*.chaoxing.com/*
// @match        *://*.zhihuishu.com/*
// @match        *://*.zhidao.com/*
// @match        *://localhost/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      gitee.com
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================
     全局常量
  ========================================================= */
  const CFG_KEY = 'qxy_cfg_v4';
  const SCRIPT_VERSION = GM_info.script.version;

  /* =========================================================
      LZ-string 轻量级压缩（用于大数据存储优化）
      真正的 LZ77 压缩算法实现（精简版）
  ========================================================= */
  const LZString = {
    compressToBase64(input) {
      if (input == null) return '';
      const compressed = this.compress(input);
      if (compressed == null) return '';
      let output = '';
      for (let i = 0; i < compressed.length; i += 2) {
        const c = compressed.charCodeAt(i) * 256 + compressed.charCodeAt(i + 1);
        output += String.fromCharCode(c);
      }
      return btoa(output).replace(/=/g, '');
    },

    decompressFromBase64(input) {
      if (input == null) return '';
      const binary = atob(input);
      let compressed = '';
      for (let i = 0; i < binary.length; i++) {
        const c = binary.charCodeAt(i);
        compressed += String.fromCharCode(c >> 8, c & 255);
      }
      return this.decompress(compressed);
    },

    compress(input) {
      if (input == null) return '';
      const dict = {};
      const data = (input + '').split('');
      const out = [];
      let currChar, phrase = data[0], code = 256;
      for (let i = 1; i < data.length; i++) {
        currChar = data[i];
        if (dict[phrase + currChar] != null) {
          phrase += currChar;
        } else {
          out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
          dict[phrase + currChar] = code++;
          phrase = currChar;
        }
      }
      out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
      for (let i = 0; i < out.length; i++) {
        out[i] = String.fromCharCode(out[i]);
      }
      return out.join('');
    },

    decompress(input) {
      if (input == null) return '';
      const dict = {};
      const data = (input + '').split('');
      let currChar = data[0], oldPhrase = currChar, out = [currChar];
      let code = 256;
      for (let i = 1; i < data.length; i++) {
        const c = data[i].charCodeAt(0);
        let phrase;
        if (c < 256) {
          phrase = data[i];
        } else {
          phrase = dict[c] ? dict[c] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code++] = oldPhrase + currChar;
        oldPhrase = phrase;
      }
      return out.join('');
    },

    /** 压缩 JSON 字符串（返回压缩后的字符串） */
    compressJSON(jsonString) {
      return this.compress(jsonString);
    },

    /** 解压字符串（返回原始 JSON） */
    decompressJSON(compressed) {
      return this.decompress(compressed);
    }
  };

  /* =========================================================
     配置区（GM 持久化，面板可实时修改）
  ========================================================= */

  /** 默认配置 */
  const CFG_DEFAULT = {
    username:    '',
    password:    '',
    autoLogin:   false,
    autoAnswer:  true,   // 加载后自动答题
    autoSubmit:  true,   // 答完自动提交
    submitDelayMin: 20,
    submitDelayMax: 30,
    answerDelay: 120,
    fuzzyEnable: false,
    fuzzyThresh: 0.75,
    debug:       false,
    // v4.5.39 新增
    shortcutsEnable:  true,   // 快捷键（Alt+Enter答题/提交，Alt+S暂停）
    notifyEnable:     true,   // 系统通知（GM_notification）
    compressEnable:   false,  // 压缩支持（LZ-string，可减少存储占用，默认关闭）    },
    cloudSyncEnable:  true,   // 云同步开关（默认打开）
    cloudReadMode:    'cloud', // 'local'=本地存储答题（需下载），'cloud'=直读云端答题（不落地）
    cloudRepoPath:    'law-of-order/MinuteStars-AutoAnswer', // 仓库路径（owner/repo）
    cloudFilePath:    'minutestars_qa.json',       // 题库文件路径
    cloudBranch:      'main',            // 分支名
    cloudGistId:      '',     // [已废弃] 旧 Gist ID（用于迁移）
    cloudToken:       '',     // Gitee 私人令牌
    customDomains:    [],    // 自定义匹配域名（运行时生效）
  };

  /** 运行时配置（从 GM storage 恢复） */
  const CFG = (() => {
    try {
      const saved = JSON.parse(GM_getValue(CFG_KEY, '{}'));
      return Object.assign({}, CFG_DEFAULT, saved);
    } catch { return { ...CFG_DEFAULT }; }
  })();

  /** 持久化保存 CFG */
  function saveCFG() {
    try {
      GM_setValue(CFG_KEY, JSON.stringify(CFG));
      uLog('✅ 配置已写入 GM Storage', 'ok');
    } catch (e) {
      uLog('❌ 配置保存失败: ' + e.message, 'error');
      console.error('[ATA Pro] saveCFG error:', e);
    }
  }

  /* =========================================================
     答题统计（答题速度记录）
  ========================================================= */
  let _speedTimes = [];
  let _accuracyResults = []; // v4.7.0 正确率历史（1=命中，0=未命中）

  /* =========================================================
      语义去重检测（v4.7.0）
      使用 N-gram + Jaro-Winkler 检测相似题，相似度 > 0.88 视为重复
  ========================================================= */
  function semanticDedupCheck(question, db) {
    const nq = cleanText(question);
    if (!nq || nq.length < 4) return null; // 太短无法判断
    const nqLen = nq.length;
    let bestMatch = null, bestSim = 0;
    for (const existingQ of Object.keys(db)) {
      const ck = cleanText(existingQ);
      if (!ck || Math.abs(ck.length - nqLen) > Math.max(ck.length, nqLen) * 0.5) continue;
      const sim = strSim(nq, ck);
      if (sim > bestSim) { bestSim = sim; bestMatch = existingQ; }
      if (sim > 0.95) break; // 几乎完全相同，提前退出
    }
    return bestSim > 0.88 ? bestMatch : null;
  }

  /* =========================================================
      正确率趋势图（v4.7.0）
      追踪每题命中情况，Canvas 绘制最近 50 题正确率折线
  ========================================================= */
  const ACC_HISTORY_MAX = 50;
  function updateAccuracyHistory(matched) {
    _accuracyResults.push(matched ? 1 : 0);
    if (_accuracyResults.length > ACC_HISTORY_MAX) _accuracyResults.shift();
    const wrap = document.getElementById('ata-acc-wrap');
    if (wrap) wrap.style.display = '';
    drawAccuracyChart();
  }
  function drawAccuracyChart() {
    const canvas = document.getElementById('ata-acc-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const len = _accuracyResults.length;
    if (len < 2) {
      // 不足2条，显示占位
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText('答题后显示趋势', 8, H / 2 + 4);
      return;
    }
    // 计算滚动正确率（窗口=10）
    const windowSize = Math.min(10, len);
    const points = [];
    for (let i = 0; i < len; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = _accuracyResults.slice(start, i + 1);
      const rate = slice.reduce((a, b) => a + b, 0) / slice.length;
      points.push(rate);
    }
    // 绘制
    const padL = 4, padR = 4, padT = 6, padB = 14;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    // 背景网格线（可选）
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (1 - i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }
    // 折线
    ctx.beginPath();
    ctx.strokeStyle = '#5a8dee';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 0; i < points.length; i++) {
      const x = padL + (i / (points.length - 1 || 1)) * plotW;
      const y = padT + (1 - points[i]) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 当前正确率
    const curRate = points[points.length - 1];
    const avgRate = _accuracyResults.reduce((a, b) => a + b, 0) / len;
    const avgEl = document.getElementById('ata-acc-avg');
    if (avgEl) avgEl.textContent = '正确率 ' + (curRate * 100).toFixed(0) + '% (均 ' + (avgRate * 100).toFixed(0) + '%)';
  }

  /* =========================================================
     题库管理器（GM_setValue 持久化，跨会话保存用户自定义题库）
  ========================================================= */
  const DB_KEY = 'qxy_merged_v4';
  const SOURCE_KEY = 'qxy_source_v4';  // 题目来源追踪：questionText → 'cloud'|'local'
  let _sourceMap = {};
  let _cache = { raw: null, dirty: true, userCount: 0, dirtyKeys: new Set(), cleanMap: new Map(), ngramIndex: new Map(), lenBuckets: new Map() };

  const LibraryManager = {
    /** 同步读取内存缓存（优先），失败时从存储加载 */
    load() {
      if (_cache.raw && typeof _cache.raw === 'object') return _cache.raw;
      try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; }
    },
    /** 异步从存储加载数据到内存（_cache.raw） */
    async reload() {
      const data = await StorageManager.get(DB_KEY);
      _cache.raw = data || {};
      _sourceMap = await StorageManager.get(SOURCE_KEY) || {};
      // 同步备份到 GM_setValue，确保 load() 能立即读到（无需等待异步）
      try { GM_setValue(DB_KEY, JSON.stringify(_cache.raw)); } catch(e) {}
      try { GM_setValue(SOURCE_KEY, JSON.stringify(_sourceMap)); } catch(e) {}
      _cache.dirty = true;
      return _cache.raw;
    },
    /** 异步保存（自动选后端），并刷新内存缓存 */
    async save(db) {
      await StorageManager.set(DB_KEY, db);
      await StorageManager.set(SOURCE_KEY, _sourceMap || {});
      // 同步备份到 GM_setValue，确保刷新后 load() 能立即读到（无需等待异步 reload）
      try { GM_setValue(DB_KEY, JSON.stringify(db)); } catch(e) {}
      try { GM_setValue(SOURCE_KEY, JSON.stringify(_sourceMap || {})); } catch(e) {}
      _cache.raw = db;
    },
    get count() { return _cache.dirty ? Object.keys(this.load()).length : _cache.userCount; },

    async add(question, answer, source = 'local') {
      const db = await this.reload();
      // v4.7.0 语义去重：检测相似题（N-gram + Jaro-Winkler）
      const dup = semanticDedupCheck(question, db);
      if (dup) {
        uLog('⚡ 语义去重跳过：与现有题目相似度 > 0.88（' + dup.substring(0, 30) + '...）', 'info');
        return { skipped: true, similarTo: dup };
      }
      db[question] = answer;
      this.setSource(question, source);
      await this.save(db);
      _cache.dirty = true;
      return db;
    },

    async addBulk(text, source = 'local') {
      const db = await this.reload();
      let added = 0, skipped = 0;
      const duplicates = [];
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        let q = '', a = '';
        if (line.startsWith('{')) {
          try {
            const obj = JSON.parse(line);
            if (typeof obj === 'object' && !Array.isArray(obj)) {
              for (const [k, v] of Object.entries(obj)) { q = k; a = v; break; }
            }
          } catch {}
        }
        if (!q) {
          const idx1 = line.indexOf('||');
          const idx2 = line.indexOf('|');
          if (idx1 !== -1) { q = line.substring(0, idx1).trim(); a = line.substring(idx1 + 2).trim(); }
          else if (idx2 !== -1) { q = line.substring(0, idx2).trim(); a = line.substring(idx2 + 1).trim(); }
        }
        if (q && a) {
          if (db.hasOwnProperty(q)) {
            duplicates.push({ q, oldAns: db[q], newAns: a, type: 'exact' });
          } else {
            // v4.7.0 语义去重：检测相似题
            const simDup = semanticDedupCheck(q, db);
            if (simDup) {
              duplicates.push({ q, oldAns: db[simDup], newAns: a, type: 'semantic', similarTo: simDup });
              skipped++;
              continue;
            }
          }
          db[q] = a;
          this.setSource(q, source); added++;
        } else skipped++;
      }
      await this.save(db);
      _cache.dirty = true;
      Object.keys(db).slice(-added).forEach(k => _cache.dirtyKeys?.add(k));
      return { added, skipped, duplicates };
    },

    async remove(question) {
      const db = await this.reload();
      delete db[question];
      this.removeSource(question);
      await this.save(db);
      _cache.dirty = true;
      _cache.dirtyKeys?.add(question);
    },

    async clear() { await StorageManager.remove(DB_KEY); await StorageManager.remove(SOURCE_KEY); _cache.raw = {}; _sourceMap = {}; _cache.dirty = true; _cache.dirtyKeys?.clear(); },

    async exportJSON() { const db = await this.reload(); return JSON.stringify(db, null, 2); },
    async exportTXT() { const db = await this.reload(); return Object.entries(db).map(([q, a]) => q + '||' + a).join('\n'); },

    /** 设置单题来源（'cloud'|'local'） */
    setSource(question, source) {
      if (!_sourceMap) _sourceMap = {};
      _sourceMap[question] = source;
    },

    /** 移除单题来源记录 */
    removeSource(question) {
      if (_sourceMap) delete _sourceMap[question];
    },

    /** 统计来源分布，返回 { cloud, local }
     *  本地题库 = 本地存储里的题（本地导入 + 从云端下载到本地的）
     *  云端题库 = 直读云端且不在本地存储的题（仅 cloudReadMode 时存在）
     *  注意：必须直接读 GM_getValue，不能用 this.load()，因为云端模式下缓存已合并云端数据
     */
    getSourceStats() {
      const localDB = (() => { try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; } })();
      let stats = { local: Object.keys(localDB).length, cloud: 0 };
      if (CFG.cloudReadMode === 'cloud' && _cloudCache) {
        // 统计仅在云端缓存中、但不在本地存储的题目
        stats.cloud = Object.keys(_cloudCache).filter(q => !localDB.hasOwnProperty(q)).length;
      }
      return stats;
    },
  };

  /* =========================================================
      StorageManager — 存储抽象层（v4.6.0）
      小数据(≤1MB) → GM_setValue，大数据(>1MB) → IndexedDB
  ========================================================= */
  const StorageManager = {
    DB_NAME:    'ata_qa_db',
    STORE_NAME: 'qa_store',
    THRESHOLD:  1 * 1024 * 1024, // 1MB
    VERSION:     2, // 数据版本号

    /* ========== 1. IndexedDB 可用性检测 ========== */
    _idbSupported: null, // 缓存检测结果

    _checkIDBSupport() {
      if (this._idbSupported !== null) return this._idbSupported;
      try {
        this._idbSupported = !!(window.indexedDB && typeof indexedDB.open === 'function');
      } catch {
        this._idbSupported = false;
      }
      return this._idbSupported;
    },

    /* ========== 2. 打开 IndexedDB 连接（带版本管理） ========== */
    _openIDB() {
      return new Promise((resolve, reject) => {
        if (!this._checkIDBSupport()) {
          reject(new Error('IndexedDB not supported'));
          return;
        }
        const req = indexedDB.open(this.DB_NAME, this.VERSION);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror    = () => reject(req.error);
      });
    },

    /* ========== 3. 判断存储后端 ========== */
    _getBackend(key) {
      return GM_getValue(key + '__backend', 'gm');
    },

    /* ========== 4. 判断是否应使用 IndexedDB ========== */
    _shouldUseIDB(jsonString) {
      return jsonString.length > this.THRESHOLD;
    },

    /* ========== 5. 压缩/解压（LZ-string） ========== */
    _compress(data) {
      try {
        const json = typeof data === 'string' ? data : JSON.stringify(data);
        return LZString.compressToBase64(json);
      } catch (e) {
        uLog('⚠ 压缩失败: ' + e.message, 'warn');
        return null;
      }
    },

    _decompress(compressed) {
      try {
        return LZString.decompressFromBase64(compressed);
      } catch (e) {
        uLog('⚠ 解压失败: ' + e.message, 'warn');
        return null;
      }
    },

    /* ========== 6. 从 GM_setValue 迁移到 IndexedDB ========== */
    async migrateToIDB(key) {
      try {
        const raw = GM_getValue(key, '{}');
        const data = JSON.parse(raw);
        await this.idbSetAll(data);
        GM_setValue(key + '__backend', 'idb');
        uLog('✅ 已迁移 ' + Object.keys(data).length + ' 条数据到 IndexedDB', 'ok');
        return true;
      } catch (e) {
        uLog('⚠ 迁移到 IndexedDB 失败: ' + e.message, 'warn');
        return false;
      }
    },

    /* ========== 7. 从 IndexedDB 迁移到 GM_setValue（降级） ========== */
    async migrateToGM(key) {
      try {
        const data = await this.idbGetAll();
        const json = JSON.stringify(data);
        if (json.length <= this.THRESHOLD) {
          GM_setValue(key, json);
          GM_setValue(key + '__backend', 'gm');
          await this.idbClear();
          uLog('✅ 已迁移 ' + Object.keys(data).length + ' 条数据到 GM_setValue', 'ok');
          return true;
        } else {
          uLog('⚠ 数据过大（' + (json.length / 1024 / 1024).toFixed(1) + 'MB），无法迁移到 GM_setValue', 'warn');
          return false;
        }
      } catch (e) {
        uLog('⚠ 迁移到 GM_setValue 失败: ' + e.message, 'warn');
        return false;
      }
    },

    /* ========== 8. IndexedDB 读取单条 ========== */
    async idbGet(key) {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req   = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    },

    /* ========== 9. IndexedDB 写入单条 ========== */
    async idbSet(key, value) {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req   = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
        tx.oncomplete = () => { db.close(); resolve(); };
      });
    },

    /* ========== 10. IndexedDB 批量读取（性能优化：游标 + 批量） ========== */
    async idbGetAll() {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx     = db.transaction(this.STORE_NAME, 'readonly');
        const store  = tx.objectStore(this.STORE_NAME);
        const result = {};
        let count    = 0;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) {
            result[cursor.key] = cursor.value;
            count++;
            cursor.continue();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    },

    /* ========== 11. IndexedDB 批量写入（性能优化：单次事务） ========== */
    async idbSetAll(data) {
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.clear();
        let processed = 0;
        const total = Object.keys(data).length;
        for (const [k, v] of Object.entries(data)) {
          store.put(v, k);
          processed++;
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    },

    /* ========== 12. 清空 IndexedDB ========== */
    async idbClear() {
      if (!this._checkIDBSupport()) return;
      const db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); reject(tx.error); };
      });
    },

    /* ========== 13. 主入口：读取数据（自动选择后端 + 版本管理 + 解压） ========== */
    async get(key) {
      const backend = this._getBackend(key);

      // 尝试从 IndexedDB 读取
      if (backend === 'idb' && this._checkIDBSupport()) {
        try {
          const data = await this.idbGetAll();
          uLog('📦 从 IndexedDB 读取（' + Object.keys(data).length + ' 条）', 'ok');
          // 解压（如果有压缩标记）
          if (data.__compressed) {
            const decompressed = LZString.decompressFromBase64(data.data);
            return JSON.parse(decompressed);
          }
          return data;
        } catch (e) {
          uLog('⚠ IndexedDB 读取失败，降级到 GM_setValue: ' + e.message, 'warn');
          // 降级：切换后端到 GM
          GM_setValue(key + '__backend', 'gm');
        }
      }

      // 从 GM_setValue 读取（默认 + 降级）
      try {
        const raw = GM_getValue(key, '{}');
        const data = JSON.parse(raw);

        // 解压（如果有压缩标记）
        if (data.__compressed) {
          const decompressed = LZString.decompressFromBase64(data.data);
          const result = JSON.parse(decompressed);
          
          // 自动迁移：如果数据过大，迁移到 IndexedDB
          if (this._checkIDBSupport() && this._shouldUseIDB(decompressed)) {
            uLog('📦 检测到大数据，自动迁移到 IndexedDB...', 'info');
            await this.idbSetAll(result);
            GM_setValue(key + '__backend', 'idb');
            return result;
          }
          
          return result;
        }

        // 自动迁移：如果数据过大，迁移到 IndexedDB
        if (this._checkIDBSupport() && this._shouldUseIDB(raw)) {
          uLog('📦 检测到大数据，自动迁移到 IndexedDB...', 'info');
          await this.idbSetAll(data);
          GM_setValue(key + '__backend', 'idb');
          return data;
        }

        return data;
      } catch (e) {
        uLog('⚠ GM_setValue 读取失败: ' + e.message, 'warn');
        return {};
      }
    },

    /* ========== 14. 主入口：写入数据（自动选择后端 + 压缩） ========== */
    async set(key, value) {
      const json = JSON.stringify(value);

      // 尝试压缩（如果启用）
      let dataToStore = value;
      let isCompressed = false;
      if (CFG.compressEnable) {
        const compressed = LZString.compressToBase64(json);
        if (compressed && compressed.length < json.length) {
          dataToStore = { __compressed: true, data: compressed };
          isCompressed = true;
          uLog('📦 数据已压缩：' + json.length + ' → ' + compressed.length + ' 字节', 'info');
        }
      }

      // 大数据：存 IndexedDB
      const sizeToCheck = isCompressed ? JSON.stringify(dataToStore).length : json.length;
      if (this._checkIDBSupport() && this._shouldUseIDB(sizeToCheck)) {
        try {
          await this.idbSetAll(dataToStore);
          GM_setValue(key + '__backend', 'idb');
          uLog('📦 已存储到 IndexedDB（' + (sizeToCheck / 1024 / 1024).toFixed(1) + 'MB）', 'ok');
        } catch (e) {
          uLog('⚠ IndexedDB 写入失败，降级到 GM_setValue: ' + e.message, 'warn');
          GM_setValue(key, JSON.stringify(dataToStore));
          GM_setValue(key + '__backend', 'gm');
        }
        return;
      }

      // 小数据：存 GM_setValue
      try {
        GM_setValue(key, JSON.stringify(dataToStore));
        GM_setValue(key + '__backend', 'gm');
      } catch (e) {
        uLog('⚠ GM_setValue 写入失败: ' + e.message, 'warn');
        // 如果 GM 也失败，尝试 IndexedDB
        if (this._checkIDBSupport()) {
          try {
            await this.idbSetAll(dataToStore);
            GM_setValue(key + '__backend', 'idb');
            uLog('📦 已降级存储到 IndexedDB', 'ok');
          } catch (e2) {
            uLog('❌ 所有存储后端均失败', 'error');
          }
        }
      }
    },

    /* ========== 15. 移除数据（两个后端都清理） ========== */
    async remove(key) {
      GM_setValue(key, '{}');
      GM_setValue(key + '__backend', 'gm');
      if (this._checkIDBSupport()) {
        try { await this.idbClear(); } catch {}
      }
    },

    /* ========== 16. 获取存储统计信息 ========== */
    async getStorageInfo(key) {
      const backend = this._getBackend(key);
      const info = { backend, supported: this._checkIDBSupport() };

      if (backend === 'idb' && this._checkIDBSupport()) {
        try {
          const data = await this.idbGetAll();
          info.count = Object.keys(data).length;
          info.size  = JSON.stringify(data).length;
        } catch {
          info.count = 0;
          info.size  = 0;
        }
      } else {
        try {
          const raw = GM_getValue(key, '{}');
          const data = JSON.parse(raw);
          info.count = Object.keys(data).length;
          info.size  = raw.length;
        } catch {
          info.count = 0;
          info.size  = 0;
        }
      }

      info.sizeMB = (info.size / 1024 / 1024).toFixed(2);
      return info;
    }
  };

  
  /** 直读云端模式：内存缓存 + 最后拉取时间 */
  let _cloudCache = null;
  let _cloudCacheTime = 0;
  const _CLOUD_CACHE_TTL = 5 * 60 * 1000; // 5 分钟 TTL，过期则重新拉取

  /** 直读云端：从仓库拉取题库到内存（不落地本地） */
  async function fetchCloudDB() {
    const now = Date.now();
    if (_cloudCache && (now - _cloudCacheTime) < _CLOUD_CACHE_TTL) return _cloudCache;
    if (!CFG.cloudSyncEnable) return null;
    try {
      const raw = await _readRepoFile(CFG.cloudFilePath);
      _cloudCache = JSON.parse(raw);
      _cloudCacheTime = now;
      uLog('☁ 云端题库已加载（' + Object.keys(_cloudCache).length + ' 条，有效期 5 分钟）', 'ok');
      // 立即重建缓存，使云端题目生效
      _cache.dirty = true;
      rebuildCache();
      // 更新 UI 统计和数字
      refreshLibCount();
      refreshStats();
      return _cloudCache;
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('文件不存在') || msg.includes('不存在')) {
        uLog('☁ 云端题库为空（文件未创建），使用本地题库', 'warn');
      } else {
        uLog('❌ 云端题库拉取失败: ' + msg, 'err');
      }
      return null;
    }
  }

  /** 将字符串切分为 2-gram 集合（中文按字符，英文按单词） */
  function _ngrams(text, n = 2) {
    const set = new Set();
    for (let i = 0; i <= text.length - n; i++) set.add(text.substring(i, i + n));
    return set;
  }

  /** 长度桶：0-15 → 0，16-30 → 1，31-50 → 2，51-80 → 3，81+ → 4 */
  function _lenBucket(len) {
    if (len <= 15)  return 0;
    if (len <= 30)  return 1;
    if (len <= 50)  return 2;
    if (len <= 80)  return 3;
    return 4;
  }

  let _rebuilding = false;
  function rebuildCache() {
    if (_rebuilding) return; // 防止并发重建
    _rebuilding = true;
    let userDB;
    if (CFG.cloudReadMode === 'cloud') {
      // 云端模式：合并本地题库 + 云端缓存（云端优先）
      const localDB = (() => { try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; } })();
      userDB = { ...localDB, ...(_cloudCache || {}) };
    } else {
      // 本地模式：从内存缓存读取（若未初始化则触发一次异步加载）
      if (!_cache.raw || typeof _cache.raw !== 'object') {
        // 同步路径：尝试从 GM 直接读取（兼容无 IndexedDB 环境）
        try { _cache.raw = JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { _cache.raw = {}; }
      }
      userDB = _cache.raw || {};
    }
    const raw = { ...userDB };

    // 增量更新：若有 dirtyKeys 且缓存已存在，则只更新变更部分
    if (_cache.cleanMap && _cache.dirtyKeys?.size > 0 && _cache.dirtyKeys?.size < 50) {
      for (const k of _cache.dirtyKeys) {
        const ck = cleanText(k);
        const v = raw[k];
        // 从旧索引中移除
        if (_cache.cleanMap.has(ck)) {
          for (const ng of _ngrams(ck, 2)) {
            _cache.ngramIndex.get(ng)?.delete(ck);
          }
          const bucket = _lenBucket(ck.length);
          const bucketArr = _cache.lenBuckets.get(bucket);
          if (bucketArr) {
            const idx = bucketArr.findIndex(e => e.ck === ck);
            if (idx !== -1) bucketArr.splice(idx, 1);
          }
          _cache.cleanMap.delete(ck);
        }
        // 新增/更新
        if (v !== undefined) {
          _cache.cleanMap.set(ck, { orig: k, ans: v, ck });
          for (const ng of _ngrams(ck, 2)) {
            if (!_cache.ngramIndex.has(ng)) _cache.ngramIndex.set(ng, new Set());
            _cache.ngramIndex.get(ng).add(ck);
          }
          const bucket = _lenBucket(ck.length);
          if (!_cache.lenBuckets.has(bucket)) _cache.lenBuckets.set(bucket, []);
          _cache.lenBuckets.get(bucket).push({ ck, orig: k, ans: v });
        }
      }
      _cache.raw = raw;
      _cache.dirtyKeys?.clear();
      _cache.dirty = false;
      _cache.userCount = Object.keys(userDB).length;
      _rebuilding = false;
      return;
    }

    // 全量重建
    const cleanMap = new Map();
    const ngramIndex = new Map();
    const lenBuckets = new Map();

    for (const [k, v] of Object.entries(raw)) {
      const ck = cleanText(k);
      cleanMap.set(ck, { orig: k, ans: v, ck });
      for (const ng of _ngrams(ck, 2)) {
        if (!ngramIndex.has(ng)) ngramIndex.set(ng, new Set());
        ngramIndex.get(ng).add(ck);
      }
      const bucket = _lenBucket(ck.length);
      if (!lenBuckets.has(bucket)) lenBuckets.set(bucket, []);
      lenBuckets.get(bucket).push({ ck, orig: k, ans: v });
    }

    _cache.raw = raw;
    _cache.cleanMap = cleanMap;
    _cache.ngramIndex = ngramIndex;
    _cache.lenBuckets = lenBuckets;
    _cache.dirty = false;
    _cache.dirtyKeys?.clear();
    _cache.userCount = Object.keys(userDB).length;
    _rebuilding = false;
  }
  function getMergedCache() {
    if (_cache.dirty) rebuildCache();
    return _cache;
  }
  // 兼容旧接口（返回原始合并对象，供 refreshStats / export 等使用）
  function getMergedDB() {
    return getMergedCache().raw;
  }

  /* =========================================================
     文本归一化 & 匹配
  ========================================================= */
  const _cleanTextCache = new Map();
  function cleanText(text) {
    if (!text) return '';
    if (_cleanTextCache.has(text)) return _cleanTextCache.get(text);
    const result = text.trim()
      .replace(/^\d+[\.\、．]\s*/, '')
      .replace(/\(\d+分?\)/g, '')
      .replace(/\s+/g, '')
      .replace(/[\p{P}\p{S}]+/gu, '')
      .toLowerCase();
    if (_cleanTextCache.size >= 2000) _cleanTextCache.delete(_cleanTextCache.keys().next().value);
    _cleanTextCache.set(text, result);
    return result;
  }

  /** Jaro-Winkler 相似度（0~1）
   *  ⚡ v4.5.39：替换 Levenshtein，对中文近形字更敏感，开头相同权重更高
   *  参考：https://github.com/nickfinger/jaro-winkler（简化版，优化内存）
   */
  function jaroWinkler(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    let la = a.length, lb = b.length;
    if (la > lb) { [a, b] = [b, a]; [la, lb] = [lb, la]; }
    const matchDist = Math.floor(lb / 2) - 1;
    if (matchDist < 0) return 0;

    const matches = new Array(la).fill(false);
    const transpositions = [];

    // 找匹配
    let m = 0;
    for (let i = 0; i < la; i++) {
      const start = Math.max(0, i - matchDist);
      const end   = Math.min(i + matchDist + 1, lb);
      for (let j = start; j < end; j++) {
        if (matches[j] || a[i] !== b[j]) continue;
        matches[j] = true; m++;
        if (i !== j) transpositions.push(i);
        break;
      }
    }
    if (m === 0) return 0;

    // 移位匹配数
    let t = 0;
    for (const i of transpositions) for (const j of transpositions) {
      if (i < j && a[i] === b[j]) { t++; break; }
    }

    const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;

    // Winkler 前缀加成（最多 4 个字符，权重 0.1）
    let prefix = 0;
    for (let i = 0; i < Math.min(4, la, lb); i++) {
      if (a[i] === b[i]) prefix++; else break;
    }
    return Math.min(1, jaro + prefix * 0.1 * (1 - jaro));
  }

  /** 混合相似度：Jaro-Winkler 为主，结合长度惩罚
   *  ⚡ v4.5.39：中文题目中"Jaro-Winkler + 长度过滤"比纯 Levenshtein 效果更好
   */
  /**
   * LRU 匹配缓存（v4.8.0 Phase3 性能优化）
   * 缓存最近 500 条匹配结果，避免重复计算
   */
  const MatchCache = {
    maxSize: 500,
    cache: new Map(),  // key: cleanText(q), value: { ans, sim }
    get(q) {
      const key = typeof q === 'string' ? q : '';
      if (this.cache.has(key)) {
        // 移到末尾（最近使用）
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
      }
      return null;
    },
    set(q, ans, sim) {
      const key = typeof q === 'string' ? q : '';
      if (this.cache.has(key)) this.cache.delete(key);
      else if (this.cache.size >= this.maxSize) {
        // 删除最久未使用的（Map 的第一个 key）
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(key, { ans, sim });
    },
    clear() { this.cache.clear(); }
  };

  function strSim(a, b) {
    if (!a || !b) return 0;
    const la = a.length, lb = b.length;
    // 长度差距过大直接排除（Jaro-Winkler 自带长度惩罚，这里再加一层粗筛）
    if (Math.abs(la - lb) > Math.max(la, lb) * 0.5) return 0;
    return jaroWinkler(a, b);
  }

  /** N-gram 候选预筛选：返回可能匹配的 cleanKey 集合
   *  ⚡ v4.5.39：用 2-gram 交集过滤，大幅减少 strSim 调用次数
   */
  function _ngramCandidates(nq) {
    const { ngramIndex } = getMergedCache();
    const ngSet = _ngrams(nq, 2);
    if (ngSet.size === 0) return null; // 无 N-gram，退化为全量

    // 取交集：query 的每个 2-gram 对应的题库 key 集合的并集
    const candidates = new Set();
    for (const ng of ngSet) {
      const bucket = ngramIndex.get(ng);
      if (bucket) for (const ck of bucket) candidates.add(ck);
    }
    return candidates.size > 0 ? candidates : null;
  }

  /** requestIdleCallback 分帧执行（兼容无支持的环境 fallback setTimeout）
   *  ⚡ v4.5.39：大批量题库遍历时分帧，防止卡顿主线程
   */
  function _idleWrap(fn, onProgress) {
    return new Promise(resolve => {
      const deadline = { timeRemaining: () => 16, didTimeout: false };
      const _run = () => {
        const r = fn(deadline);
        if (r === false) { // 返回 false 表示未完成，需要继续
          requestIdleCallback ? requestIdleCallback(_run, { timeout: 500 }) : setTimeout(_run, 20);
        } else {
          resolve(r);
        }
      };
      requestIdleCallback ? requestIdleCallback(_run, { timeout: 1000 }) : setTimeout(_run, 0);
    });
  }

  /** 精确 + 模糊双重匹配，返回答案字符串或 null
   *  ⚡ v4.5.39：
   *    - 精确匹配走 Map.get() → O(1)
   *    - N-gram 预筛选候选集
   *    - 长度分桶过滤
   *    - requestIdleCallback 分帧模糊匹配
   */
  function findMatch(qText) {
    const { cleanMap, lenBuckets } = getMergedCache();
    const nq = cleanText(qText);

    // ── LRU 缓存检查 ──
    const cached = MatchCache.get(nq);
    if (cached) {
      CFG.debug && console.log('[Match] Cache hit:', nq.substring(0,30), '->', cached.ans);
      return cached.ans;
    }

    // ── 精确匹配 O(1) ──
    let entry = cleanMap.get(nq) || cleanMap.get(nq.replace(/[?？]$/, ''));
    if (entry) {
      MatchCache.set(nq, entry.ans, 1.0);
      CFG.debug && console.log('[Match] 精确:', entry.orig.substring(0,40), '->', entry.ans);
      return entry.ans;
    }

    if (!CFG.fuzzyEnable) return null;

    // ── 模糊匹配：N-gram 候选预筛选 + 长度分桶 ──
    const nqLen = nq.length;
    const qBucket = _lenBucket(nqLen);
    const relevantBuckets = [qBucket - 1, qBucket, qBucket + 1].filter(
      b => b >= 0 && lenBuckets.has(b)
    );

    const candidates = _ngramCandidates(nq);
    let best = null, bestSim = 0;
    let processed = 0;

    for (const bucket of relevantBuckets) {
      for (const { ck, orig, ans } of lenBuckets.get(bucket)) {
        if (candidates && !candidates.has(ck)) continue;
        processed++;
        const sim = strSim(nq, ck);
        if (sim >= CFG.fuzzyThresh && sim > bestSim) { best = ans; bestSim = sim; }
      }
    }

    if (best) MatchCache.set(nq, best, bestSim);
    CFG.debug && console.log('[Match] 模糊(' + bestSim.toFixed(2) + ') 候选' + processed + '条:', best);
    return best;
  }

  /* =========================================================
     规则推断引擎（无题库命中时的智能兜底）
  ========================================================= */
  function ruleInfer(qText, inputs) {
    /**
     * 取选项文本（兼容 MinuteStars label 包裹 input 的 DOM 结构）
     */
    const getOptText = i => {
      const label = i.closest('label') || i.parentElement;
      return label ? label.textContent.replace(/\s+/g, ' ').trim() : (i.value || '');
    };
    const texts = inputs.map(getOptText);

    // ── 判断题识别（只有两个选项，分别为 对/错）──────────────────────
    const isJudge = inputs.length === 2 && (
      texts.some(t => /^[A-D]?\.\s*(对|正确|是|√|true)$/i.test(t) || t === '对' || t === '正确') &&
      texts.some(t => /^[A-D]?\.\s*(错|错误|否|×|false)$/i.test(t) || t === '错' || t === '错误')
    );
    if (isJudge) {
      const negWords = ['不能','不是','不得','不应','不正确','不合法','错误','不允许','不需要','不必须','不可以','不会'];
      return negWords.some(w => qText.includes(w)) ? 'false' : 'true';
    }

    // ── 单选：选项含"以上都是/以上都对/全部"且题目问"正确" ────────────
    if (inputs.length > 0 && inputs[0].type === 'radio') {
      const allAboveIdx = texts.findIndex(t => t.includes('以上都') || t.includes('全部正确') || t.includes('全部以上'));
      if (allAboveIdx !== -1 && /正确|对的/.test(qText)) return String.fromCharCode(65 + allAboveIdx);
      // 反向：题目问"错误"且有"以上都不"选项
      const noneIdx = texts.findIndex(t => t.includes('以上都不') || t.includes('全都不'));
      if (noneIdx !== -1 && /错误|不正确/.test(qText)) return String.fromCharCode(65 + noneIdx);
    }

    return null;
  }

  /* =========================================================
     工具函数
  ========================================================= */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  // ⚡ DOM 元素缓存（面板创建后一次性查询，避免答题循环中每题重复查询）
  const _elCache = {};
  const $c = sel => _elCache[sel] || (_elCache[sel] = document.querySelector(sel));
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* =========================================================
     GM_notification 封装（兼容不支持的环境）
  ========================================================= */
  function gmNotify(title, text) {
    if (!CFG.notifyEnable) return;
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title, text, timeout: 4000 });
      } else if (typeof GM_setClipboard === 'function') {
        // fallback: 静默忽略，不打扰用户
      }
    } catch (e) { /* 静默 */ }
  }

  /* =========================================================
     答题报告（用于导出 JSON/CSV）
  ========================================================= */
  /** 记录本次答题结果 */
  const _answerLog = []; // [{q, matched, answer, method}]
  function _logAnswer(q, answer, method) {
    _answerLog.push({ q: q.substring(0, 100), answer, method, time: Date.now() });
  }
  function _clearAnswerLog() { _answerLog.length = 0; }

  /** 导出答题报告 */
  function exportAnswerReport(format) {
    const total = _answerLog.length;
    const matched = _answerLog.filter(e => e.answer !== null).length;
    const byMethod = {};
    _answerLog.forEach(e => { byMethod[e.method] = (byMethod[e.method] || 0) + 1; });
    const meta = {
      version: SCRIPT_VERSION,
      url: location.href,
      timestamp: new Date().toISOString(),
      total, matched, hitRate: total > 0 ? (matched / total * 100).toFixed(1) + '%' : '0%',
      byMethod,
    };
    if (format === 'csv') {
      const header = '题目,答案,匹配方式,时间戳\n';
      const rows = _answerLog.map(e =>
        `"${e.q.replace(/"/g,'""')}","${e.answer || ''}","${e.method}","${new Date(e.time).toLocaleString()}"`
      ).join('\n');
      return header + rows;
    }
    return JSON.stringify({ ...meta, entries: _answerLog }, null, 2);
  }


  /* =========================================================
      Gitee 仓库文件云同步（v4.8.51 从 Gist 迁移）
     ⚡ 公开可分享、国内网络快、读免认证
  ========================================================= */

  /** 构建 Gitee 仓库 Raw URL（公开访问，免认证） */
  function repoRawUrl(filePath) {
    return `https://gitee.com/${CFG.cloudRepoPath}/raw/${CFG.cloudBranch}/${filePath}`;
  }

  /** 构建 Gitee 仓库 API URL（读/写需要 Token） */
  function repoApiUrl(filePath) {
    return `https://gitee.com/api/v5/repos/${CFG.cloudRepoPath}/contents/${encodeURIComponent(filePath)}`;
  }

  /** 读取仓库文件内容（优先免认证 raw 链接，回退 API） */
  async function _readRepoFile(filePath) {
    const rawUrl = repoRawUrl(filePath);
    uLog('📡 读取仓库文件: ' + rawUrl, 'info');
    // 先尝试免认证 raw 链接
    try {
      return await _cloudReq('GET', rawUrl);
    } catch {
      // raw 链接失败（404/401等），检查是否有 Token 可用
      if (!CFG.cloudToken) {
        throw new Error('题库文件不存在（需先用 Token 上传一次）');
      }
      uLog('⚠️ raw 链接失败，尝试 API 读取', 'warn');
      // 回退到 API（需要 Token）
      try {
        const apiUrl = repoApiUrl(filePath) + '?access_token=' + CFG.cloudToken;
        const resp = await _cloudReq('GET', apiUrl);
        const data = JSON.parse(resp);
        if (data.content) {
          // 正确解码 UTF-8 Base64 内容（atob 无法直接处理中文）
          const rawBytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
          return new TextDecoder('utf-8').decode(rawBytes);
        }
        throw new Error('仓库文件为空');
      } catch (apiErr) {
        const msg = apiErr.message || '';
        if (msg.includes('projects') || msg.includes('scope')) {
          throw new Error('Token 缺少 projects 权限，请重新生成 Token（勾选 projects）');
        }
        throw apiErr;
      }
    }
  }

  /** 写入仓库文件（始终需要 Token） */
  async function _writeRepoFile(filePath, content, message) {
    const apiBase = repoApiUrl(filePath);
    const authParam = 'access_token=' + CFG.cloudToken;
    // 先获取现有文件的 sha（用于更新）
    let sha = '';
    try {
      const apiGetUrl = apiBase + '?' + authParam;
      const resp = await _cloudReq('GET', apiGetUrl);
      const data = JSON.parse(resp);
      sha = data.sha || '';
    } catch { /* 文件不存在，创建新文件 */ }

    const payload = JSON.stringify({
      content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
      message: message,
      branch: CFG.cloudBranch,
      ...(sha ? { sha } : {}),
    });

    // 新文件用 POST，已有文件用 PUT（都需要 sha）
    const method = sha ? 'PUT' : 'POST';
    const apiUrl = apiBase + '?' + authParam;
    uLog('📤 写入仓库文件: ' + filePath + ' (' + method + ')' + (sha ? ' 更新' : ' 新建'), 'info');
    return _cloudReq(method, apiUrl, payload);
  }

  /** 删除仓库文件 */
  async function _deleteRepoFile(filePath) {
    const apiBase = repoApiUrl(filePath);
    const authParam = 'access_token=' + CFG.cloudToken;
    // 先获取 sha
    const apiGetUrl = apiBase + '?' + authParam;
    const resp = await _cloudReq('GET', apiGetUrl);
    const data = JSON.parse(resp);
    if (!data.sha) throw new Error('文件不存在');
    const delUrl = apiBase + '?' + authParam + '&sha=' + data.sha;
    uLog('🗑 删除仓库文件: ' + filePath, 'info');
    return _cloudReq('DELETE', delUrl);
  }

  /** 删除云端题库文件 */
  async function cloudDelete() {
    if (!CFG.cloudSyncEnable || !CFG.cloudToken) {
      uLog('⚠️ 请先在设置中填写 Token 并开启云同步', 'warn'); return false;
    }
    const cfm = confirm('⚠️ 确定要清空 Gitee 上的题库文件吗？\n\n文件: ' + CFG.cloudFilePath + '\n\n将写入空题库 {}');
    if (!cfm) return false;
    uLog('🗑 正在清空云端题库…', 'info');
    try {
      await _writeRepoFile(CFG.cloudFilePath, '{}', '清空题库（重置）');
      _cloudCache = {};
      _cloudCacheTime = Date.now();
      uLog('✅ 云端题库已清空', 'ok');
      gmNotify('云同步', '云端题库已清空');
      return true;
    } catch (e) {
      uLog('❌ 清空失败: ' + e.message, 'err');
      return false;
    }
  }

  /** 上传题库到仓库文件（合并去重：本地题库优先，云端兜底） */
  async function cloudUpload() {
    if (!CFG.cloudSyncEnable || !CFG.cloudToken) {
      uLog('⚠️ 请先在设置中填写 Token 并开启云同步', 'warn'); return false;
    }
    uLog('⬆️ 正在上传题库到仓库（合并去重）…', 'info');
    try {
      const localDB = LibraryManager.load();
      let cloudDB = {};
      let cloudCount = 0;

      // 尝试读取云端已有题库
      try {
        const cloudRaw = await _readRepoFile(CFG.cloudFilePath);
        cloudDB = JSON.parse(cloudRaw);
        cloudCount = Object.keys(cloudDB).length;
        uLog('📊 云端有 ' + cloudCount + ' 条', 'info');
      } catch {
        uLog('📊 云端无题库，将创建新文件', 'info');
      }

      // 合并：本地优先，云端补充
      const merged = { ...cloudDB, ...localDB };
      const cloudNewCount = Object.keys(merged).filter(k => !localDB.hasOwnProperty(k)).length;
      uLog('📊 云端 ' + cloudCount + ' 条 + 本地 ' + Object.keys(localDB).length + ' 条 = 合并 ' + Object.keys(merged).length + ' 条', 'info');

      const content = JSON.stringify(merged, null, 2);
      await _writeRepoFile(CFG.cloudFilePath, content,
        'MinuteStars 题库备份 ' + new Date().toLocaleString());

      uLog('✅ 合并上传成功！共 ' + Object.keys(merged).length + ' 条（云端补充 ' + cloudNewCount + ' 条）', 'ok');
      uLog('📤 公开分享链接：<a href="' + repoRawUrl(CFG.cloudFilePath) + '" target="_blank">' + repoRawUrl(CFG.cloudFilePath) + '</a>', 'info');
      gmNotify('云同步', '题库上传成功！共 ' + Object.keys(merged).length + ' 条');
      return true;
    } catch (e) {
      uLog('❌ 上传失败: ' + e.message, 'err');
      return false;
    }
  }

  /** 从仓库下载题库（覆盖本地：云端为唯一权威来源） */
  async function cloudDownload() {
    if (!CFG.cloudSyncEnable) {
      uLog('⚠️ 请先开启云同步', 'warn'); return false;
    }
    uLog('⬇️ 正在下载题库（云端覆盖本地）…', 'info');
    try {
      const raw = await _readRepoFile(CFG.cloudFilePath);
      const remoteDB = JSON.parse(raw);
      if (!_sourceMap) _sourceMap = {};
      Object.keys(remoteDB).forEach(q => { _sourceMap[q] = 'local'; });
      if (CFG.cloudReadMode === 'cloud') {
        _cloudCache = remoteDB;
        _cloudCacheTime = Date.now();
      }
      LibraryManager.save(remoteDB);
      _cache.dirty = true;
      const cnt = Object.keys(remoteDB).length;
      uLog('✅ 下载成功！云端题库已覆盖本地，共 ' + cnt + ' 条', 'ok');
      refreshLibCount();
      gmNotify('云同步', '题库下载成功！共 ' + cnt + ' 条（已覆盖本地）');
      return true;
    } catch (e) {
      uLog('❌ 下载失败: ' + e.message, 'err');
      return false;
    }
  }

  /** 从仓库导入题库（追加到本地：云端有则用云端，本地有则保留本地）
   *  @param {string} [sourceUrl] - 可选，指定 raw URL 或 repo 文件路径；不传则使用默认路径
   */
  async function cloudImport(sourceUrl) {
    if (!CFG.cloudSyncEnable) {
      uLog('⚠️ 请先开启云同步', 'warn'); return false;
    }
    const filePath = sourceUrl || CFG.cloudFilePath;
    uLog('☁ 正在导入云端题库（追加到本地）…', 'info');
    try {
      // 如果传入的是完整 URL（如分享链接），直接用 fetch
      let raw;
      if (filePath.startsWith('http')) {
        raw = await _cloudReq('GET', filePath);
      } else {
        raw = await _readRepoFile(filePath);
      }
      const cloudDB = JSON.parse(raw);
      const localDB = CFG.cloudReadMode === 'cloud'
        ? (_cloudCache || {})
        : LibraryManager.load();
      const before = Object.keys(localDB).length;
      // 追加：云端补充本地没有的条目
      const merged = { ...localDB, ...cloudDB };
      // 标记来自云端的题目来源为云端
      if (!_sourceMap) _sourceMap = {};
      for (const q of Object.keys(cloudDB)) {
        if (!localDB.hasOwnProperty(q)) {
          _sourceMap[q] = 'local';
        }
      }
      if (CFG.cloudReadMode === 'cloud') {
        _cloudCache = merged;
        _cloudCacheTime = Date.now();
      }
      LibraryManager.save(merged);
      _cache.dirty = true;
      const after = Object.keys(merged).length;
      const newCount = after - before;
      const modeHint = CFG.cloudReadMode === 'cloud' ? '（直读云端）' : '';
      uLog('✅ 导入成功！本地 ' + before + ' 条 + 云端新增 ' + newCount + ' 条 = 合计 ' + after + ' 条' + modeHint, 'ok');
      refreshLibCount();
      refreshStats();
      gmNotify('云同步', '导入成功！新增 ' + newCount + ' 条（本地已有保留）');
      return true;
    } catch (e) {
      uLog('❌ 导入失败: ' + e.message, 'err');
      return false;
    }
  }

  /** 通用云端请求（跨域自动走 GM_xmlhttpRequest 绕过 CORS） */
  async function _cloudReq(method, url, body) {
    const hasBody = (method !== 'GET' && method !== 'HEAD');
    const headers = {};
    if (hasBody) headers['Content-Type'] = 'application/json';
    uLog('📡 云端请求: ' + method + ' ' + url.substring(0, 120), 'info');

    // 判断是否跨域：Gitee API/raw 均与 pcs.minutestars.com 不同源
    const isCrossOrigin = url.includes('gitee.com');

    // 跨域请求用 GM_xmlhttpRequest（绕过 CORS），同源用 fetch
    if (isCrossOrigin && typeof GM_xmlhttpRequest !== 'undefined') {
      uLog('🔧 跨域，使用 GM_xmlhttpRequest', 'info');
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method, url, headers,
          onload: x => {
            uLog('📥 GM_xhr 响应: ' + x.status + ' | ' + (x.responseText||'').substring(0, 300), 'info');
            if (x.status >= 200 && x.status < 300) resolve(x.responseText);
            else {
              let msg = 'HTTP ' + x.status;
              try { const j = JSON.parse(x.responseText||'{}'); msg += ' - ' + (j.message||j.error||x.statusText); } catch {}
              reject(new Error(msg));
            }
          },
          onerror:  () => { uLog('❌ GM_xhr onerror', 'err'); reject(new Error('GM_xhr 网络错误')); },
          ontimeout: () => { uLog('❌ GM_xhr timeout', 'err'); reject(new Error('GM_xhr 超时')); },
          onabort: () => reject(new Error('GM_xhr 请求中止')),
          timeout: 30000,
          data: body || undefined,
        });
      });
    }

    if (typeof fetch !== 'undefined') {
      uLog('🔧 同源，使用 fetch', 'info');
      const resp = await fetch(url, {
        method,
        headers,
        body: hasBody ? body : undefined,
      });
      const text = await resp.text();
      uLog('📥 fetch 响应: ' + resp.status + ' | ' + text.substring(0, 300), 'info');
      if (resp.ok) return text;
      let msg = 'HTTP ' + resp.status;
      try { const j = JSON.parse(text); msg += ' - ' + (j.message || j.error || resp.statusText); } catch {}
      throw new Error(msg);
    }

    throw new Error('无可用请求方式');
  }

  /* =========================================================
     防抖工具
  ========================================================= */
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* =========================================================
     样式 - 方案一：经典新拟态
  ========================================================= */
  GM_addStyle(`
    /* ---- 经典新拟态主面板 ---- */
    :root {
      --nm-bg: #e0e5ec;
      --nm-shadow-light: #ffffff;
      --nm-shadow-dark: #b8bec7;
      --nm-text: #5a6a7a;
      --nm-text-secondary: #9ca3af;
      --nm-accent: #5a8dee;
      --nm-success: #48bb78;
      --nm-danger: #f87171;
      --nm-warning: #fbbf24;
      --nm-radius: 12px;
      --nm-radius-lg: 20px;
      --z-panel: 999999;
      --z-modal: 10000000;
    }

    /* 深色模式适配 */
    @media (prefers-color-scheme: dark) {
      :root {
        --nm-bg: #1e2530;
        --nm-shadow-light: #2a3441;
        --nm-shadow-dark: #151a22;
        --nm-text: #b8c4d4;
        --nm-text-secondary: #7a8a9a;
      }
      /* 标题栏深色模式 */
      .ata-hdr, #ata-lib-header {
        background: linear-gradient(145deg, #2a3441, #1e2530) !important;
        border-bottom-color: rgba(255,255,255,0.05);
      }
      .ata-hdr-title { color: #b8c4d4 !important; }
      .ata-hdr-sub { color: #7a8a9a !important; }
      .ata-hdr-ver { color: #7a8a9a !important; background: #1e2530 !important; }
    }
    /* 也支持手动检测页面背景色 */
    @media (light-level: dim), (light-level: normal) {
    }
    @media (light-level: washed) {
    }

    #ata-panel {
      position:fixed;top:10px;right:10px;z-index:var(--z-panel);
      background:var(--nm-bg);color:var(--nm-text);
      border-radius:var(--nm-radius-lg);
      padding:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
      font-size:13px;
      width:340px;height:500px;
      overflow:hidden;
      display:flex;flex-direction:column;user-select:none;
      box-shadow: 
        8px 8px 16px var(--nm-shadow-dark),
        -8px -8px 16px var(--nm-shadow-light);
    }
    #ata-panel::-webkit-scrollbar{width:4px;}
    #ata-panel::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:4px;}

    /* 顶部标题栏 */
    .ata-hdr{
      padding:16px 18px 14px;
      background: linear-gradient(145deg, #d4d9e2, #ebeff5);
      border-bottom:1px solid rgba(0,0,0,0.05);
      display:flex;align-items:center;gap:14px;
      cursor:move;
    }
    .ata-hdr-icon{
      width:44px;height:44px;border-radius:var(--nm-radius);
      background: linear-gradient(145deg, #5a8dee, #4a7cdd);
      display:flex;align-items:center;justify-content:center;
      font-size:20px;flex-shrink:0;
      color:#fff;
      box-shadow: 
        4px 4px 8px var(--nm-shadow-dark),
        -2px -2px 6px var(--nm-shadow-light);
    }
    .ata-hdr-txt{flex:1;min-width:0;}
    .ata-hdr-title{font-size:15px;font-weight:600;color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ata-hdr-sub{font-size:11px;color:#9ca3af;margin-top:2px;}
    .ata-hdr-ver{
      font-size:10px;color:#7a8a9a;
      background:var(--nm-bg);
      border-radius:20px;
      padding:4px 12px;flex-shrink:0;
      font-weight:600;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-close-btn{
      width:30px;height:30px;border-radius:var(--nm-radius);border:none;cursor:pointer;
      background:var(--nm-bg);color:#7a8a9a;font-size:14px;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      box-shadow: 
        4px 4px 8px var(--nm-shadow-dark),
        -4px -4px 8px var(--nm-shadow-light);
      transition:box-shadow .15s;
    }
    .ata-close-btn:hover{
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-close-btn:active{
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
    }

    /* 统计卡片区 */
    .ata-stats{
      display:grid;grid-template-columns:repeat(4,1fr);
      gap:12px;padding:14px;
    }
    .ata-stat-card{
      background:var(--nm-bg);
      border-radius:var(--nm-radius);
      padding:12px 6px;text-align:center;
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-stat-card .num{font-size:20px;font-weight:700;line-height:1.2;}
    .ata-stat-card .lab{font-size:10px;color:var(--nm-text-secondary);margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;}
    .ata-stat-card.green .num{color:var(--nm-success);}
    .ata-stat-card.red   .num{color:var(--nm-danger);}
    .ata-stat-card.blue  .num{color:var(--nm-accent);}
    .ata-stat-card.gray  .num{color:#6a7a8a;}

    /* 命中率实时显示 */
    .ata-hitrate-wrap{padding:0 14px 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .ata-hitrate-bar{flex:1;min-width:80px;height:8px;background:var(--nm-bg);border-radius:8px;overflow:hidden;box-shadow:inset 2px 2px 4px var(--nm-shadow-dark),inset -2px -2px 4px var(--nm-shadow-light)}
    .ata-hitrate-fill{height:100%;width:0;border-radius:8px;background:linear-gradient(90deg,var(--nm-success),#34d399);transition:width .4s ease}
    .ata-hitrate-text{font-size:12px;color:var(--nm-text);white-space:nowrap}
    .ata-hitrate-text #ata-stat-hitrate{font-weight:700;color:var(--nm-success)}
    .ata-hitrate-detail{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--nm-text-secondary)}
    .ata-method-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    .ata-method-dot.library{background:var(--nm-accent)}
    .ata-method-dot.rule{background:var(--nm-warning)}

    /* 最近答题记录 */
    .ata-recent-wrap{padding:0 14px 8px}
    .ata-recent-hd{cursor:pointer;user-select:none}
    .ata-recent-list{max-height:120px;overflow-y:auto;font-size:11px}
    .ata-recent-list::-webkit-scrollbar{width:3px}
    .ata-recent-list::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:3px}
    .ata-recent-item{display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.04)}
    .ata-recent-item:last-child{border-bottom:none}
    .ata-recent-q{flex:1;min-width:0;color:var(--nm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
    .ata-recent-q:hover{color:var(--nm-accent);text-decoration:underline}
    .ata-recent-ans{font-weight:700;color:var(--nm-success);flex-shrink:0}
    .ata-recent-method{font-size:9px;padding:1px 4px;border-radius:3px;flex-shrink:0}
    .ata-recent-method.library{background:rgba(90,141,238,.15);color:var(--nm-accent)}
    .ata-recent-method.rule{background:rgba(251,191,36,.15);color:var(--nm-warning)}
    .ata-recent-method.ai{background:rgba(139,92,246,.15);color:#8b5cf6}
    .ata-recent-method.none{background:rgba(248,113,113,.15);color:var(--nm-danger)}
    .ata-recent-empty{color:var(--nm-text-secondary);text-align:center;padding:8px 0;font-size:11px}

    /* 答题详情弹窗 */
    .ata-detail-box{background:var(--nm-bg);border-radius:var(--nm-radius-lg);width:90%;max-width:400px;max-height:80vh;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3)}
    .ata-detail-hd{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:linear-gradient(145deg,#d4d9e2,#ebeff5);border-bottom:1px solid rgba(0,0,0,.05);font-weight:600}
    .ata-detail-close{background:var(--nm-bg);border:none;width:28px;height:28px;border-radius:var(--nm-radius);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:3px 3px 6px var(--nm-shadow-dark),-3px -3px 6px var(--nm-shadow-light)}
    .ata-detail-body{padding:16px 20px;overflow-y:auto;max-height:60vh}
    .ata-detail-row{display:flex;gap:12px;margin-bottom:12px}
    .ata-detail-row label{color:var(--nm-text-secondary);font-size:12px;flex-shrink:0;width:70px}
    .ata-detail-val{flex:1;font-size:13px;color:var(--nm-text);word-break:break-all}

    /* 进度条 */
    .ata-prog-wrap{padding:10px 16px 6px;}
    .ata-prog-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
    .ata-prog-label{font-size:12px;color:var(--nm-text);}
    .ata-prog-pct{font-size:13px;font-weight:600;color:var(--nm-accent);}
    .ata-prog{
      height:10px;
      background:var(--nm-bg);
      border-radius:10px;
      overflow:hidden;
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-prog-bar{
      height:100%;border-radius:10px;width:0;transition:width .5s ease;
      background: linear-gradient(90deg, var(--nm-accent), #4a7cdd);
      box-shadow: 2px 2px 4px var(--nm-shadow-dark);
    }

    /* 答题速度曲线 */
    .ata-speed-wrap{padding:6px 16px 8px}
    .ata-speed-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px;color:var(--nm-text-secondary)}
    .ata-speed-avg{font-weight:600;color:var(--nm-accent)}

    /* 状态条 */
    .ata-status-bar{
      margin:8px 14px 10px;
      background:var(--nm-bg);
      border-radius:var(--nm-radius);
      padding:10px 14px;
      display:flex;align-items:center;gap:12px;font-size:12px;
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-status-dot{
      width:12px;height:12px;border-radius:50%;flex-shrink:0;
      background:var(--nm-bg);
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark),
        -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-status-dot.running{
      background:var(--nm-accent);
      box-shadow: 
        inset 2px 2px 4px rgba(0,0,0,.2),
        inset -2px -2px 4px rgba(255,255,255,.5);
      animation:ata-pulse 1.5s infinite;
    }
    .ata-status-dot.done{
      background:var(--nm-success);
      box-shadow: 
        inset 2px 2px 4px rgba(0,0,0,.15),
        inset -2px -2px 4px rgba(255,255,255,.5);
    }
    .ata-status-dot.idle{
      background:#a0aab4;
    }
    @keyframes ata-pulse{0%,100%{opacity:1}50%{opacity:.5}}
    .ata-status-text{color:var(--nm-text-secondary);flex:1;}
    .ata-status-text span{color:var(--nm-text);font-weight:600;}

    /* 操作按钮区 */
    .ata-actions{padding:6px 14px 8px;}
    .ata-btn-row{display:grid;gap:8px;}
    .ata-btn-row:first-child{grid-template-columns:repeat(4,1fr);}
    .ata-btn-row:last-child{grid-template-columns:repeat(3,1fr);margin-top:12px;}
    .ata-btn{
      display:flex;align-items:center;justify-content:center;gap:6px;
      background:var(--nm-bg);color:var(--nm-text);
      border:none;border-radius:var(--nm-radius);
      padding:10px 0;font-size:0.85em;cursor:pointer;
      font-weight:600;
      text-align:center;
      white-space:nowrap;
      box-shadow: 
        5px 5px 10px var(--nm-shadow-dark),
        -5px -5px 10px var(--nm-shadow-light);
      transition:all .15s ease;
    }
    .ata-btn:hover{
      box-shadow: 
        4px 4px 8px var(--nm-shadow-dark),
        -4px -4px 8px var(--nm-shadow-light);
    }
    .ata-btn:active{
      box-shadow: 
        inset 4px 4px 8px var(--nm-shadow-dark),
        inset -4px -4px 8px var(--nm-shadow-light);
    }
    .ata-btn.green{color:var(--nm-success);}
    .ata-btn.green:hover{background:rgba(72,187,120,.08);}
    .ata-btn.red{color:var(--nm-danger);}
    .ata-btn.red:hover{background:rgba(248,113,113,.08);}
    .ata-btn.orange{color:var(--nm-warning);}
    .ata-btn.orange:hover{background:rgba(251,191,36,.08);}
    .ata-btn.blue{color:var(--nm-accent);}
    .ata-btn.blue:hover{background:rgba(90,141,238,.08);}
    .ata-btn.purple{color:#8b5cf6;}
    .ata-btn.purple:hover{background:rgba(139,92,246,.08);}
    .ata-btn.yellow{color:var(--nm-warning);}
    .ata-btn.yellow:hover{background:rgba(251,191,36,.08);}

    /* 面板主体滚动 */
    #ata-body {
      flex:1;
      overflow-y:auto;
      min-height:0;
    }
    #ata-body::-webkit-scrollbar{width:3px;}
    #ata-body::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:2px;}

    /* 面板收起 */
    #ata-panel.collapsed {
      height:auto !important;
      overflow:visible !important;
      border-radius:var(--nm-radius-lg) !important;
      box-shadow: 8px 8px 16px var(--nm-shadow-dark), -8px -8px 16px var(--nm-shadow-light) !important;
    }
    #ata-panel.collapsed .ata-hdr {
      border-radius: var(--nm-radius-lg);
    }
    #ata-panel.collapsed #ata-body { display:none !important; }
    #ata-panel.collapsed .ata-log-wrap { display:none !important; }
    #ata-panel.collapsed #ata-collapse-panel { display:none !important; }
    #ata-expand-btn { display:none; }
    #ata-panel.collapsed #ata-expand-btn { display:inline-flex !important; }

    /* 响应式：小屏适配 */
    @media (max-width: 400px) {
      #ata-panel { width:calc(100vw - 20px) !important; right:10px; left:10px; max-height:85vh; overflow-y:auto; }
      .ata-stats { grid-template-columns: repeat(2, 1fr) !important; }
      .ata-hdr { padding: 12px; gap: 8px; }
      .ata-hdr-icon { width: 36px; height: 36px; font-size: 16px; }
      .ata-hdr-title { font-size: 13px; }
      .ata-btn-row:first-child { grid-template-columns: repeat(2, 1fr) !important; }
      .ata-btn-row:last-child { grid-template-columns: repeat(3, 1fr) !important; }
      #ata-log { max-height: 100px; font-size: 10px; }
    }

    /* 拖拽和调整大小 */
    .ata-resize-handle{
      position:absolute;z-index:10;background:transparent;
    }
    .ata-resize-n{top:-3px;left:20px;right:20px;height:6px;cursor:n-resize;}
    .ata-resize-s{bottom:-3px;left:20px;right:20px;height:6px;cursor:s-resize;}
    .ata-resize-w{left:-3px;top:20px;bottom:20px;width:6px;cursor:w-resize;}
    .ata-resize-e{right:-3px;top:20px;bottom:20px;width:6px;cursor:e-resize;}
    .ata-resize-nw{top:-3px;left:-3px;width:16px;height:16px;cursor:nw-resize;}
    .ata-resize-ne{top:-3px;right:-3px;width:16px;height:16px;cursor:ne-resize;}
    .ata-resize-sw{bottom:-3px;left:-3px;width:16px;height:16px;cursor:sw-resize;}
    .ata-resize-se{bottom:-3px;right:-3px;width:16px;height:16px;cursor:se-resize;}

    /* 设置折叠区 */
    .ata-collapse-hd{
      display:flex;justify-content:space-between;align-items:center;
      cursor:pointer;padding:10px 14px;
      margin:6px 12px 0;
      border-radius:var(--nm-radius);
      background:var(--nm-bg);
      font-size:12px;color:var(--nm-text);user-select:none;
      font-weight:500;
      box-shadow: 
        4px 4px 8px var(--nm-shadow-dark),
        -4px -4px 8px var(--nm-shadow-light);
      transition:box-shadow .15s;
    }
    .ata-collapse-hd:hover{
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-collapse-hd.open{
      box-shadow: 
        inset 4px 4px 8px var(--nm-shadow-dark),
        inset -4px -4px 8px var(--nm-shadow-light);
      color:var(--nm-text);
    }
    /* 设置项搜索 */
    .ata-settings-search{display:flex;align-items:center;gap:8px;padding:10px 14px 6px}
    .ata-settings-search input{flex:1;padding:8px 12px;border:none;border-radius:var(--nm-radius);background:var(--nm-bg);color:var(--nm-text);font-size:12px;box-shadow:inset 3px 3px 6px var(--nm-shadow-dark),inset -3px -3px 6px var(--nm-shadow-light);outline:none}
    .ata-settings-search input:focus{box-shadow:inset 4px 4px 8px var(--nm-shadow-dark),inset -4px -4px 8px var(--nm-shadow-light)}
    .ata-settings-search input::placeholder{color:var(--nm-text-secondary)}
    .ata-settings-count{font-size:11px;color:var(--nm-text-secondary);white-space:nowrap}
    .ata-row.hidden-by-search{display:none}
    .ata-section-title.hidden-by-search{display:none}
    .ata-collapse-body{
      display:none;
      margin:0 12px 10px;
      background:var(--nm-bg);
      border-radius:0 0 var(--nm-radius-lg) var(--nm-radius-lg);
      padding:0 12px;
      transition:padding .3s ease;
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
    }
    /* 策略预设 */
    .ata-presets-row{display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
    .ata-presets-hint{min-height:14px}
    .ata-collapse-body.open{display:block;padding:12px;}
    .ata-section-title{
      font-size:10px;color:var(--nm-text-secondary);
      letter-spacing:.5px;font-weight:600;text-transform:uppercase;
      margin:12px 0 8px;padding-bottom:4px;
      border-bottom:1px solid var(--nm-shadow-dark);
    }
    .ata-section-title:first-child{margin-top:0;}
    .ata-row{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px;flex-wrap:wrap;}
    .ata-label{color:var(--nm-text);min-width:100px;flex-shrink:0;font-size:11px;}
    .ata-hint{font-size:11px;color:var(--nm-success);min-width:20px;}
    .ata-divider{border:none;border-top:1px solid var(--nm-shadow-dark);margin:10px 0;}

    /* Toggle 开关 */
    .ata-toggle{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;}
    .ata-toggle input{opacity:0;width:0;height:0;}
    .ata-slider{
      position:absolute;inset:0;
      background:var(--nm-bg);
      border-radius:12px;cursor:pointer;
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
      transition:.25s;
    }
    .ata-slider:before{
      content:'';position:absolute;
      width:18px;height:18px;border-radius:50%;
      background:var(--nm-bg);
      left:3px;top:3px;
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark),
        -2px -2px 4px var(--nm-shadow-light);
      transition:.25s;
    }
    .ata-toggle input:checked+.ata-slider{
      background:var(--nm-bg);
    }
    .ata-toggle input:checked+.ata-slider:before{
      transform:translateX(20px);
      background:var(--nm-accent);
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark);
    }

    /* 输入框 */
    .ata-num-input{
      width:64px;
      background:var(--nm-bg);
      border:none;
      color:var(--nm-text);
      border-radius:var(--nm-radius);
      padding:6px 10px;font-size:12px;text-align:center;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-num-input:focus{outline:none;}
    .ata-text-input{
      flex:1;min-width:90px;
      background:var(--nm-bg);
      border:none;
      color:var(--nm-text);
      border-radius:var(--nm-radius);
      padding:6px 10px;font-size:12px;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-text-input:focus{outline:none;}
    .ata-range{flex:1;min-width:70px;accent-color:var(--nm-accent);height:4px;cursor:pointer;}
    .ata-range-val{font-size:11px;color:var(--nm-text);min-width:32px;text-align:right;}

    /* 底部日志 */
    .ata-log-wrap{padding:8px 14px 12px;margin-top:auto;}
    .ata-log-hdr{font-size:10px;color:var(--nm-text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
    .ata-log{
      max-height:80px;overflow-y:auto;font-size:11px;color:#6a7a8a;
      background:var(--nm-bg);
      border-radius:var(--nm-radius);
      padding:8px 12px;
      font-family:Consolas,'Microsoft YaHei',monospace;line-height:1.7;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }

    /* 题库标记 */
    .ata-log::-webkit-scrollbar{width:3px;}
    .ata-log::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:4px;}
    #ata-lib-scroll::-webkit-scrollbar{width:4px;}
    #ata-lib-scroll::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:4px;}

    .ata-answered{background:rgba(72,187,120,.1)!important;}
    .ata-no-match{background:rgba(248,113,113,.1)!important;}

    /* 正确率趋势图（v4.7.0） */
    .ata-acc-wrap{display:none;padding:8px 14px 6px;border-top:1px solid rgba(0,0,0,.04);}
    .ata-acc-hd{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--nm-text-secondary);margin-bottom:4px;}
    .ata-acc-avg{font-weight:600;color:var(--nm-accent);}

    /* 答题记录来源圆点（v4.7.0） */
    .ata-method-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;}
    .ata-method-dot.library{background:#5a8dee;}
    .ata-method-dot.rule{background:#fbbf24;}
    .ata-method-dot.none{background:#94a3b8;}

    /* 题库管理弹窗（居中浮窗） */
    #ata-lib-modal{
      position:fixed;
      top:50%;left:50%;
      transform:translate(-50%,-50%);
      z-index:999999;
      background:var(--nm-bg);border-radius:var(--nm-radius-lg);
      width:760px;max-width:96vw;max-height:88vh;
      display:none;flex-direction:column;overflow:hidden;
      box-shadow:
        12px 12px 24px var(--nm-shadow-dark),
        -12px -12px 24px var(--nm-shadow-light);
    }
    #ata-lib-modal.show{
      display:flex !important;
    }
    #ata-lib-header{
      display:flex;align-items:center;justify-content:space-between;
      padding:16px 20px;
      background: linear-gradient(145deg, #d4d9e2, #ebeff5);
      border-radius:var(--nm-radius-lg) var(--nm-radius-lg) 0 0;
      border-bottom:1px solid rgba(0,0,0,0.05);
    }
    #ata-lib-header h3{margin:0;color:#4a5568;font-size:15px;font-weight:600;}
    #ata-lib-close{
      background:var(--nm-bg);border:none;color:#7a8a9a;font-size:14px;
      cursor:pointer;line-height:1;padding:8px 12px;border-radius:var(--nm-radius);
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
      transition:box-shadow .15s;
    }
    #ata-lib-close:hover{
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark),
        -2px -2px 4px var(--nm-shadow-light);
    }
    #ata-lib-close:active{
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    #ata-lib-tabs{
      display:flex;padding:12px 18px;gap:8px;
      border-bottom:1px solid var(--nm-shadow-dark);
    }
    .ata-tab{
      padding:8px 16px;border-radius:var(--nm-radius);cursor:pointer;font-size:12px;
      color:var(--nm-text-secondary);border:none;
      background:var(--nm-bg);
      font-weight:500;
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
      transition:box-shadow .15s;
    }
    .ata-tab:hover{
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark),
        -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-tab.active{
      box-shadow: 
        inset 3px 3px 6px var(--nm-shadow-dark),
        inset -3px -3px 6px var(--nm-shadow-light);
      color:var(--nm-text);font-weight:600;
    }
    #ata-lib-body{flex:1;overflow-y:auto;padding:16px 20px;}
    #ata-lib-body::-webkit-scrollbar{width:4px;}
    #ata-lib-body::-webkit-scrollbar-thumb{background:var(--nm-shadow-dark);border-radius:4px;}

    /* 标签管理 */
    .ata-tags-section{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid rgba(0,0,0,.08)}
    .ata-tags-section:last-child{border-bottom:none;margin-bottom:0}
    .ata-tags-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:13px;font-weight:600;color:var(--nm-text)}
    .ata-tags-list{display:flex;flex-wrap:wrap;gap:8px}
    .ata-tags-empty{color:var(--nm-text-secondary);font-size:12px;text-align:center;padding:16px 0}
    .ata-tag-item{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--nm-radius);background:var(--nm-bg);font-size:12px;box-shadow:2px 2px 4px var(--nm-shadow-dark),-2px -2px 4px var(--nm-shadow-light);cursor:pointer}
    .ata-tag-item:hover{box-shadow:1px 1px 2px var(--nm-shadow-dark),-1px -1px 2px var(--nm-shadow-light)}
    .ata-tag-item .ata-tag-name{flex:1}
    .ata-tag-item .ata-tag-count{font-size:10px;color:var(--nm-text-secondary)}
    .ata-tag-item .ata-tag-del{background:none;border:none;cursor:pointer;color:var(--nm-danger);font-size:14px;padding:0 2px;opacity:.6}
    .ata-tag-item .ata-tag-del:hover{opacity:1}
    .ata-tag-color{width:12px;height:12px;border-radius:3px;flex-shrink:0}
    .ata-tag-input{padding:8px 12px;border-radius:var(--nm-radius);border:1px solid var(--nm-shadow-dark);background:var(--nm-bg);color:var(--nm-text);font-size:12px;width:120px}
    .ata-tag-input:focus{outline:none;border-color:var(--nm-accent)}
    .ata-tag-questions{background:rgba(0,0,0,.03);border-radius:var(--nm-radius);padding:12px}
    .ata-tag-q-results{max-height:150px;overflow-y:auto;margin-top:8px}
    .ata-tag-q-item{padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;margin-bottom:4px}
    .ata-tag-q-item:hover{background:rgba(90,141,238,.1)}
    .ata-tag-q-item.selected{background:rgba(90,141,238,.2);color:var(--nm-accent)}
    .ata-tag-checkboxes{display:flex;flex-wrap:wrap;gap:6px}
    .ata-pane{display:none;} .ata-pane.active{display:block;}
    .ata-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;}
    /* 题库来源饼图 */
    .ata-source-chart{background:var(--nm-bg);border-radius:var(--nm-radius);padding:12px;margin-bottom:14px;box-shadow:3px 3px 6px var(--nm-shadow-dark),-3px -3px 6px var(--nm-shadow-light)}
    .ata-chart-title{font-size:12px;font-weight:600;color:var(--nm-text);margin-bottom:8px}
    .ata-chart-legend{font-size:11px;color:var(--nm-text)}
    .ata-legend-item{display:flex;align-items:center;gap:6px;margin-bottom:4px}
    .ata-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
    .ata-stat-card{
      background:var(--nm-bg);border-radius:var(--nm-radius);
      padding:12px;text-align:center;
      box-shadow: 
        3px 3px 6px var(--nm-shadow-dark),
        -3px -3px 6px var(--nm-shadow-light);
    }
    .ata-stat-card .num{font-size:22px;font-weight:700;color:var(--nm-text);}
    .ata-stat-card .lab{font-size:10px;color:var(--nm-text-secondary);margin-top:4px;text-transform:uppercase;}
    .ata-lib-format{
      background:var(--nm-bg);
      border-radius:var(--nm-radius);
      padding:12px;font-size:11px;color:var(--nm-text-secondary);
      line-height:1.8;margin-bottom:12px;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-lib-format code{color:var(--nm-accent);}
    .ata-lib-textarea{
      width:100%;min-height:150px;
      background:var(--nm-bg);
      border:none;
      color:var(--nm-text);
      border-radius:var(--nm-radius);
      padding:10px;font-size:12px;font-family:Consolas,monospace;
      resize:vertical;box-sizing:border-box;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    .ata-import-result{margin-top:8px;font-size:12px;padding:8px 12px;border-radius:var(--nm-radius);display:none;}
    .ata-import-result.ok{display:block;background:rgba(72,187,120,.1);color:var(--nm-success);}
    .ata-import-result.err{display:block;background:rgba(248,113,113,.1);color:var(--nm-danger);}
    .ata-lib-table{width:100%;border-collapse:collapse;font-size:11px;}
    .ata-lib-table th{
      background:var(--nm-bg);color:var(--nm-text);padding:10px 12px;text-align:left;
      position:sticky;top:0;z-index:1;font-size:10px;text-transform:uppercase;letter-spacing:.5px;
      border-bottom:1px solid var(--nm-shadow-dark);
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark);
    }
    .ata-lib-table td{
      padding:8px 12px;
      border-bottom:1px solid rgba(184,190,199,.3);
      color:var(--nm-text);vertical-align:top;
    }
    .ata-lib-table tr:hover td{background:rgba(90,142,222,.12);}
    .ata-lib-table .q-cell{max-width:400px;word-break:break-all;}
    .ata-lib-table .ans-cell{color:var(--nm-accent);font-weight:700;}
    .ata-lib-table .del-btn{
      background:var(--nm-bg);color:var(--nm-danger);border:none;
      border-radius:var(--nm-radius);padding:4px 10px;cursor:pointer;font-size:11px;
      box-shadow: 
        2px 2px 4px var(--nm-shadow-dark),
        -2px -2px 4px var(--nm-shadow-light);
      transition:box-shadow .15s;
    }
    .ata-lib-table .del-btn:hover{
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    #ata-lib-search{
      width:100%;
      background:var(--nm-bg);
      border:none;
      color:var(--nm-text);
      border-radius:var(--nm-radius);
      padding:10px 14px;font-size:12px;margin-bottom:10px;box-sizing:border-box;
      box-shadow:
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    /* v4.5.39 搜索高亮 */
    .ata-lib-table td:first-child mark {
      background:#ffd740;color:#333;border-radius:2px;padding:0 2px;
    }
    .ata-lib-pager{
      display:flex;justify-content:space-between;align-items:center;
      margin-top:10px;font-size:11px;color:var(--nm-text-secondary);
    }
    .ata-add-row{display:flex;gap:8px;margin-bottom:10px;}
    .ata-add-row input{
      flex:1;
      background:var(--nm-bg);
      border:none;
      color:var(--nm-text);
      border-radius:var(--nm-radius);
      padding:8px 12px;font-size:12px;
      box-shadow: 
        inset 2px 2px 4px var(--nm-shadow-dark),
        inset -2px -2px 4px var(--nm-shadow-light);
    }
    #ata-file-input{display:none;}
  `);

  /* =========================================================
     页面检测
  ========================================================= */
  const isLoginPage  = () => /\/login\.aspx$/i.test(location.pathname);
  const isAnswerPage = () => /\/exams\/test\/dotest\.aspx$/.test(location.pathname);
  const isViewPage   = () => /\/exams\/test\/score\/viewanswer\.aspx$/.test(location.pathname);

  /* =========================================================
     自动登录
  ========================================================= */
  let _loginHandled = false;

  function handleLogin() {
    if (_loginHandled) return;
    if (!CFG.autoLogin) return;
    if (!CFG.username || !CFG.password) return;

    const user = document.querySelector('#txtUserName'),
          pass = document.querySelector('#txtPassword'),
          btn = document.querySelector('#btnLogin');
    if (!user || !pass || !btn) return;

    const errEl = document.querySelector('#MessageError');
    if (errEl && errEl.textContent.trim()) return;

    _loginHandled = true;
    uLog('🔑 自动登录中...', 'ok');

    const needsFill = user.value !== CFG.username;
    const delay = needsFill ? 300 : 100;

    if (needsFill) {
      setTimeout(() => {
        user.value = CFG.username;
        ['input','change'].forEach(ev => user.dispatchEvent(new Event(ev, {bubbles:true})));
      }, delay);
      setTimeout(() => {
        pass.value = CFG.password;
        ['input','change'].forEach(ev => pass.dispatchEvent(new Event(ev, {bubbles:true})));
      }, delay + 300);
    }

    setTimeout(() => {
      const captcha = document.querySelector('#txtCapcha'),
            captchaWrap = document.querySelector('#liCapcha');
      if (captcha && captchaWrap && getComputedStyle(captchaWrap).display !== 'none') {
        captchaWrap.style.border = '2px solid red';
        uLog('⚠️ 需要验证码，请手动填写', 'warn');
      } else {
        uLog('✅ 点击登录...', 'ok');
        btn.click();
      }
    }, needsFill ? 1000 : 500);
  }

  // 立即尝试（整页刷新 / 首次加载）
  handleLogin();

  // 持续轮询检测登录表单（覆盖 SPA 导航、session 过期跳转等场景）
  setInterval(() => {
    // 登录表单消失 → 重置标记（允许下次出现时重新登录）
    if (_loginHandled && !document.querySelector('#txtUserName')) {
      _loginHandled = false;
    }
    if (!_loginHandled) handleLogin();
  }, 1000);

  // 非答题/查看答案页静默退出
  if (!isAnswerPage() && !isViewPage()) return;

  /* =========================================================
     主面板
  ========================================================= */
  const panel = document.createElement('div');
  panel.id = 'ata-panel';
  panel.innerHTML = `
    <!-- 标题栏 -->
    <div class="ata-hdr">
      <div class="ata-hdr-icon">🤖</div>
      <div class="ata-hdr-txt">
        <div class="ata-hdr-title">千寻宜 MinuteStars 答题器</div>
        <div class="ata-hdr-sub">题库 <span id="ata-lib-count">${LibraryManager.count}</span> 条</div>
      </div>
      <span class="ata-hdr-ver">${SCRIPT_VERSION}</span>
      <button class="ata-close-btn" id="ata-collapse-panel" title="收起面板">▼</button>
      <button class="ata-close-btn" id="ata-expand-btn" title="展开面板">▲</button>
      <button class="ata-close-btn" id="ata-close" title="关闭面板">✕</button>
    </div>

    <!-- 面板主体（收起时隐藏） -->
    <div id="ata-body">

    <!-- 统计卡片 -->
    <div class="ata-stats">
      <div class="ata-stat-card blue">
        <div class="num" id="ata-stat-total">0</div>
        <div class="lab">总题数</div>
      </div>
      <div class="ata-stat-card green">
        <div class="num" id="ata-stat-answered">0</div>
        <div class="lab">已答题</div>
      </div>
      <div class="ata-stat-card green">
        <div class="num" id="ata-stat-hit">0</div>
        <div class="lab">命中</div>
      </div>
      <div class="ata-stat-card red">
        <div class="num" id="ata-stat-miss">0</div>
        <div class="lab">未命中</div>
      </div>
    </div>

    <!-- 命中率实时显示 -->
    <div class="ata-hitrate-wrap" id="ata-hitrate-wrap">
      <div class="ata-hitrate-bar"><div class="ata-hitrate-fill" id="ata-hitrate-fill"></div></div>
      <div class="ata-hitrate-text"><span id="ata-stat-hitrate">0%</span> 命中率</div>
      <div class="ata-hitrate-detail" id="ata-hitrate-detail">
        <span class="ata-method-dot library" title="题库命中"></span><span id="ata-stat-lib">0</span>
        <span class="ata-method-dot rule" title="规则推断"></span><span id="ata-stat-rule">0</span>
      </div>
    </div>

    <!-- 最近答题记录（折叠） -->
    <div class="ata-recent-wrap" id="ata-recent-wrap">
      <div class="ata-collapse-hd ata-recent-hd" id="ata-recent-hd">
        <span>📋 最近答题</span><span id="ata-recent-arrow">▼</span>
      </div>
      <div class="ata-collapse-body" id="ata-recent-body">
        <div class="ata-recent-list" id="ata-recent-list"><div class="ata-recent-empty">暂无答题记录</div></div>
      </div>
    </div>

    <!-- 进度条 -->
    <div class="ata-prog-wrap">
      <div class="ata-prog-meta">
        <span class="ata-prog-label">答题进度</span>
        <span class="ata-prog-pct" id="ata-prog-pct">0%</span>
      </div>
      <div class="ata-prog"><div class="ata-prog-bar" id="ata-bar"></div></div>
    </div>

    <!-- 答题速度曲线 -->
    <div class="ata-speed-wrap" id="ata-speed-wrap" style="display:none">
      <div class="ata-speed-hd">
        <span>📈 答题速度</span>
        <span class="ata-speed-avg" id="ata-speed-avg">平均 0ms</span>
      </div>
      <canvas id="ata-speed-canvas" width="300" height="40" style="width:100%;height:40px;display:block"></canvas>
    </div>

    <!-- 正确率趋势图（v4.7.0） -->
    <div class="ata-acc-wrap" id="ata-acc-wrap" style="display:none">
      <div class="ata-acc-hd">
        <span>📊 正确率趋势</span>
        <span class="ata-acc-avg" id="ata-acc-avg">正确率 --</span>
      </div>
      <canvas id="ata-acc-canvas" width="300" height="45" style="width:100%;height:45px;display:block"></canvas>
    </div>

    <!-- 状态指示条 -->
    <div class="ata-status-bar">
      <div class="ata-status-dot idle" id="ata-status-dot"></div>
      <div class="ata-status-text" id="ata-status-text">等待开始</div>
    </div>

    <!-- 主操作按钮 -->
    <div class="ata-actions">
      <div class="ata-btn-row">
        <button class="ata-btn green"  id="ata-start">▶ 开始答题</button>
        <button class="ata-btn yellow" id="ata-pause">⏸ 暂停</button>
        <button class="ata-btn"        id="ata-reset">↺ 重置</button>
        <button class="ata-btn blue"   id="ata-submit">✔ 提交</button>
      </div>
      <div class="ata-btn-row">
        <button class="ata-btn"      id="ata-scan">🔍 扫描</button>
        <button class="ata-btn"      id="ata-collect">📥 采集</button>
        <button class="ata-btn purple" id="ata-open-lib">📚 题库</button>
      </div>
    </div>

    <!-- 设置折叠区 -->
    <div class="ata-collapse-hd" id="ata-settings-hd">
      <span>⚙ 设置</span><span id="ata-settings-arrow">▼</span>
    </div>
    <div class="ata-collapse-body" id="ata-settings-body">

      <!-- 设置项搜索 -->
      <div class="ata-settings-search">
        <input type="text" id="ata-settings-search" placeholder="🔍 搜索设置项...">
        <span id="ata-settings-count" class="ata-settings-count"></span>
      </div>

      <div class="ata-section-title">匹配策略</div>
      <div class="ata-row">
        <span class="ata-label">模糊匹配</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-fuzzy-enable"><span class="ata-slider"></span></label>
        <span class="ata-hint" id="cfg-fuzzy-hint">开</span>
      </div>
      <div class="ata-row">
        <span class="ata-label">匹配阈值</span>
        <input type="range" id="cfg-fuzzy-thresh" min="50" max="95" step="5" class="ata-range">
        <span class="ata-range-val" id="cfg-thresh-val">75%</span>
      </div>

      <div class="ata-section-title">答题行为</div>
      <div class="ata-row">
        <span class="ata-label">加载后自动答题</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-answer"><span class="ata-slider"></span></label>
      </div>
      <div class="ata-row">
        <span class="ata-label">答完自动提交</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-submit"><span class="ata-slider"></span></label>
      </div>
      <div class="ata-row">
        <span class="ata-label">每题延迟</span>
        <input type="number" id="cfg-answer-delay" min="0" max="3000" step="50" class="ata-num-input"> ms
      </div>
      <div class="ata-row">
        <span class="ata-label">提交延迟</span>
        <input type="number" id="cfg-submit-min" min="5" max="600" class="ata-num-input" style="width:54px">
        <span style="color:#475569">~</span>
        <input type="number" id="cfg-submit-max" min="5" max="600" class="ata-num-input" style="width:54px"> s
      </div>

      <div class="ata-section-title">自动登录</div>
      <div class="ata-row">
        <span class="ata-label">启用</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-login"><span class="ata-slider"></span></label>
      </div>
      <div id="cfg-login-fields">
        <div class="ata-row">
          <span class="ata-label">用户名</span>
          <input type="text"     id="cfg-username" class="ata-text-input" placeholder="登录账号" autocomplete="off">
        </div>
        <div class="ata-row">
          <span class="ata-label">密码</span>
          <input type="password" id="cfg-password" class="ata-text-input" placeholder="登录密码" autocomplete="off">
          <button class="ata-btn" id="cfg-eye" style="padding:3px 8px;font-size:12px;margin-left:3px">👁</button>
        </div>
      </div>

      <div class="ata-section-title">快捷键 &amp; 通知</div>
      <div class="ata-row">
        <span class="ata-label">启用快捷键</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-shortcuts-enable"><span class="ata-slider"></span></label>
      </div>
      <div style="font-size:10px;color:#888;margin:2px 0 6px 0;line-height:1.6">
        ⌨️ <b>Alt+Enter</b>：开始答题 / 提交答案 &nbsp;|&nbsp; <b>Alt+S</b>：暂停 / 继续 &nbsp;|&nbsp; <b>Alt+D</b>：下载题库 JSON
      </div>
      <div class="ata-row">
        <span class="ata-label">系统通知</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-notify-enable"><span class="ata-slider"></span></label>
      </div>

      <div class="ata-section-title">云同步 <span style="font-size:10px;color:#aaa">(Gitee 仓库)</span></div>
      <div class="ata-row">
        <span class="ata-label">启用云同步</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-cloud-sync-enable"><span class="ata-slider"></span></label>
      </div>
      <div id="cfg-cloud-row" style="opacity:.4">
        <div class="ata-row">
          <span class="ata-label">答题模式</span>
          <select id="cfg-cloud-read-mode" class="ata-text-input" style="width:auto;font-size:12px">
            <option value="local">📥 本地存储（需下载）</option>
            <option value="cloud">☁ 直读云端（实时）</option>
          </select>
        </div>
        <div class="ata-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="ata-label">Token</span>
          <input type="password" id="cfg-cloud-token" class="ata-text-input" placeholder="Gitee 私人令牌（仅上传/分享需要）" style="width:100%;box-sizing:border-box">
          <div style="font-size:11px;color:var(--nm-text-secondary);margin-top:2px">💡 读题库免 Token（公开 raw 链接）；写题库需 Token</div>
        </div>
        <div class="ata-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="ata-label">题库路径</span>
          <input type="text" id="cfg-cloud-file-path" class="ata-text-input" placeholder="minutestars_qa.json" style="width:100%;box-sizing:border-box">
          <div style="font-size:11px;color:var(--nm-text-secondary);margin-top:2px">💡 分享链接：https://gitee.com/<b id="cfg-share-repo">law-of-order/MinuteStars-AutoAnswer</b>/raw/<b id="cfg-share-branch">main</b>/<b id="cfg-share-preview">minutestars_qa.json</b></div>
        </div>
        <div class="ata-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="ata-label">仓库路径</span>
          <input type="text" id="cfg-cloud-repo-path" class="ata-text-input" placeholder="owner/repo" style="width:100%;box-sizing:border-box">
          <div style="font-size:10px;color:#888;margin-top:2px">💡 格式：用户名/仓库名，如 law-of-order/MinuteStars-AutoAnswer</div>
        </div>
        <div class="ata-row" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="ata-label">分支</span>
          <input type="text" id="cfg-cloud-branch" class="ata-text-input" placeholder="main" style="width:100%;box-sizing:border-box">
        </div>
        <div class="ata-row">
          <span class="ata-label">数据压缩</span>
          <label class="ata-toggle"><input type="checkbox" id="cfg-compress-enable"><span class="ata-slider"></span></label>
          <span style="font-size:10px;color:#888;margin-left:4px">LZ-string 压缩，减少存储占用</span>
        </div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="ata-btn green" id="ata-cloud-upload" style="font-size:11px;padding:4px 10px" title="上传本地题库到仓库文件，与云端合并去重">⬆ 上传题库（合并）</button>
          <button class="ata-btn blue"  id="ata-cloud-download" style="font-size:11px;padding:4px 10px" title="从仓库下载题库，覆盖本地所有题目">⬇ 下载题库（覆盖）</button>
          <button class="ata-btn purple" id="ata-cloud-import" style="font-size:11px;padding:4px 10px" title="从仓库追加导入到本地（不影响云端文件）">☁ 导入云端</button>
          <button class="ata-btn red"    id="ata-cloud-delete" style="font-size:11px;padding:4px 10px" title="将云端题库重置为空 {}">🗑 清空云端</button>
        </div>
        <div style="font-size:10px;color:#888;margin-top:4px">💡 <b>本地</b>：下载到本地，离线可用 | <b>直读云端</b>：实时拉取，无需下载，缓存 5 分钟</div>
      </div>

      <div class="ata-section-title">自定义域名 <span style="font-size:10px;color:#aaa">（通配符已支持 *.minutestars.com）</span></div>
      <div class="ata-row" style="flex-direction:column;align-items:flex-start;gap:4px">
        <span class="ata-label">添加匹配域名</span>
        <div style="display:flex;gap:4px;width:100%">
          <input type="text" id="cfg-custom-domain-input" class="ata-text-input" placeholder="例如：https://example.com" style="flex:1;font-size:12px">
          <button class="ata-btn blue" id="cfg-add-domain-btn" style="font-size:11px;padding:4px 10px">添加</button>
        </div>
        <div id="cfg-custom-domains-list" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"></div>
        <div style="font-size:10px;color:#888;margin-top:2px">💡 脚本会在这些域名上自动运行（需包含协议，如 https://example.com）</div>
      </div>

      <div class="ata-section-title">答题报告</div>
      <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="ata-btn" id="ata-export-report-json" style="font-size:11px;padding:4px 10px">📊 导出 JSON 报告</button>
        <button class="ata-btn" id="ata-export-report-csv"  style="font-size:11px;padding:4px 10px">📊 导出 CSV 报告</button>
      </div>

      <div class="ata-section-title">调试</div>
      <div class="ata-row">
        <span class="ata-label">控制台日志</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-debug"><span class="ata-slider"></span></label>
      </div>

      <div class="ata-section-title">📋 策略预设</div>
      <div class="ata-presets-row">
        <select id="ata-preset-select" class="ata-text-input" style="flex:1;padding:6px 10px;font-size:12px">
          <option value="">— 选择预设 —</option>
          <option value="fast">⚡ 快速答题（低延迟）</option>
          <option value="accurate">🎯 精准答题（高阈值）</option>
          <option value="safe">🛡️ 安全答题（长延迟）</option>
        </select>
        <button class="ata-btn blue" id="ata-preset-apply" style="padding:6px 12px;font-size:11px">应用</button>
        <button class="ata-btn" id="ata-preset-save" style="padding:6px 12px;font-size:11px">💾 保存当前</button>
      </div>
      <div class="ata-presets-hint" id="ata-presets-hint" style="font-size:10px;color:var(--nm-text-secondary);margin-top:4px"></div>

      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="ata-btn green" id="cfg-save">💾 保存</button>
        <button class="ata-btn"       id="cfg-reset-defaults">↺ 恢复默认</button>
      </div>
      <div id="cfg-save-msg" style="font-size:11px;color:#4ade80;margin-top:3px;height:16px"></div>
    </div>
    </div><!-- end ata-body -->

    <!-- 底部日志 -->
    <div class="ata-log-wrap">
      <div class="ata-log-hdr">运行日志</div>
      <div class="ata-log" id="ata-log"></div>
    </div>

  </div>
`;
  document.body.appendChild(panel);

  // 添加8方向调整大小手柄（隐藏）
  ['n','ne','e','se','s','sw','w','nw'].forEach(dir => {
    const h = document.createElement('div');
    h.className = `ata-resize-handle ata-resize-${dir}`;
    h.dataset.dir = dir;
    panel.appendChild(h);
  });

  /* =========================================================
     题库管理弹窗
  ========================================================= */
  const modal = document.createElement('div');
  modal.id = 'ata-lib-modal';
  modal.innerHTML = `
    <div id="ata-lib-box">
      <div id="ata-lib-header">
        <h3>📚 题库管理 — 共 <span id="ata-lib-total">0</span> 条</h3>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="ata-lib-share" class="ata-btn green" style="padding:4px 10px;font-size:11px">📤 分享题库</button>
          <button id="ata-lib-close">✕</button>
        </div>
      </div>
      <div id="ata-lib-tabs">
        <div class="ata-tab active" data-tab="stats">📊 统计</div>
        <div class="ata-tab" data-tab="bulk">📥 批量导入</div>
        <div class="ata-tab" data-tab="single">➕ 单条添加</div>
        <div class="ata-tab" data-tab="browse">🔍 浏览题库</div>
        <div class="ata-tab" data-tab="tags">🏷️ 标签</div>
        <div class="ata-tab" data-tab="export">📤 导出</div>
        <div class="ata-tab" data-tab="import-shared">📥 导入分享</div>
      </div>
      <div id="ata-lib-body">

        <div class="ata-pane active" id="pane-stats">
          <div class="ata-stat-grid">
            <div class="ata-stat-card"><div class="num" id="stat-total">0</div><div class="lab">题库总数</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-single">0</div><div class="lab">单选/判断</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-multi">0</div><div class="lab">多选题</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-user">0</div><div class="lab">题库总数</div></div>
          </div>
          <!-- 题库来源分布饼图 -->
          <div class="ata-source-chart" id="ata-source-chart">
            <div class="ata-chart-title">题库来源分布</div>
            <div style="display:flex;align-items:center;gap:16px">
              <canvas id="ata-pie-canvas" width="100" height="100" style="flex-shrink:0"></canvas>
              <div class="ata-chart-legend" id="ata-chart-legend">
                <div class="ata-legend-item"><span class="ata-legend-dot" style="background:#5a8dee"></span>云端题库 <span id="stat-builtin-pct">0%</span></div>
                <div class="ata-legend-item"><span class="ata-legend-dot" style="background:#48bb78"></span>本地题库 <span id="stat-user-pct">0%</span></div>
              </div>
            </div>
          </div>
          <div style="font-size:12px;color:#aaa;margin-bottom:10px">
            当前题库 <span id="stat-uc">0</span> 条（来源：本地导入 或 云端下载）
          </div>
          <button class="ata-btn red" id="ata-clear-lib">🗑️ 清空自定义题库</button>
          <div id="ata-clear-confirm" style="display:none;margin-top:6px;font-size:12px;color:#ef5350">
            ⚠️ 确认清空？
            <button class="ata-btn red"    id="ata-clear-yes" style="padding:2px 10px;font-size:11px">确定</button>
            <button class="ata-btn yellow" id="ata-clear-no"  style="padding:2px 10px;font-size:11px">取消</button>
          </div>
        </div>

        <div class="ata-pane" id="pane-bulk">
          <div class="ata-lib-format">
            <b>支持格式（每行一条）：</b><br>
            <code>题目||答案</code> 或 <code>题目|答案</code><br>
            多选：<code>A,B,C</code>；判断：<code>true</code> / <code>false</code>
          </div>
          <textarea class="ata-lib-textarea" id="ata-bulk-text" placeholder="粘贴题库内容...&#10;示例：&#10;出差补助按地区划分为三类，正确的是？||A,B,C"></textarea>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button class="ata-btn green"  id="ata-do-import">✅ 导入</button>
            <button class="ata-btn yellow" id="ata-do-clipboard">📋 从剪贴板</button>
            <label class="ata-btn yellow" style="display:inline-block;margin:0;cursor:pointer">
              📂 从文本文件<input type="file" id="ata-file-input" accept=".txt,.json,.csv">
            </label>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <label class="ata-btn purple" style="display:inline-block;margin:0;cursor:pointer">
              📄 从 Word 文档导入（.docx）<input type="file" id="ata-docx-input" accept=".docx" multiple style="display:none">
            </label>
            <label class="ata-btn orange" style="display:inline-block;margin:0;cursor:pointer">
              📊 从 Excel 导入（.xlsx）<input type="file" id="ata-xlsx-input" accept=".xlsx,.xls" style="display:none">
            </label>
            <span id="ata-docx-msg" style="font-size:11px;margin-left:8px;color:#aaa"></span>
          </div>
          <div class="ata-import-result" id="ata-import-result"></div>
        </div>

        <div class="ata-pane" id="pane-single">
          <div class="ata-add-row"><input id="ata-single-q" placeholder="题目（粘贴或输入）" /></div>
          <div class="ata-add-row">
            <input id="ata-single-a" placeholder="答案：A 或 A,B,C 或 true" style="flex:0 0 220px" />
            <button class="ata-btn green" id="ata-single-add" style="flex:0 0 80px">添加</button>
          </div>
          <div id="ata-single-msg" style="font-size:12px;margin-bottom:8px"></div>
        </div>

        <div class="ata-pane" id="pane-browse">
          <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center">
            <input id="ata-lib-search" placeholder="🔍 搜索（支持正则 / 关键词）" style="flex:1;min-width:130px" />
            <label style="font-size:11px;color:#aaa;white-space:nowrap">
              <input type="checkbox" id="ata-lib-regex" style="vertical-align:middle" title="启用正则表达式"> 正则
            </label>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
            <select id="ata-lib-filter" style="padding:4px 8px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;font-size:11px">
              <option value="all">全部题目</option>
            </select>
            <select id="ata-lib-tag-filter" style="padding:4px 8px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;font-size:11px">
              <option value="">全部标签</option>
            </select>
            <select id="ata-lib-ans-filter" style="padding:4px 8px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;font-size:11px">
              <option value="">全部答案</option>
              <option value="A">仅 A</option>
              <option value="B">仅 B</option>
              <option value="C">仅 C</option>
              <option value="D">仅 D</option>
              <option value="multi">多选</option>
            </select>
            <button class="ata-btn purple" id="ata-lib-random" style="font-size:11px;padding:4px 8px" title="随机抽取">🎲 随机</button>
            <button class="ata-btn" id="ata-lib-clear-log" style="font-size:11px;padding:4px 8px" title="清空答题日志">🗑 日志</button>
          </div>
          <div id="ata-lib-scroll" style="overflow:auto;max-height:380px">
            <table class="ata-lib-table">
              <thead><tr><th>题目</th><th>答案</th><th>操作</th></tr></thead>
              <tbody id="ata-lib-tbody"></tbody>
            </table>
          </div>
          <div class="ata-lib-pager">
            <span id="ata-pager-info">共 0 条</span>
            <div style="display:flex;gap:4px;align-items:center">
              <button class="ata-btn" id="ata-pager-prev">◀</button>
              <input id="ata-pager-jump" type="number" min="1" placeholder="页码" style="width:50px;padding:4px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;text-align:center" />
              <button class="ata-btn" id="ata-pager-jump-btn">跳转</button>
              <button class="ata-btn" id="ata-pager-next">▶</button>
            </div>
          </div>
        </div>

        <!-- 标签管理面板 -->
        <div class="ata-pane" id="pane-tags">
          <div class="ata-tags-section">
            <div class="ata-tags-header">
              <span>🏷️ 标签列表</span>
              <button class="ata-btn green" id="ata-tag-add" style="padding:4px 12px;font-size:11px">+ 新建</button>
            </div>
            <div class="ata-tags-list" id="ata-tags-list">
              <div class="ata-tags-empty">暂无标签，点击「新建」创建</div>
            </div>
          </div>
          <div class="ata-tags-section">
            <div class="ata-tags-header">
              <span>📋 给题目打标签</span>
            </div>
            <div class="ata-tag-questions">
              <div class="ata-tag-q-input">
                <input type="text" id="ata-tag-q-search" placeholder="输入题目标题搜索..." style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;box-sizing:border-box">
              </div>
              <div class="ata-tag-q-results" id="ata-tag-q-results">
                <div class="ata-tags-empty">输入上方搜索框查找题目</div>
              </div>
              <div class="ata-tag-selected" id="ata-tag-selected" style="display:none">
                <div style="font-size:11px;color:#888;margin-bottom:4px">已选：</div>
                <div class="ata-tag-selected-q" id="ata-tag-selected-q" style="font-size:12px;word-break:break-all"></div>
              </div>
              <div class="ata-tag-assign" id="ata-tag-assign" style="margin-top:8px;display:none">
                <div style="font-size:11px;color:#888;margin-bottom:4px">分配标签：</div>
                <div class="ata-tag-checkboxes" id="ata-tag-checkboxes"></div>
                <div style="margin-top:8px">
                  <button class="ata-btn green" id="ata-tag-do-assign" style="padding:4px 12px;font-size:11px">✓ 确认分配</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="ata-pane" id="pane-export">
          <div class="ata-lib-format">
            <b>题库导出：</b><br>
            <code>JSON</code> — 完整数据，可直接导入恢复<br>
            <code>TXT</code>  — 每行 <code>题目||答案</code>，可用 Excel 编辑
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button class="ata-btn green" id="ata-export-lib-json">📤 题库 JSON</button>
            <button class="ata-btn blue"  id="ata-export-lib-txt">📤 题库 TXT</button>
          </div>
          <div style="border-top:1px solid #333;margin:10px 0"></div>
          <div class="ata-lib-format">
            <b>配置备份：</b>（账号密码、API Key、云同步配置等独立导出）<br>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="ata-btn yellow" id="ata-export-cfg">⚙️ 导出配置</button>
            <label class="ata-btn" style="display:inline-block;margin:0;cursor:pointer">
              📂 导入配置<input type="file" id="ata-import-cfg-file" accept=".json" style="display:none">
            </label>
          </div>
        </div>

        <div class="ata-pane" id="pane-import-shared">
          <div class="ata-lib-format">
            <b>从分享链接导入题库</b><br>
            粘贴他人分享的题库链接（完整 raw URL 或仓库文件路径），追加导入到本地<br>
            <small style="color:#888">示例：https://gitee.com/law-of-order/MinuteStars-AutoAnswer/raw/main/tiku_share_xxx.json</small>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin:12px 0">
            <input type="text" id="ata-import-shared-id" placeholder="粘贴分享链接或仓库路径" style="flex:1;padding:8px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;">
            <button class="ata-btn green" id="ata-do-import-shared">📥 导入</button>
          </div>
          <div id="ata-import-shared-msg" style="font-size:12px;color:#aaa"></div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);


  /* =========================================================
     题库管理 UI 逻辑
  ========================================================= */
  function refreshLibCount() {
    const total = LibraryManager.count;
    const el1 = $('#ata-lib-count'), el3 = $('#ata-lib-total');
    if (el1) el1.textContent = total;
    if (el3) el3.textContent = total;
  }

  function refreshStats() {
    const db    = getMergedDB();
    const total = Object.keys(db).length;
    let single = 0, multi = 0;
    for (const v of Object.values(db)) {
      String(v).includes(',') ? multi++ : single++;
    }
    const uc = LibraryManager.count;
    [['stat-total', total],['stat-single', single],['stat-multi', multi],['stat-user', uc],['stat-uc', uc]].forEach(([id, val]) => {
      const el = $(('#'+id)); if (el) el.textContent = val;
    });
    // 绘制饼图（按来源分布）
    const stats = LibraryManager.getSourceStats();
    const total2 = Object.keys(db).length;
    const cloudPct = total2 > 0 ? Math.round(stats.cloud / total2 * 100) : 0;
    const localPct = total2 > 0 ? Math.round(stats.local / total2 * 100) : 0;
    const bEl = $('#stat-builtin-pct'); if (bEl) bEl.textContent = cloudPct + '%';
    const uEl = $('#stat-user-pct'); if (uEl) uEl.textContent = localPct + '%';
    drawPieChart('ata-pie-canvas', [stats.cloud, stats.local], ['#5a8dee', '#48bb78']);
  }

  // 绘制饼图
  function drawPieChart(canvasId, data, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const total = data.reduce((a, b) => a + b, 0);
    if (total === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ccc';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', canvas.width / 2, canvas.height / 2);
      return;
    }
    const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 4;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let startAngle = -Math.PI / 2;
    data.forEach((val, i) => {
      if (val === 0) return;
      const slice = (val / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, startAngle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i] || '#888';
      ctx.fill();
      startAngle += slice;
    });
    // 中心文字
    ctx.fillStyle = '#5a6a7a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy);
  }

  // Tab 切换
  $$('.ata-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.ata-tab').forEach(t => t.classList.remove('active'));
      $$('.ata-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('#pane-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'stats')  refreshStats();
      if (tab.dataset.tab === 'browse') renderBrowse(1);
      if (tab.dataset.tab === 'tags')   initTagPanel();
    });
  });

  /* =========================================================
     题库标签管理
  ========================================================= */
  const TAG_DB_KEY = 'ata_tag_db';
  const TAG_MAP_KEY = 'ata_tag_map'; // 题目到标签的映射
  const TAG_COLORS = ['#5a8dee','#48bb78','#f87171','#fbbf24','#8b5cf6','#06b6d4','#ec4899','#84cc16'];
  let _tagDb = [], _tagMap = {}; // _tagMap = { '题目': ['标签1', '标签2'] }
  let _selectedTagQ = null; // 当前选中的题目

  function loadTags() {
    try { _tagDb = JSON.parse(GM_getValue(TAG_DB_KEY, '[]')); } catch { _tagDb = []; }
    try { _tagMap = JSON.parse(GM_getValue(TAG_MAP_KEY, '{}')); } catch { _tagMap = {}; }
  }
  function saveTags() {
    try { GM_setValue(TAG_DB_KEY, JSON.stringify(_tagDb)); GM_setValue(TAG_MAP_KEY, JSON.stringify(_tagMap)); } catch {}
  }

  function initTagPanel() {
    loadTags();
    renderTagsList();
    updateTagFilterOptions();
  }

  function renderTagsList() {
    const list = document.getElementById('ata-tags-list');
    if (!list) return;
    if (!_tagDb.length) {
      list.innerHTML = '<div class="ata-tags-empty">暂无标签，点击「新建」创建</div>';
      return;
    }
    const db = getMergedDB();
    list.innerHTML = _tagDb.map((t, i) => {
      const count = Object.keys(_tagMap).filter(q => _tagMap[q]?.includes(t.name)).length;
      return `<div class="ata-tag-item" data-idx="${i}">
        <span class="ata-tag-color" style="background:${t.color}"></span>
        <span class="ata-tag-name">${escHtml(t.name)}</span>
        <span class="ata-tag-count">(${count})</span>
        <button class="ata-tag-del" data-idx="${i}" title="删除">✕</button>
      </div>`;
    }).join('');
    // 更新标签复选框
    renderTagCheckboxes();
  }

  function renderTagCheckboxes() {
    const container = document.getElementById('ata-tag-checkboxes');
    if (!container) return;
    container.innerHTML = _tagDb.map(t =>
      `<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--nm-bg);border-radius:6px;font-size:11px;cursor:pointer">
        <input type="checkbox" value="${escHtml(t.name)}" style="accent-color:var(--nm-accent)">
        <span style="width:8px;height:8px;border-radius:2px;background:${t.color};display:inline-block"></span>
        ${escHtml(t.name)}
      </label>`
    ).join('');
  }

  // 新建标签
  document.getElementById('ata-tag-add')?.addEventListener('click', () => {
    const name = prompt('输入标签名称：');
    if (!name?.trim()) return;
    if (_tagDb.some(t => t.name === name.trim())) { alert('标签已存在'); return; }
    _tagDb.push({ name: name.trim(), color: TAG_COLORS[_tagDb.length % TAG_COLORS.length] });
    saveTags();
    renderTagsList();
  });

  // 删除标签
  document.getElementById('ata-tags-list')?.addEventListener('click', e => {
    const del = e.target.closest('.ata-tag-del');
    if (!del) return;
    const idx = parseInt(del.dataset.idx);
    const tagName = _tagDb[idx].name;
    if (!confirm(`确定删除标签「${tagName}」？`)) return;
    _tagDb.splice(idx, 1);
    // 从映射中移除
    for (const q in _tagMap) {
      _tagMap[q] = _tagMap[q].filter(t => t !== tagName);
      if (!_tagMap[q].length) delete _tagMap[q];
    }
    saveTags();
    renderTagsList();
  });

  // 搜索题目
  let _tagSearchT = null;
  document.getElementById('ata-tag-q-search')?.addEventListener('input', function() {
    clearTimeout(_tagSearchT);
    _tagSearchT = setTimeout(() => {
      const kw = this.value.trim().toLowerCase();
      const results = document.getElementById('ata-tag-q-results');
      if (!kw) { results.innerHTML = '<div class="ata-tags-empty">输入上方搜索框查找题目</div>'; return; }
      const db = getMergedDB();
      const matches = Object.entries(db).filter(([q]) => q.toLowerCase().includes(kw)).slice(0, 20);
      if (!matches.length) { results.innerHTML = '<div class="ata-tags-empty">未找到匹配的题目</div>'; return; }
      results.innerHTML = matches.map(([q]) => `<div class="ata-tag-q-item" data-q="${escHtml(q)}">${escHtml(q.substring(0, 80))}${q.length > 80 ? '…' : ''}</div>`).join('');
    }, 200);
  });

  // 选择题目
  document.getElementById('ata-tag-q-results')?.addEventListener('click', e => {
    const item = e.target.closest('.ata-tag-q-item');
    if (!item) return;
    $$('.ata-tag-q-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    _selectedTagQ = item.dataset.q;
    document.getElementById('ata-tag-selected').style.display = '';
    document.getElementById('ata-tag-selected-q').textContent = _selectedTagQ;
    document.getElementById('ata-tag-assign').style.display = '';
    // 勾选当前已有的标签
    const existingTags = _tagMap[_selectedTagQ] || [];
    document.querySelectorAll('#ata-tag-checkboxes input').forEach(cb => {
      cb.checked = existingTags.includes(cb.value);
    });
  });

  // 确认分配标签
  document.getElementById('ata-tag-do-assign')?.addEventListener('click', () => {
    if (!_selectedTagQ) return;
    const checked = [...document.querySelectorAll('#ata-tag-checkboxes input:checked')].map(cb => cb.value);
    if (checked.length) _tagMap[_selectedTagQ] = checked;
    else delete _tagMap[_selectedTagQ];
    saveTags();
    alert('标签分配成功！');
    renderTagsList();
  });

  $('#ata-open-lib').addEventListener('click', () => {
    modal.classList.add('show');
    refreshStats();
    renderBrowse(1);
  });
  $('#ata-lib-close').addEventListener('click', () => modal.classList.remove('show'));
  $('#ata-lib-share').addEventListener('click', async () => {
    const db = await LibraryManager.load();
    const count = Object.keys(db).length;
    if (count === 0) { uLog('题库为空，无需分享', 'warn'); return; }
    uLog('📤 正在生成分享链接...', 'info');
    if (!CFG.cloudToken) {
      uLog('⚠️ 请先在「云同步」中填写 Gitee Token', 'warn'); return;
    }
    try {
      // 创建时间戳快照文件，分享原始链接（公开可访问）
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const shareFile = 'tiku_share_' + ts + '.json';
      const content = JSON.stringify(db, null, 2);
      await _writeRepoFile(shareFile, content, '题库分享快照 ' + ts);
      const url = repoRawUrl(shareFile);
      uLog('✅ 分享成功！<br>公开链接：<a href="' + url + '" target="_blank">' + url + '</a><br><small style="color:#888">（可复制链接发送给他人，国内网络直接访问）</small>', 'ok');
    } catch (e) {
      uLog('❌ 分享失败：' + e.message, 'err');
    }
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });

  // 导入
  function showImportResult(msg, ok) {
    const el = $('#ata-import-result');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ata-import-result ' + (ok ? 'ok' : 'err');
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
  function doImport(text) {
    if (!text.trim()) { showImportResult('请输入题库内容！', false); return; }
    const r = LibraryManager.addBulk(text);
    let msg = '✅ 导入 ' + r.added + ' 条';
    if (r.skipped > 0) msg += '，跳过 ' + r.skipped + ' 条（格式错误）';
    if (r.duplicates && r.duplicates.length > 0) {
      const list = r.duplicates.slice(0, 10).map(d =>
        `<div style="margin:4px 0;padding:4px;background:#2a2a2a;border-radius:4px;font-size:11px">
          <div style="color:#ffa726">📌 ${escHtml(d.q.substring(0, 50))}${d.q.length > 50 ? '...' : ''}</div>
          <div style="color:#888">旧答案：${escHtml(d.oldAns)} → 新答案：${escHtml(d.newAns)}</div>
        </div>`
      ).join('');
      const more = r.duplicates.length > 10 ? `<div style="color:#888">...还有 ${r.duplicates.length - 10} 条重复</div>` : '';
      showImportResult(msg + `<div style="margin-top:8px"><b style="color:#fbbf24">⚠️ ${r.duplicates.length} 条重复（已覆盖）</b>${list}${more}</div>`, true);
    } else {
      showImportResult(msg, true);
    }
    refreshLibCount(); refreshStats(); renderBrowse(currentPage);
    $('#ata-bulk-text').value = '';
  }
  $('#ata-do-import').addEventListener('click', () => doImport($('#ata-bulk-text').value));
  $('#ata-do-clipboard').addEventListener('click', async () => {
    try { doImport(await navigator.clipboard.readText()); }
    catch { showImportResult('❌ 无法读取剪贴板', false); }
  });
  $('#ata-file-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { doImport(ev.target.result); e.target.value = ''; };
    r.readAsText(f);
  });

  $('#ata-do-import-shared').addEventListener('click', async () => {
    const url = $('#ata-import-shared-id')?.value?.trim();
    const msgEl = $('#ata-import-shared-msg');
    if (!url) { if (msgEl) msgEl.textContent = '⚠️ 请输入分享链接'; return; }
    if (msgEl) msgEl.textContent = '⏳ 正在导入...';
    const result = await cloudImport(url);
    if (msgEl) msgEl.textContent = result ? '✅ 导入成功！' : '❌ 导入失败，请检查链接';
  });

  /* =========================================================
     Word 文档（.docx）解析器
     原理：docx 是 zip 压缩包 → 解压 word/document.xml → DOMParser → 按段落提取题目+答案
  ========================================================= */
  function showDocxMsg(msg, ok) {
    const el = document.getElementById('ata-docx-msg');
    if (!el) return;
    // 强制 reflow 后写 innerHTML，支持 HTML 格式消息
    void el.offsetWidth;
    el.innerHTML = msg;
    el.style.color = ok ? '#66bb6a' : '#ef5350';
    // 包含交互按钮时不自动关闭
    if (!msg.includes('<button')) {
      setTimeout(() => { el.innerHTML = ''; }, 6000);
    }
  }

  /**
  // ========== Docx 解析架构（v4.8.35+，重构完成）==========

  /**
   * 新的 docx 解析入口函数（替代 parseDocxBlob）
   * 新架构：单遍XML解析 + 状态机识别
   * @param {Blob} blob - docx 文件 blob
   * @returns {Promise<{added, skipped, errors, preview, duplicates}>}
   */
  async function parseDocxDocument(blob) {
    try {
      debugLog('INFO', 'PARSE_START', '开始解析 docx 文档');
      
      // Phase 1.1: 读取文件为 ArrayBuffer
      const buffer = await blob.arrayBuffer();
      debugLog('DEBUG', 'PARSE', `文件大小: ${buffer.byteLength} bytes`);
      
      // 检查文件大小
      if (buffer.byteLength < 100) {
        throw new Error('文件过小，可能不是有效的 .docx 文件');
      }
      
      // Phase 1.2: 解压并提取 XML（新架构）
      const xmlStr = await extractDocxXML(buffer);
      
      // 检查 XML 内容
      if (!xmlStr || xmlStr.length < 100) {
        throw new Error('XML 内容为空或过小，文档可能损坏');
      }
      
      // Phase 1.3: 解析 XML 为内容块（新架构）
      const rawContentBlocks = extractContentBlocks(xmlStr);
      
      // 检查内容块
      if (rawContentBlocks.length === 0) {
        throw new Error('未提取到任何内容块，文档可能为空或格式不支持');
      }
      
      // 将多行内容块分割成单独的行
      const contentBlocks = [];
      for (const block of rawContentBlocks) {
        const lines = block.split('\n').filter(l => l.trim());
        contentBlocks.push(...lines);
      }
      debugLog('DEBUG', 'PARSE', `分割后共 ${contentBlocks.length} 行`);
      
      // 检查分割后的行数
      if (contentBlocks.length === 0) {
        throw new Error('分割后未找到任何有效行，文档内容可能为空');
      }
      
      // Phase 2: 用状态机解析 Q&A（新架构）
      const db = await LibraryManager.load();
      const qaPairs = parseWithStateMachine(contentBlocks, db);
      
      // 保存到存储（关键！状态机修改了 db 对象，需要持久化）
      if (qaPairs.added > 0) {
        await LibraryManager.save(db);
        debugLog('INFO', 'PARSE_SAVE', `已保存 ${qaPairs.added} 条题目到存储`);
      }
      
      debugLog('INFO', 'PARSE_COMPLETE', `完成: added=${qaPairs.added}, skipped=${qaPairs.skipped}`);
      
      // 如果没有添加任何题目，记录警告
      if (qaPairs.added === 0) {
        debugLog('WARN', 'PARSE_COMPLETE', '未添加任何题目，请检查文档格式');
      }
      
      return qaPairs;
      
    } catch (err) {
      console.error('[DocxParser] 解析失败:', err);
      debugLog('ERROR', 'PARSE_ERROR', err.message);
      
      // 提供用户友好的错误信息
      let userMessage = err.message;
      if (err.message.includes('JSZip')) {
        userMessage = '无法加载解压库，请检查网络连接';
      } else if (err.message.includes('word/document.xml')) {
        userMessage = '文档格式异常，可能不是有效的 .docx 文件';
      } else if (err.message.includes('XML 解析失败')) {
        userMessage = '文档内容损坏，无法解析';
      }
      
      return { 
        added: 0, 
        skipped: 0, 
        errors: [userMessage], 
        preview: [], 
        duplicates: [],
        debugLog: window.__docxDebugLog || [] // 附带调试日志
      };
    }
  }

  /**
   * 调试日志函数
   */
  // 日志级别定义
  const LogLevel = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
  };
  
  // 当前日志级别（可通过配置调整）
  let currentLogLevel = LogLevel.DEBUG;
  
  /**
   * 增强版调试日志函数
   * @param {string} level - 日志级别（ERROR/WARN/INFO/DEBUG/TRACE）
   * @param {string} category - 日志分类
   * @param {string} message - 日志消息
   * @param {*} data - 附加数据
   */
  function debugLog(level, category, message, data) {
    // 检查日志级别
    const levelNum = LogLevel[level] || LogLevel.DEBUG;
    if (levelNum > currentLogLevel) return;
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      category,
      message,
      data
    };
    
    // 存储到全局变量
    if (!window.__docxDebugLog) window.__docxDebugLog = [];
    window.__docxDebugLog.push(logEntry);
    
    // 格式化输出
    const prefix = `[DocxParser][${timestamp}][${level}][${category}]`;
    const logMessage = `${prefix} ${message}`;
    
    // 根据级别输出
    if (level === 'ERROR') {
      console.error(logMessage, data);
    } else if (level === 'WARN') {
      console.warn(logMessage, data);
    } else if (level === 'INFO') {
      console.info(logMessage, data);
    } else if (level === 'DEBUG') {
      console.debug(logMessage, data);
    } else {
      console.log(logMessage, data);
    }
  }
  
  /**
   * 显示调试日志（可在控制台调用）
   * 用法：showDocxDebugLog()
   */
  function showDocxDebugLog() {
    const log = window.__docxDebugLog || [];
    if (log.length === 0) {
      console.log('[DocxParser] 暂无调试日志');
      return;
    }
    
    console.group('[DocxParser] 调试日志');
    console.log(`共 ${log.length} 条记录`);
    console.table(log.map(entry => ({
      时间: entry.timestamp,
      级别: entry.level,
      分类: entry.category,
      消息: entry.message,
      数据: entry.data ? JSON.stringify(entry.data).substring(0, 100) : ''
    })));
    console.groupEnd();
    
    return log;
  }
  
  /**
   * 清空调试日志
   */
  function clearDocxDebugLog() {
    window.__docxDebugLog = [];
    console.log('[DocxParser] 调试日志已清空');
  }
  
  // 将调试函数暴露到全局
  window.showDocxDebugLog = showDocxDebugLog;
  window.clearDocxDebugLog = clearDocxDebugLog;

  // ========== 新架构 Phase 1.2: extractDocxXML ==========
  
  /**
   * 新架构 Phase 1.2: 解压 docx 并提取 word/document.xml
   * @param {ArrayBuffer} buffer - docx 文件内容
   * @returns {Promise<string>} XML 字符串
   */
  async function extractDocxXML(buffer) {
    debugLog('DEBUG', 'EXTRACT', '开始解压 docx');
    
    // 1. 确保 JSZip 已加载
    if (typeof JSZip === 'undefined') {
      await loadJSZip();
    }
    
    // 2. 解压
    const zip = new JSZip();
    const loaded = await zip.loadAsync(buffer);
    
    // 3. 提取 word/document.xml（尝试多种路径）
    const xmlFile = loaded.file('word/document.xml')
              || loaded.file('Word/document.xml')
              || loaded.file('WORD/DOCUMENT.XML');
    
    if (!xmlFile) {
      throw new Error('ZIP 中未找到 word/document.xml（文件格式异常）');
    }
    
    const xmlStr = await xmlFile.async('string');
    debugLog('DEBUG', 'EXTRACT', `XML 大小: ${xmlStr.length} chars`);
    
    return xmlStr;
  }
  
  /**
   * 加载 JSZip 库
   */
  function loadJSZip() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => {
        debugLog('INFO', 'JSZIP', 'JSZip 加载成功');
        resolve();
      };
      script.onerror = () => {
        reject(new Error('无法加载 JSZip（网络问题），请检查网络后重试'));
      };
      document.head.appendChild(script);
    });
  }
  
  /**
   * Phase 3: 从表格中提取文本内容
   * @param {Element} table - 表格元素
   * @returns {string[]} 表格内容数组
   */
  function extractBlocksFromTable(table) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const rows = table.getElementsByTagNameNS(ns, 'tr');
    const blocks = [];
    
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells = row.getElementsByTagNameNS(ns, 'tc');
      
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        const cellText = extractTextFromElement(cell);
        if (cellText) {
          blocks.push(cellText);
        }
      }
    }
    
    return blocks;
  }
  
  /**
   * Phase 3: 从页眉页脚中提取文本内容
   * @param {Document} doc - XML 文档
   * @returns {string[]} 页眉页脚内容数组
   */
  function extractHeadersFooters(doc) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const blocks = [];
    
    // 提取页眉
    const headers = doc.getElementsByTagNameNS(ns, 'hdr');
    for (const header of headers) {
      const headerBlocks = extractBlocksFromElement(header);
      blocks.push(...headerBlocks);
    }
    
    // 提取页脚
    const footers = doc.getElementsByTagNameNS(ns, 'ftr');
    for (const footer of footers) {
      const footerBlocks = extractBlocksFromElement(footer);
      blocks.push(...footerBlocks);
    }
    
    return blocks;
  }
  
  /**
   * Phase 3: 从元素中提取段落内容
   * @param {Element} element - XML 元素
   * @returns {string[]} 段落内容数组
   */
  function extractBlocksFromElement(element) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paras = element.getElementsByTagNameNS(ns, 'p');
    const blocks = [];
    
    for (const p of paras) {
      const text = extractTextFromElement(p);
      if (text) {
        blocks.push(text);
      }
    }
    
    return blocks;
  }
  
  /**
   * Phase 3: 从元素中提取文本内容
   * @param {Element} element - XML 元素
   * @returns {string} 文本内容
   */
  function extractTextFromElement(element) {
    const allEls = element.getElementsByTagName('*');
    let text = '';
    
    for (const el of allEls) {
      if (el.localName === 't') {
        text += el.textContent || '';
      } else if (el.localName === 'cr' || el.localName === 'br') {
        text += '\n';
      }
    }
    
    return text.split('\n').map(l => l.trim()).filter(l => l).join('\n');
  }
  
  /**
   * 新架构 Phase 1.3 + Phase 3: 解析 XML 为内容块（支持段落和表格）
   * @param {string} xmlStr - XML 字符串
   * @returns {string[]} 内容块数组
   */
  function extractContentBlocks(xmlStr) {
    debugLog('DEBUG', 'EXTRACT_BLOCKS', '开始解析 XML 为内容块');
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    
    // 检查解析错误
    const errNode = doc.querySelector('parsererror');
    if (errNode) {
      throw new Error('XML 解析失败：' + errNode.textContent);
    }
    
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const blocks = [];
    
    // Step 1: 提取主文档段落
    const paras = doc.getElementsByTagNameNS(ns, 'p');
    for (const p of paras) {
      const text = extractTextFromElement(p);
      if (text) {
        blocks.push(text);
      }
    }
    debugLog('DEBUG', 'EXTRACT_BLOCKS', `提取了 ${blocks.length} 个段落`);
    
    // Step 2: 提取表格
    const tables = doc.getElementsByTagNameNS(ns, 'tbl');
    for (const table of tables) {
      const tableBlocks = extractBlocksFromTable(table);
      blocks.push(...tableBlocks);
    }
    debugLog('DEBUG', 'EXTRACT_BLOCKS', `提取了 ${tables.length} 个表格`);
    
    // Step 3: 提取页眉页脚
    const headerFooterBlocks = extractHeadersFooters(doc);
    blocks.push(...headerFooterBlocks);
    debugLog('DEBUG', 'EXTRACT_BLOCKS', `提取了 ${headerFooterBlocks.length} 个页眉页脚块`);
    
    debugLog('DEBUG', 'EXTRACT_BLOCKS', `总共提取了 ${blocks.length} 个内容块`);
    return blocks;
  }

  /**
   * 新架构 Phase 2: 解析内容块为 Q&A 对（重构版，逻辑更清晰）
   * 从 contentBlocks (段落文本数组) 中提取题目和答案
  /**
   * Phase 2: 状态机解析函数
   * 使用状态机模式解析内容块，提取Q&A对
   */
  function parseWithStateMachine(contentBlocks, db) {
    // 状态定义
    const State = {
      LOOKING_FOR_QUESTION: 'LOOKING_FOR_QUESTION',     // 寻找题干开始
      COLLECTING_QUESTION: 'COLLECTING_QUESTION',         // 收集多行题干
      COLLECTING_OPTIONS: 'COLLECTING_OPTIONS',           // 收集选项
      FOUND_ANSWER: 'FOUND_ANSWER',                       // 找到答案行
      FOUND_ANALYSIS: 'FOUND_ANALYSIS',                   // 找到解析行
      SKIPPING_JUNK: 'SKIPPING_JUNK'                     // 跳过无关内容
    };
    
    // Helper 函数（复用自 parseQAFromParagraphsNew）
    function isCategoryTitle(line) {
      const t = line.trim();
      return /^[一二三四五六七八九][、．.\s]/.test(t) || /^第[一二三四五六七八九\d][部分章节\s]/.test(t);
    }
    
    function isQuestionStart(line) {
      return /^\d+[\.、\s　]/.test(line.trim());
    }
    
    function isOption(line) {
      return /^[A-Za-z][\.、　\s]/.test(line.trim());
    }
    
    function isAnswerLine(line) {
      return /^答案[：:]/.test(line.trim()) || /^正确答案[：:]/.test(line.trim());
    }
    
    function isAnalysisLine(line) {
      return /解析/.test(line);
    }
    
    function isEmpty(line) {
      return !line.trim();
    }
    
    function extractAnswer(fullText) {
      const match = fullText.match(/答案[：:]\s*([A-Za-z,，]+)/);
      return match ? match[1] : null;
    }
    
    function cleanQuestionText(fullText) {
      let qText = fullText
        .replace(/答案[：:][^\n]*/g, '')
        .replace(/正确答案[：:][^\n]*/g, '')
        .replace(/解析[：:][^\n]*/g, '')
        .replace(/【解析】[^\n]*/g, '')
        .trim()
        .replace(/^\d+[\.、\s　]+/, '')
        .trim();
      
      qText = qText.split('\n')
        .filter(l => !isOption(l))
        .filter(l => !/^\d+[\.、　\s]/.test(l.trim()))
        .filter(l => !isAnalysisLine(l))
        .map(l => l.replace(/\s*[A-Z][\.、　].*$/, ''))
        .filter(l => l.trim())
        .join('\n');
      
      return qText;
    }
    
    function normalizeAnswer(answer) {
      let ans = answer.toUpperCase().replace(/，/g, ',');
      if (/^[A-Z]+$/.test(ans) && ans.length > 1) {
        ans = ans.split('').join(',');
      }
      return ans;
    }
    
    // 状态机主逻辑
    let added = 0, skipped = 0;
    const preview = [];
    const duplicates = [];
    
    let state = State.LOOKING_FOR_QUESTION;
    let currentQALines = [];
    let currentAnswer = null;
    
    debugLog('DEBUG', 'STATE_MACHINE', '开始状态机解析', { totalBlocks: contentBlocks.length });
    
    for (let i = 0; i < contentBlocks.length; i++) {
      const line = contentBlocks[i];
      const trimmed = line.trim();
      
      // 跳过空行（除了在收集状态中）
      if (!trimmed && state !== State.COLLECTING_QUESTION && state !== State.COLLECTING_OPTIONS) {
        continue;
      }
      
      debugLog('TRACE', 'STATE_MACHINE', `状态: ${state}, 行: ${i}, 内容: ${trimmed.substring(0, 50)}`);
      
      switch (state) {
        case State.LOOKING_FOR_QUESTION:
          // 跳过分类标题
          if (isCategoryTitle(line)) {
            debugLog('DEBUG', 'STATE_MACHINE', '跳过分类标题', trimmed);
            continue;
          }
          // 跳过答案行（没有题干的孤立答案行）
          if (isAnswerLine(line)) {
            debugLog('DEBUG', 'STATE_MACHINE', '跳过孤立答案行', trimmed);
            continue;
          }
          
          // 找到题目开始（带题号）
          if (isQuestionStart(line)) {
            currentQALines = [line];
            currentAnswer = null;
            state = State.COLLECTING_QUESTION;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 COLLECTING_QUESTION（带题号）', trimmed.substring(0, 50));
          }
          // 无题号的题干（非空、非选项、非答案、非解析、非分类标题）→ 也当作题干开始
          else if (trimmed.length >= 4 && !isOption(line) && !isAnalysisLine(line)) {
            currentQALines = [line];
            currentAnswer = null;
            state = State.COLLECTING_QUESTION;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 COLLECTING_QUESTION（无题号）', trimmed.substring(0, 50));
          }
          break;
          
        case State.COLLECTING_QUESTION:
          // 遇到选项 → 收集选项
          if (isOption(line)) {
            currentQALines.push(line);
            state = State.COLLECTING_OPTIONS;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 COLLECTING_OPTIONS', trimmed);
          }
          // 遇到答案行 → 保存答案
          else if (isAnswerLine(line)) {
            currentQALines.push(line);
            currentAnswer = extractAnswer(line);
            state = State.FOUND_ANSWER;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 FOUND_ANSWER', trimmed);
          }
          // 遇到解析行 → 跳过
          else if (isAnalysisLine(line)) {
            state = State.FOUND_ANALYSIS;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 FOUND_ANALYSIS', trimmed);
          }
          // 遇到空行或分类标题 → 放弃当前题
          else if (isEmpty(line) || isCategoryTitle(line)) {
            debugLog('DEBUG', 'STATE_MACHINE', '题干收集失败，放弃', { lines: currentQALines.length });
            currentQALines = [];
            currentAnswer = null;
            state = State.LOOKING_FOR_QUESTION;
          }
          // 其他行 → 多行题干
          else {
            currentQALines.push(line);
          }
          break;
          
        case State.COLLECTING_OPTIONS:
          // 继续收集选项
          if (isOption(line)) {
            currentQALines.push(line);
          }
          // 遇到答案行
          else if (isAnswerLine(line)) {
            currentQALines.push(line);
            currentAnswer = extractAnswer(line);
            state = State.FOUND_ANSWER;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 FOUND_ANSWER', trimmed);
          }
          // 遇到解析行
          else if (isAnalysisLine(line)) {
            state = State.FOUND_ANALYSIS;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 FOUND_ANALYSIS', trimmed);
          }
          // 遇到下一题 → 缺少答案，跳过
          else if (isQuestionStart(line)) {
            debugLog('INFO', 'SKIP', '缺少答案，跳过当前题', { q: currentQALines.join(' ').substring(0, 80) });
            currentQALines = [line]; // 开始新题
            currentAnswer = null;
            state = State.COLLECTING_QUESTION;
          }
          // 其他内容 → 忽略
          else {
            debugLog('TRACE', 'STATE_MACHINE', '忽略无关内容', trimmed.substring(0, 30));
          }
          break;
          
        case State.FOUND_ANSWER:
          // 遇到解析行
          if (isAnalysisLine(line)) {
            state = State.FOUND_ANALYSIS;
            debugLog('DEBUG', 'STATE_MACHINE', '进入 FOUND_ANALYSIS', trimmed);
          }
          // 遇到下一题（带题号）或分类标题 → 保存当前题
          else if (isQuestionStart(line) || isCategoryTitle(line)) {
            // 保存当前题
            if (currentAnswer) {
              const fullText = currentQALines.join('\n');
              const qText = cleanQuestionText(fullText);
              
              if (qText.length >= 4) {
                const normalizedAnswer = normalizeAnswer(currentAnswer);
                
                if (db.hasOwnProperty(qText)) {
                  duplicates.push({ q: qText, oldAns: db[qText], newAns: normalizedAnswer });
                  skipped++;
                  debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: qText.substring(0, 80), oldAns: db[qText], newAns: normalizedAnswer });
                } else {
                  db[qText] = normalizedAnswer;
                  added++;
                  preview.push({ q: qText.substring(0, 60), a: normalizedAnswer });
                  debugLog('INFO', 'IMPORT', '新增题目', { q: qText.substring(0, 80), a: normalizedAnswer });
                }
              } else {
                skipped++;
                debugLog('INFO', 'SKIP', '题干过短（<4字符）', { q: qText, len: qText.length });
              }
            }
            
            // 开始下一题
            if (isQuestionStart(line)) {
              currentQALines = [line];
              currentAnswer = null;
              state = State.COLLECTING_QUESTION;
              debugLog('DEBUG', 'STATE_MACHINE', '开始新题（带题号）', trimmed.substring(0, 50));
            } else {
              currentQALines = [];
              currentAnswer = null;
              state = State.LOOKING_FOR_QUESTION;
            }
          }
          // 遇到无题号的题干（非答案、非解析、非选项、非空）→ 保存当前题并开始新题
          else if (trimmed.length >= 4 && !isAnswerLine(line) && !isOption(line) && !isEmpty(line)) {
            // 保存当前题
            if (currentAnswer) {
              const fullText = currentQALines.join('\n');
              const qText = cleanQuestionText(fullText);
              
              if (qText.length >= 4) {
                const normalizedAnswer = normalizeAnswer(currentAnswer);
                
                if (db.hasOwnProperty(qText)) {
                  duplicates.push({ q: qText, oldAns: db[qText], newAns: normalizedAnswer });
                  skipped++;
                  debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: qText.substring(0, 80), oldAns: db[qText], newAns: normalizedAnswer });
                } else {
                  db[qText] = normalizedAnswer;
                  added++;
                  preview.push({ q: qText.substring(0, 60), a: normalizedAnswer });
                  debugLog('INFO', 'IMPORT', '新增题目', { q: qText.substring(0, 80), a: normalizedAnswer });
                }
              } else {
                skipped++;
                debugLog('INFO', 'SKIP', '题干过短（<4字符）', { q: qText, len: qText.length });
              }
            }
            
            // 开始新题（无题号）
            currentQALines = [line];
            currentAnswer = null;
            state = State.COLLECTING_QUESTION;
            debugLog('DEBUG', 'STATE_MACHINE', '开始新题（无题号）', trimmed.substring(0, 50));
          }
          break;
          
        case State.FOUND_ANALYSIS:
          // 遇到下一题（带题号）或分类标题 → 保存当前题
          if (isQuestionStart(line) || isCategoryTitle(line)) {
            // 保存当前题
            if (currentAnswer) {
              const fullText = currentQALines.join('\n');
              const qText = cleanQuestionText(fullText);
              
              if (qText.length >= 4) {
                const normalizedAnswer = normalizeAnswer(currentAnswer);
                
                if (db.hasOwnProperty(qText)) {
                  duplicates.push({ q: qText, oldAns: db[qText], newAns: normalizedAnswer });
                  skipped++;
                  debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: qText.substring(0, 80), oldAns: db[qText], newAns: normalizedAnswer });
                } else {
                  db[qText] = normalizedAnswer;
                  added++;
                  preview.push({ q: qText.substring(0, 60), a: normalizedAnswer });
                  debugLog('INFO', 'IMPORT', '新增题目', { q: qText.substring(0, 80), a: normalizedAnswer });
                }
              } else {
                skipped++;
                debugLog('INFO', 'SKIP', '题干过短（<4字符）', { q: qText, len: qText.length });
              }
            }
            
            // 开始下一题
            if (isQuestionStart(line)) {
              currentQALines = [line];
              currentAnswer = null;
              state = State.COLLECTING_QUESTION;
              debugLog('DEBUG', 'STATE_MACHINE', '开始新题', trimmed.substring(0, 50));
            } else {
              currentQALines = [];
              currentAnswer = null;
              state = State.LOOKING_FOR_QUESTION;
            }
          }
          // 遇到无题号的题干 → 保存当前题并开始新题
          else if (trimmed.length >= 4 && !isAnswerLine(line) && !isOption(line) && !isEmpty(line)) {
            // 保存当前题
            if (currentAnswer) {
              const fullText = currentQALines.join('\n');
              const qText = cleanQuestionText(fullText);
              
              if (qText.length >= 4) {
                const normalizedAnswer = normalizeAnswer(currentAnswer);
                
                if (db.hasOwnProperty(qText)) {
                  duplicates.push({ q: qText, oldAns: db[qText], newAns: normalizedAnswer });
                  skipped++;
                  debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: qText.substring(0, 80), oldAns: db[qText], newAns: normalizedAnswer });
                } else {
                  db[qText] = normalizedAnswer;
                  added++;
                  preview.push({ q: qText.substring(0, 60), a: normalizedAnswer });
                  debugLog('INFO', 'IMPORT', '新增题目', { q: qText.substring(0, 80), a: normalizedAnswer });
                }
              } else {
                skipped++;
                debugLog('INFO', 'SKIP', '题干过短（<4字符）', { q: qText, len: qText.length });
              }
            }
            
            // 开始新题（无题号）
            currentQALines = [line];
            currentAnswer = null;
            state = State.COLLECTING_QUESTION;
            debugLog('DEBUG', 'STATE_MACHINE', '开始新题（无题号，从解析后）', trimmed.substring(0, 50));
          }
          // 其他行 → 忽略（解析行后面的内容）
          else {
            debugLog('TRACE', 'STATE_MACHINE', '忽略解析后内容', trimmed.substring(0, 30));
          }
          break;
      }
    }
    
    // 文档结束，保存最后一题
    if (state === State.FOUND_ANSWER || state === State.FOUND_ANALYSIS) {
      if (currentAnswer) {
        const fullText = currentQALines.join('\n');
        const qText = cleanQuestionText(fullText);
        
        if (qText.length >= 4) {
          const normalizedAnswer = normalizeAnswer(currentAnswer);
          
          if (db.hasOwnProperty(qText)) {
            duplicates.push({ q: qText, oldAns: db[qText], newAns: normalizedAnswer });
            skipped++;
            debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: qText.substring(0, 80), oldAns: db[qText], newAns: normalizedAnswer });
          } else {
            db[qText] = normalizedAnswer;
            added++;
            preview.push({ q: qText.substring(0, 60), a: normalizedAnswer });
            debugLog('INFO', 'IMPORT', '新增题目（文档末尾）', { q: qText.substring(0, 80), a: normalizedAnswer });
          }
        } else {
          skipped++;
          debugLog('INFO', 'SKIP', '题干过短（<4字符）', { q: qText, len: qText.length });
        }
      }
    }
    
    debugLog('INFO', 'STATE_MACHINE', `状态机解析完成`, { added, skipped, duplicates: duplicates.length });
    
    return { added, skipped, preview, duplicates };
  }
  
  /* =========================================================
     Excel 文档（.xlsx）解析器
     原理：xlsx 是 zip 压缩包 → 解压后解析 XML → 提取题目+答案
  ========================================================= */
  
  /**
   * 动态加载 SheetJS 库
   * @returns {Promise<void>}
   */
  function loadSheetJS() {
    return new Promise((resolve, reject) => {
      if (typeof XLSX !== 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('无法加载 SheetJS 库，请检查网络连接'));
      document.head.appendChild(script);
    });
  }
  
  /**
   * 解析 Excel 文件，提取题目和答案
   * @param {File} file - Excel 文件
   * @returns {Promise<{added: number, skipped: number, errors: string[], preview: Array, duplicates: Array}>}
   */
  async function parseExcelDocument(file) {
    try {
      // 加载 SheetJS 库
      await loadSheetJS();
      
      // 读取文件为 ArrayBuffer
      const buffer = await file.arrayBuffer();
      
      // 解析 Excel 文件
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      // 获取第一个工作表
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('Excel 文件中没有工作表');
      }
      
      const worksheet = workbook.Sheets[sheetName];
      
      // 转换为 JSON 数组（每行是一个对象）
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length === 0) {
        throw new Error('工作表为空');
      }
      
      // 查找题目和答案列
      let questionCol = -1;
      let answerCol = -1;
      
      // 检查第一行作为表头
      const headerRow = jsonData[0];
      for (let i = 0; i < headerRow.length; i++) {
        const cell = String(headerRow[i] || '').toLowerCase().trim();
        if (cell.includes('题目') || cell.includes('问题') || cell.includes('question') || cell === 'q') {
          questionCol = i;
        }
        if (cell.includes('答案') || cell.includes('answer') || cell === 'a') {
          answerCol = i;
        }
      }
      
      // 如果没有找到表头，假设第一列是题目，第二列是答案
      if (questionCol === -1 || answerCol === -1) {
        questionCol = 0;
        answerCol = 1;
      }
      
      // 加载题库
      const db = await LibraryManager.load();
      let added = 0, skipped = 0;
      const preview = [];
      const duplicates = [];
      const errors = [];
      
      // 从第二行开始处理数据（跳过表头）
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        const question = String(row[questionCol] || '').trim();
        const answer = String(row[answerCol] || '').trim();
        
        // 跳过空行
        if (!question || !answer) {
          if (question && !answer) debugLog('INFO', 'SKIP', '缺少答案，跳过', { q: question.substring(0, 80) });
          continue;
        }
        
        // 跳过题号前缀（如 "1."、"2、"）
        const cleanQuestion = question.replace(/^\d+[\.、\s　]+/, '').trim();
        
        // 标准化答案（大写，逗号分隔）
        let cleanAnswer = answer.toUpperCase().replace(/，/g, ',');
        if (/^[A-Z]+$/.test(cleanAnswer) && cleanAnswer.length > 1) {
          cleanAnswer = cleanAnswer.split('').join(',');
        }
        
        // 检查是否已存在
        if (db.hasOwnProperty(cleanQuestion)) {
          duplicates.push({ q: cleanQuestion, oldAns: db[cleanQuestion], newAns: cleanAnswer });
          skipped++;
          debugLog('INFO', 'SKIP', '重复题目（已覆盖）', { q: cleanQuestion.substring(0, 80), oldAns: db[cleanQuestion], newAns: cleanAnswer });
          continue;
        }
        
        // 添加到题库
        db[cleanQuestion] = cleanAnswer;
        added++;
        preview.push({ q: cleanQuestion.substring(0, 60), a: cleanAnswer });
        debugLog('INFO', 'IMPORT', '新增题目', { q: cleanQuestion.substring(0, 80), a: cleanAnswer });
      }
      
      // 保存到存储
      if (added > 0) {
        await LibraryManager.save(db);
      }
      
      return { added, skipped, errors, preview, duplicates };
      
    } catch (err) {
      console.error('[ExcelParser] 解析失败:', err);
      return { 
        added: 0, 
        skipped: 0, 
        errors: [err.message], 
        preview: [], 
        duplicates: [] 
      };
    }
  }
  
  // Excel 导入事件
  document.getElementById('ata-xlsx-input').addEventListener('change', async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // 检查文件扩展名
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      showDocxMsg('❌ 请选择 .xlsx 或 .xls 文件', false);
      e.target.value = '';
      return;
    }
    
    // 检查文件大小
    if (file.size < 100) {
      showDocxMsg('❌ 文件过小，可能不是有效的 Excel 文件', false);
      e.target.value = '';
      return;
    }
    
    window.__docxDebugLog = []; // 清空上次日志
    showDocxMsg('⏳ 正在解析 Excel 文档…', false);
    
    try {
      const result = await parseExcelDocument(file);
      
      if (result.errors && result.errors.length > 0) {
        showDocxMsg('❌ ' + result.errors[0], false);
        return;
      }
      
      const { added, skipped, preview, duplicates, errors = [] } = result;
      refreshLibCount();
      refreshStats();
      renderBrowse(1);
      
      // 预览前几条
      let previewHtml = '';
      if (preview.length > 0) {
        previewHtml = ' | 示例：' + preview.slice(0, 3).map(p =>
          '<span style="color:#ffa726">"' + p.q.substring(0, 30) + '…" → ' + p.a + '</span>'
        ).join(' &nbsp; ');
      }
      
      if (added === 0 && skipped === 0) {
        showDocxMsg('❌ 未找到任何题目（请确认 Excel 格式：第一列为题目，第二列为答案）', false);
      } else {
        let dupHtml = '';
        if (duplicates && duplicates.length > 0) {
          const list = duplicates.slice(0, 10).map(d =>
            `<div style="margin:4px 0;padding:4px;background:#2a2a2a;border-radius:4px;font-size:11px">
              <div style="color:#ffa726">📌 ${escHtml(d.q.substring(0, 50))}${d.q.length > 50 ? '...' : ''}</div>
              <div style="color:#888">旧答案：${escHtml(d.oldAns)} → 新答案：${escHtml(d.newAns)}</div>
            </div>`
          ).join('');
          const more = duplicates.length > 10 ? `<div style="color:#888">...还有 ${duplicates.length - 10} 条重复</div>` : '';
          dupHtml = `<div style="margin-top:8px"><b style="color:#fbbf24">⚠️ ${duplicates.length} 条重复（已覆盖）</b>${list}${more}</div>`;
        }

        const logCount = (window.__docxDebugLog || []).length;
        const exportBtn = logCount > 0
          ? `<div style="margin-top:6px"><button id="ata-export-docx-log" style="background:#555;color:#ddd;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px">📋 导出本次解析日志（${logCount} 条）</button></div>`
          : '';
        showDocxMsg(
          '✅ 成功导入 <b style="color:#66bb6a">' + added + '</b> 条' +
          (skipped > 0 ? '，跳过 <b style="color:#ffa726">' + skipped + '</b> 条（已存在）' : '') +
          dupHtml + previewHtml + exportBtn,
          true
        );
        uLog('📊 Excel文档导入：新增 ' + added + ' 条（跳过 ' + skipped + ' 条）', added > 0 ? 'ok' : 'warn');
      }
    } catch (err) {
      console.error('[ATA] Excel parse error:', err);
      showDocxMsg('❌ 解析失败: ' + err.message, false);
    }

    // 绑定导出日志按钮
    setTimeout(() => {
      const btn = document.getElementById('ata-export-docx-log');
      if (btn) {
        btn.addEventListener('click', () => {
          const log = window.__docxDebugLog || [];
          const content = JSON.stringify(log, null, 2);
          const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
          downloadFile(content, 'Excel解析日志_' + date + '.json', 'application/json');
        });
      }
    }, 100);

    e.target.value = '';
  });
  
  // Word 文档导入事件（支持多文件）
  document.getElementById('ata-docx-input').addEventListener('change', async function (e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // 验证所有文件
    for (const file of files) {
      if (!file.name.endsWith('.docx')) {
        showDocxMsg('❌ 请选择 .docx 文件（不是 .doc）：' + file.name, false);
        e.target.value = '';
        return;
      }
      if (file.size < 500) {
        showDocxMsg('❌ 文件过小（' + file.size + ' 字节），可能不是有效的 .docx：' + file.name, false);
        e.target.value = '';
        return;
      }
    }

    const fileCount = files.length;
    window.__docxDebugLog = []; // 清空上次日志，只保留本次导入
    showDocxMsg('⏳ 正在解析 ' + fileCount + ' 个 Word 文档…', false);

    let totalAdded = 0, totalSkipped = 0;
    const allDuplicates = [];
    const allPreview = [];
    const errors = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showDocxMsg('⏳ 正在解析 (' + (i + 1) + '/' + fileCount + ')：' + file.name, false);

        const result = await parseDocxDocument(file);

        if (result.errors && result.errors.length > 0) {
          errors.push(file.name + '：' + result.errors[0]);
          continue;
        }

        totalAdded += result.added;
        totalSkipped += result.skipped;
        if (result.duplicates) allDuplicates.push(...result.duplicates);
        if (result.preview) allPreview.push(...result.preview);
      }

      refreshLibCount();
      refreshStats();
      renderBrowse(1);

      // 预览前几条
      let previewHtml = '';
      if (allPreview.length > 0) {
        previewHtml = ' | 示例：' + allPreview.slice(0, 3).map(p =>
          '<span style="color:#ffa726">"' + p.q.substring(0, 30) + '…" → ' + p.a + '</span>'
        ).join(' &nbsp; ');
      }

      if (totalAdded === 0 && totalSkipped === 0) {
        let errMsg = '❌ 未找到任何题目（请确认文档格式：需包含「答案：X」格式）';
        if (errors.length > 0) {
          errMsg += '<br>' + errors.join('<br>');
        }
        showDocxMsg(errMsg, false);
      } else {
        let dupHtml = '';
        if (allDuplicates.length > 0) {
          const list = allDuplicates.slice(0, 10).map(d =>
            `<div style="margin:4px 0;padding:4px;background:#2a2a2a;border-radius:4px;font-size:11px">
              <div style="color:#ffa726">📌 ${escHtml(d.q.substring(0, 50))}${d.q.length > 50 ? '...' : ''}</div>
              <div style="color:#888">旧答案：${escHtml(d.oldAns)} → 新答案：${escHtml(d.newAns)}</div>
            </div>`
          ).join('');
          const more = allDuplicates.length > 10 ? `<div style="color:#888">...还有 ${allDuplicates.length - 10} 条重复</div>` : '';
          dupHtml = `<div style="margin-top:8px"><b style="color:#fbbf24">⚠️ ${allDuplicates.length} 条重复（已覆盖）</b>${list}${more}</div>`;
        }

        let errHtml = '';
        if (errors.length > 0) {
          errHtml = '<div style="margin-top:8px;color:#ef5350">⚠️ 部分文件解析失败：<br>' + errors.join('<br>') + '</div>';
        }

        const fileHint = fileCount > 1 ? '（' + fileCount + ' 个文件）' : '';
        const logCount = (window.__docxDebugLog || []).length;
        const exportBtn = logCount > 0
          ? `<div style="margin-top:6px"><button id="ata-export-docx-log" style="background:#555;color:#ddd;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px">📋 导出本次解析日志（${logCount} 条）</button></div>`
          : '';
        showDocxMsg(
          '✅ 成功导入 <b style="color:#66bb6a">' + totalAdded + '</b> 条' + fileHint +
          (totalSkipped > 0 ? '，跳过 <b style="color:#ffa726">' + totalSkipped + '</b> 条（已存在）' : '') +
          dupHtml + previewHtml + errHtml + exportBtn,
          true
        );
        uLog('📄 Word文档导入：新增 ' + totalAdded + ' 条（跳过 ' + totalSkipped + ' 条，' + fileCount + ' 个文件）', totalAdded > 0 ? 'ok' : 'warn');
      }
    } catch (err) {
      console.error('[ATA] Docx parse error:', err);
      let msg = '❌ 解析失败';

      // 区分不同错误类型
      if (err.message.includes("Can't find end of central directory")) {
        msg = '❌ 文件格式错误：请确认是 .docx 而非 .doc 格式<br><small style="color:#888">提示：.doc 是旧版 Word 格式，需要另存为 .docx 后重试</small>';
      } else if (err.message.includes('load')) {
        msg = '❌ 文件损坏或不是有效的 Word 文档';
      } else {
        msg = '❌ 解析失败：' + err.message;
      }
      
      showDocxMsg(msg, false);
    }

    // 绑定导出日志按钮（如果有）
    setTimeout(() => {
      const btn = document.getElementById('ata-export-docx-log');
      if (btn) {
        btn.addEventListener('click', () => {
          const log = window.__docxDebugLog || [];
          const content = JSON.stringify(log, null, 2);
          const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
          downloadFile(content, 'Docx解析日志_' + date + '.json', 'application/json');
        });
      }
    }, 100);

    e.target.value = '';
  });

  // 单条添加
  let _singleT = null;
  function showSingleMsg(msg, ok) {
    const el = $('#ata-single-msg');
    if (!el) return;
    el.textContent = msg; el.style.color = ok ? '#66bb6a' : '#ef5350';
    clearTimeout(_singleT);
    _singleT = setTimeout(() => { el.textContent = ''; }, 3000);
  }
  $('#ata-single-add').addEventListener('click', () => {
    const q = $('#ata-single-q').value.trim(), a = $('#ata-single-a').value.trim();
    if (!q) { showSingleMsg('请输入题目！', false); return; }
    if (!a) { showSingleMsg('请输入答案！', false); return; }
    LibraryManager.add(q, a);
    $('#ata-single-q').value = ''; $('#ata-single-a').value = '';
    refreshLibCount(); refreshStats();
    showSingleMsg('✅ 已添加（自定义 ' + LibraryManager.count + ' 条）', true);
  });
  $('#ata-single-q').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ata-single-a').focus(); });
  $('#ata-single-a').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ata-single-add').click(); });

  // 导出
  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('#ata-export-lib-json').addEventListener('click', () => {
    downloadFile(JSON.stringify(getMergedDB(), null, 2), 'MinuteStars题库_all_' + Date.now() + '.json', 'application/json');
  });
  $('#ata-export-lib-txt').addEventListener('click', () => {
    const all = getMergedDB();
    const txt = Object.entries(all).map(([q, a]) => q + '||' + a).join('\n');
    downloadFile(txt, 'MinuteStars题库_' + Date.now() + '.txt', 'text/plain;charset=utf-8');
  });
  $('#ata-export-cfg').addEventListener('click', () => {
    // 导出配置（不含题库，分离备份）
    const cfgExport = {
      version: SCRIPT_VERSION,
      timestamp: new Date().toISOString(),
      config: CFG,
    };
    downloadFile(JSON.stringify(cfgExport, null, 2), 'ATA_Config_' + Date.now() + '.json', 'application/json');
  });
  $('#ata-import-cfg-file').addEventListener('change', function() {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.config) {
          Object.assign(CFG, CFG_DEFAULT, data.config);
          saveCFG();
          syncSettingsUI();
          uLog('✅ 配置已导入，请保存设置', 'ok');
          gmNotify('配置导入', '配置已成功导入！');
        } else { uLog('⚠️ 配置文件格式无效', 'warn'); }
      } catch { uLog('❌ 配置文件解析失败', 'err'); }
      this.value = '';
    };
    reader.readAsText(file);
  });
  $('#ata-clear-lib').addEventListener('click', () => {
    const confirmEl = $c('#ata-clear-confirm');
    if (confirmEl) confirmEl.style.display = confirmEl.style.display ? '' : 'none';
  });
  $c('#ata-clear-yes')?.addEventListener('click', () => {
    LibraryManager.clear();
    _cache.dirty = true;
    refreshLibCount(); refreshStats(); renderBrowse(1);
    const confirmEl = $c('#ata-clear-confirm');
    if (confirmEl) confirmEl.style.display = 'none';
    uLog('已清空全部自定义题库', 'warn');
  });
  $c('#ata-clear-no')?.addEventListener('click', () => {
    const confirmEl = $c('#ata-clear-confirm');
    if (confirmEl) confirmEl.style.display = 'none';
  });

  // 浏览题库（分页）
  let currentPage = 1;
  const PAGE_SIZE = 20;

  /** 高亮搜索关键词（支持纯文本和正则） */
  function _highlight(text, keyword, isRegex) {
    if (!keyword) return escHtml(text);
    try {
      if (isRegex) {
        const re = new RegExp('(' + keyword + ')', 'gi');
        return escHtml(text).replace(re, '<mark style="background:#ffd740;color:#333;border-radius:2px;padding:0 2px">$1</mark>');
      } else {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(' + escaped + ')', 'gi');
        return escHtml(text).replace(re, '<mark style="background:#ffd740;color:#333;border-radius:2px;padding:0 2px">$1</mark>');
      }
    } catch { return escHtml(text); }
  }

  /* ---- 提取：构建题库浏览表格行 ---- */
  function buildBrowseRows(entries, page, keyword, useRegex) {
    const tbody = $c('#ata-lib-tbody');
    if (!tbody) return;
    const start = (page - 1) * PAGE_SIZE;
    const slice = entries.slice(start, start + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    if (!slice.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" style="text-align:center;color:#666;padding:20px">没有匹配的题目</td>';
      frag.appendChild(tr);
    }
    slice.forEach(([q, a]) => {
      const qHtml = _highlight(q, keyword, useRegex);
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="q-cell">' + qHtml + '</td>'
        + '<td style="color:#ffa726;font-weight:bold">' + escHtml(String(a)) + '</td>'
        + '<td><button class="del-btn" data-q="' + escHtml(q) + '">删除</button></td>';
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }
  /* ---- 提取：渲染分页控件 ---- */
  function renderPager(total, page) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $c('#ata-pager-info').textContent = '共 ' + total + ' 条，第 ' + page + '/' + totalPages + ' 页';
    $c('#ata-pager-prev').disabled = page <= 1;
    $c('#ata-pager-next').disabled = (page - 1) * PAGE_SIZE + PAGE_SIZE >= total;
    $c('#ata-pager-jump').max = totalPages;
  }

  function renderBrowse(page) {
    currentPage = page;
    const searchEl  = $c('#ata-lib-search');
    const filterEl  = $c('#ata-lib-filter');
    const tagFilterEl = $c('#ata-lib-tag-filter');
    const ansFilterEl = $c('#ata-lib-ans-filter');
    const regexEl  = $c('#ata-lib-regex');
    const keyword  = searchEl ? searchEl.value : '';
    const filter   = filterEl ? filterEl.value : 'all';
    const tagFilter = tagFilterEl ? tagFilterEl.value : '';
    const ansFilter = ansFilterEl ? ansFilterEl.value : '';
    const useRegex = regexEl && regexEl.checked;
    const db       = getMergedDB();

    let entries = Object.entries(db);
    // ── 关键词/正则过滤 ──
    if (keyword) {
      if (useRegex) {
        try {
          const re = new RegExp(keyword, 'i');
          entries = entries.filter(([q]) => re.test(q));
        } catch { entries = entries.filter(([q]) => q.includes(keyword)); }
      } else {
        const kw = keyword.toLowerCase();
        entries = entries.filter(([q]) => q.toLowerCase().includes(kw));
      }
    }
    // ── 分类过滤 ──
    entries = entries.filter(([q]) => {
      if (filter === 'builtin') return false;
      if (filter === 'user')    return true;
      return true;
    });
    // ── 标签过滤 ──
    if (tagFilter) {
      entries = entries.filter(([q]) => {
        const tags = _tagMap[q] || [];
        return tags.includes(tagFilter);
      });
    }
    // ── 答案过滤 ──
    if (ansFilter) {
      entries = entries.filter(([, a]) => {
        if (ansFilter === 'multi') {
          return String(a).includes(',');
        }
        return String(a).includes(ansFilter);
      });
    }
    // ── 随机模式 ──
    if ($c('#ata-lib-random')?.dataset.random === '1') {
      entries = [...entries].sort(() => Math.random() - 0.5);
    }

    const total   = entries.length;
    buildBrowseRows(entries, page, keyword, useRegex);
    renderPager(total, page);
  }
  // ⚡ 搜索防抖（300ms），避免每次按键都触发全量过滤+渲染
  let _searchT = null;
  $('#ata-lib-search').addEventListener('input', () => { clearTimeout(_searchT); _searchT = setTimeout(() => renderBrowse(1), 300); });
  $('#ata-lib-filter').addEventListener('change', () => renderBrowse(1));
  // v4.5.39 新增浏览控件
  $c('#ata-lib-regex')?.addEventListener('change', () => renderBrowse(1));
  $c('#ata-lib-ans-filter')?.addEventListener('change', () => renderBrowse(1));
  $c('#ata-lib-tag-filter')?.addEventListener('change', () => renderBrowse(1));

  // 更新标签筛选下拉框
  function updateTagFilterOptions() {
    const select = $c('#ata-lib-tag-filter');
    if (!select) return;
    const current = select.value;
    const options = _tagDb.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
    select.innerHTML = '<option value="">全部标签</option>' + options;
    select.value = current;
  }
  updateTagFilterOptions();
  $c('#ata-lib-random')?.addEventListener('click', function() {
    this.dataset.random = this.dataset.random === '1' ? '0' : '1';
    this.textContent = this.dataset.random === '1' ? '✅ 随机' : '🎲 随机';
    this.className = this.dataset.random === '1' ? 'ata-btn green' : 'ata-btn purple';
    renderBrowse(1);
  });
  $c('#ata-lib-clear-log')?.addEventListener('click', () => {
    _clearAnswerLog();
    uLog('答题日志已清空', 'info');
  });
  $('#ata-pager-prev').addEventListener('click', () => { if (currentPage > 1) renderBrowse(currentPage - 1); });
  $('#ata-pager-next').addEventListener('click', () => renderBrowse(currentPage + 1));
  $('#ata-pager-jump-btn').addEventListener('click', () => {
    const jumpPage = parseInt($('#ata-pager-jump').value);
    const totalPages = Math.max(1, Math.ceil(Object.entries(getMergedDB()).length / PAGE_SIZE));
    if (jumpPage >= 1 && jumpPage <= totalPages) renderBrowse(jumpPage);
  });
  $('#ata-pager-jump').addEventListener('keypress', e => { if (e.key === 'Enter') $('#ata-pager-jump-btn').click(); });
  $('#ata-lib-tbody').addEventListener('click', e => {
    if (e.target.classList.contains('del-btn')) {
      LibraryManager.remove(e.target.dataset.q);
      refreshLibCount(); refreshStats(); renderBrowse(currentPage);
    }
  });

  /* =========================================================
     答题核心逻辑
  ========================================================= */
  const logEl      = $('#ata-log');
  const statusDot  = $('#ata-status-dot');
  const statusText = $('#ata-status-text');

  function uLog(msg, cls) {
    if (!logEl) return;
    const colors = { ok:'#4ade80', warn:'#fbbf24', err:'#f87171', info:'#94a3b8' };
    const c = colors[cls] || '#94a3b8';
    const t = new Date().toLocaleTimeString();
    const d = document.createElement('div');
    d.innerHTML = '<span style="color:' + c + '">[' + t + '] ' + escHtml(msg) + '</span>';
    logEl.prepend(d);
    console.log('[ATA Pro]', msg);
  }

  function setProgress(cur, total) {
    const bar = $c('#ata-bar'), pctEl = $c('#ata-prog-pct');
    const pct = total ? Math.round(cur / total * 100) : 0;
    if (bar)   bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  function setRunningStatus(txt, mode) {
    if (statusDot)  statusDot.className  = 'ata-status-dot ' + (mode || 'idle');
    if (statusText) statusText.textContent = txt;
  }

  /** 从 MinuteStars .answer 容器提取题目文本 */
  function getQText(el) {
    const titleEl = el.querySelector('.title');
    if (titleEl) {
      return (titleEl.textContent || titleEl.innerText || '')
        .replace(/\(\d+分?\)/g, '')            // 去掉分值 (10分)
        .replace(/\s+/g, ' ')
        .trim();
    }
    // 兜底：提取全文本，去掉选项区域
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input').forEach(inp => {
      const lab = inp.closest('label') || inp.parentElement;
      lab && lab.remove();
    });
    return clone.textContent
      .replace(/\s+/g, ' ').trim().substring(0, 300);
  }

  /** 找到页面上所有题目容器 */
  let _qContainersCache = null;
  function findQContainers() {
    // 缓存命中：所有元素仍在 DOM 中
    if (_qContainersCache && _qContainersCache.length > 0 && _qContainersCache[0].isConnected) {
      return _qContainersCache;
    }
    // MinuteStars 主策略：.answer 容器
    const ms = $$('.answer');
    if (ms.length > 0) { _qContainersCache = ms; return ms; }

    // 通用策略：按 input name 分组，向上找题目容器
    const groups = new Map();
    $$('input[type="radio"],input[type="checkbox"]').forEach(inp => {
      if (!inp.name) return;
      if (!groups.has(inp.name)) groups.set(inp.name, []);
      groups.get(inp.name).push(inp);
    });
    const result = [...groups.values()].map(inps => {
      let el = inps[0].parentElement;
      for (let i = 0; i < 6 && el; el = el.parentElement, i++) {
        if (el.querySelectorAll('input[type="radio"],input[type="checkbox"]').length > 1) return el;
      }
      return inps[0].closest('li, .item, .question, fieldset') || inps[0].parentElement;
    }).filter(Boolean);
    _qContainersCache = result;
    return result;
  }

  /** 多策略勾选（兼容自定义 UI 组件） */
  async function checkInput(input) {
    if (input.checked) return;
    // 必须用元素所属文档的 defaultView，避免 Tampermonkey sandbox window 与页面 window 不一致
    const pageWin = input.ownerDocument.defaultView;
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

    // --- 优先：触发 label（自定义组件的标准入口）---
    const label = input.closest('label') || (input.id ? pageWin.document.querySelector('label[for="'+input.id+'"]') : null);
    if (label) {
      label.click();
      for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup','pointerclick']) {
        label.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
      }
    }

    // --- 原生 input click + 全套事件（兜底）---
    input.click();
    for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup']) {
      input.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
    }
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.dispatchEvent(new Event('input',  { bubbles:true }));

    // --- disabled / hidden 时的父链兜底 ---
    if (input.disabled || input.type === 'hidden') {
      let p = input.parentElement;
      for (let i = 0; i < 4 && p; p = p.parentElement, i++) {
        if (getComputedStyle(p).cursor === 'pointer' || p.tagName === 'LABEL') {
          p.click();
          for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup']) {
            p.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
          }
          break;
        }
      }
    }

    await sleep(80);
    if (!input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles:true }));
      input.dispatchEvent(new Event('input',  { bubbles:true }));
    }
  }

  async function uncheckInput(input) {
    if (!input.checked) return;
    const pageWin = input.ownerDocument.defaultView;
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    input.click();
    for (const ev of ['mousedown','mouseup','click']) {
      input.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
    }
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await sleep(30);
    if (input.checked) { input.checked = false; input.dispatchEvent(new Event('change', {bubbles:true})); }
  }

  /** 根据答案字符串填写选项 */
  async function fill(container, answer) {
    const inputs = Array.from(container.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
    if (!inputs.length) return false;
    const norm = s => (s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    /**
     * 提取选项文本：MinuteStars 结构为 <label><input ...> A. 对</label>
     * nextElementSibling 可能为 null（input 是 label 子节点时文字是 TextNode）
     */
    function getOptionText(inp) {
      // 直接取 label 的完整文本，去掉 input 本身（textContent 会跳过元素）
      const label = inp.closest('label') || inp.parentElement;
      if (!label) return inp.value || '';
      return label.textContent.replace(/\s+/g, ' ').trim();
    }

    // 判断题（answer 为 'true' / 'false' / true / false）
    if (answer === true || answer === 'true') {
      for (const i of inputs) {
        const txt = getOptionText(i).toLowerCase();
        if (txt.includes('对') || txt.includes('正确') || txt.includes('true') ||
            norm(i.value) === 'A' || norm(i.value) === '1' || norm(i.value) === 'T') {
          await checkInput(i); return true;
        }
      }
      // 兜底：选第一项（通常是"对"）
      await checkInput(inputs[0]); return true;
    }
    if (answer === false || answer === 'false') {
      for (const i of inputs) {
        const txt = getOptionText(i).toLowerCase();
        if (txt.includes('错') || txt.includes('错误') || txt.includes('false') ||
            norm(i.value) === 'B' || norm(i.value) === '0' || norm(i.value) === 'F') {
          await checkInput(i); return true;
        }
      }
      // 兜底：选最后一项（通常是"错"）
      await checkInput(inputs[inputs.length - 1]); return true;
    }

    // 单选/多选：answer 可以是 "A" / "A,B" / ["A","B"] 等
    // 关键：先 split 再 norm，防止 norm 先吞掉逗号导致 "A,D" → "AD"
    const letters = Array.isArray(answer)
      ? answer.map(norm)
      : String(answer).split(',').map(s => norm(s.trim())).filter(Boolean);

    for (const i of inputs) {
      const v    = norm(i.value);
      const txt  = getOptionText(i);
      const lbl1 = txt.trim().charAt(0).toUpperCase();
      // 同时匹配 value 和 label 首字母
      const shouldCheck = letters.includes(v)
        || (/[A-Z]/.test(lbl1) && letters.includes(lbl1));
      if (shouldCheck) { await checkInput(i); await sleep(30); }  // 每项间隔 30ms，确保事件顺序
      else if (i.type === 'checkbox' && i.checked) { await uncheckInput(i); await sleep(20); }
    }
    return true;
  }

  /* =========================================================
     提交试卷
  ========================================================= */
  /**
   * 保存答题（不交卷），用于答题中途保存进度
   */
  function doSave() {
    // MinuteStars 专属：#btnSavePapers（保存答题按钮）
    const saveBtn = $('#btnSavePapers');
    if (saveBtn) { uLog('💾 保存答题进度', 'ok'); saveBtn.click(); return; }
    uLog('⚠️ 未找到保存按钮', 'warn');
  }

  function doSubmit() {
    // 清理倒计时状态
    clearInterval(submitTickId);
    submitTickId = null;
    running = false;
    paused  = false;
    inCountdown = false;
    const pBtn = $('#ata-pause');
    if (pBtn) { pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    gmNotify('提交答题', '正在提交试卷…');

    const sels = [
      // MinuteStars 专属提交按钮（优先）
      '#btnSubmitPapers',
      // 通用备选
      '#btnSubmit','#btnSave','#btn_submit','#SubmitBtn',
      'input[id*="Submit"]','input[id*="submit"]','button[id*="Submit"]',
      'input[type="submit"]','button[type="submit"]',
      '.submit-btn','.btn-submit','[class*="submit"]',
      'input[value*="提交"]','button[value*="提交"]'
    ];
    for (const sel of sels) {
      const btn = $(sel);
      if (btn && !btn.disabled) { uLog('✅ 点击提交: ' + sel, 'ok'); btn.click(); return; }
    }
    // 文字匹配
    const btns = $$('input[type="submit"],input[type="button"],button,a.btn');
    for (const b of btns) {
      const t = (b.value || b.textContent || '').replace(/\s/g,'');
      if (['提交','交卷','完成','提交试卷','确认提交'].includes(t)) {
        uLog('提交: ' + t, 'ok'); b.click(); return;
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', ctrlKey:true, bubbles:true }));
    uLog('⚠️ 未找到提交按钮，尝试 Ctrl+Enter', 'warn');
  }

  /* =========================================================
     采集答案（从已批改答案页学习）
     适配 MinuteStars 结果页(viewanswer.aspx)专用结构：
     正确答案是容器底部 <div class="radio"> 汇总区中的
     <span class="answer-badge reference">正确答案</span>
     同级紧邻的 <span class="ml-l"> 文本
  ========================================================= */
  function collectAnswers() {
    uLog('开始采集答案…', 'info');
    const containers = findQContainers();
    let cnt = 0, skip = 0;
    containers.forEach(c => {
      const qText = getQText(c);
      if (!qText || qText.length < 4) { skip++; return; }

      /** 策略一：MinuteStars 结果页结构（高优先级） */
      const refBadge = c.querySelector('.answer-badge.reference');
      let answer = null;
      if (refBadge) {
        // 正确答案 = reference badge 后面紧邻的 .ml-l 元素
        let sibling = refBadge.nextElementSibling;
        while (sibling) {
          if (sibling.classList && sibling.classList.contains('ml-l')) {
            const txt = (sibling.textContent || '').trim().toUpperCase();
            if (/^[A-Z]$/.test(txt)) { answer = txt; break; }
            // .ml-l 里可能还有子 span，递归取直接文本
            const direct = Array.from(sibling.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim().toUpperCase())
              .join('');
            if (/[A-Z]/.test(direct)) { answer = direct.match(/[A-Z]/)[0]; break; }
          }
          sibling = sibling.nextElementSibling;
        }
        // 兜底：reference badge 的父级 .mt-1 下的所有直接文本节点
        if (!answer) {
          const mt1 = refBadge.closest('.mt-1');
          if (mt1) {
            const direct = Array.from(mt1.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim().toUpperCase())
              .join('');
            if (/[A-Z]/.test(direct)) answer = direct.match(/[A-Z]/)[0];
          }
        }
      }

      /** 策略二：其他批改页通用标记（无 reference badge 时退化） */
      if (!answer) {
        const inputs = Array.from(c.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
        const correct = inputs.filter(i => {
          const p = i.closest('label,li,div,td,tr');
          if (!p) return false;
          if (i.getAttribute('data-correct') === 'true' || i.getAttribute('data-answer') === 'true') return true;
          const cls = (p.className || '').toLowerCase();
          if (/\b(correct|right|answer-right|true|正确)\b/.test(cls)) return true;
          const cs = getComputedStyle(p);
          const tc = cs.color;
          if (/^rgb\(\s*0\s*,\s*(?:6\d|7\d|8\d|9\d|1[012]\d)\s*,\s*0\s*\)$/.test(tc)) return true;
          if (/^rgb\(\s*0\s*,\s*(?:1[2-9]\d|2\d{2})\s*,\s*(?:0|6\d|7\d|8\d)\s*\)$/.test(tc)) return true;
          return false;
        });
        if (correct.length > 0) {
          answer = correct.map(inp => {
            const v = (inp.value || '').trim().toUpperCase();
            if (/^[A-Z]$/.test(v)) return v;
            const label = inp.closest('label') || inp.parentElement;
            const lbl = label ? label.textContent.trim().charAt(0).toUpperCase() : '';
            return /[A-Z]/.test(lbl) ? lbl : v;
          }).filter(Boolean).join(',');
        }
      }

      if (!answer) { skip++; return; }

      // 去重
      const db  = LibraryManager.load();
      const nq  = cleanText(qText);
      const dup = Object.keys(db).some(k => cleanText(k) === nq);
      if (!dup) {
        LibraryManager.add(qText, answer);
        cnt++;
      } else {
        skip++;
      }
    });
    uLog('采集完成，新增 ' + cnt + ' 条，跳过 ' + skip + ' 条', cnt > 0 ? 'ok' : 'warn');
    refreshLibCount();
    refreshStats();
    if (cnt > 0) gmNotify('题库更新', '新增 ' + cnt + ' 条题目！');
  }

  /* =========================================================
     扫描结构（调试）
  ========================================================= */
  function debugScan() {
    const containers = findQContainers();
    const info = [
      'URL: ' + location.href,
      '题目容器数: ' + containers.length,
      'radio/checkbox 总数: ' + $$('input[type=radio],input[type=checkbox]').length,
      '提交按钮: ' + $$('input[type=submit],button[type=submit]').map(b => b.value || b.textContent).join(' | ')
    ];
    if (containers.length > 0) {
      const q0Text = getQText(containers[0]);
      info.push('--- 第1题预览 ---', '题干: ' + q0Text.substring(0, 100));
    }
    const report = info.join('\n');
    console.log('[ATA Pro DEBUG]\n' + report);
    uLog(report.replace(/\n/g, ' | ').substring(0, 300), 'info');
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #ccc;border-radius:8px;padding:20px;z-index:2147483646;max-width:80vw;max-height:80vh;overflow:auto;font-size:12px;white-space:pre;box-shadow:0 4px 20px rgba(0,0,0,.3);';
    div.textContent = report;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭'; closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;padding:3px 10px;cursor:pointer;border:1px solid #ccc;border-radius:4px;';
    closeBtn.onclick = () => div.remove();
    div.appendChild(closeBtn);
    document.body.appendChild(div);
  }

  /* =========================================================
     主答题流程
  ========================================================= */
  let running = false;
  let paused  = false;
  let inCountdown = false;  // 是否处于提交倒计时阶段
  let submitTickId = null;  // 提交倒计时 interval ID
  let submitRem    = 0;     // 提交倒计时剩余秒数

  function handleSubmitCountdown(minS, maxS) {
    submitRem = minS + Math.floor(Math.random() * (maxS - minS + 1));
    uLog('⏳ ' + submitRem + ' 秒后自动提交…（可暂停倒计时）', 'warn');
    inCountdown = true;
    const pBtn = $('#ata-pause');
    if (pBtn) { pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    const startTick = () => {
      clearInterval(submitTickId);
      submitTickId = setInterval(() => {
        if (paused) {
          if (inCountdown && submitRem > 0) {
            setRunningStatus('⏸ 倒计时已暂停（剩余 ' + submitRem + 's）', 'running');
          }
          return;
        }
        submitRem--;
        if (inCountdown) {
          setRunningStatus('⏳ ' + submitRem + ' 秒后提交…', 'running');
        }
        if (submitRem <= 0) {
          clearInterval(submitTickId);
          submitTickId = null;
          doSubmit();
        }
      }, 1000);
    };
    startTick();
  }

  function updateStatsCards({ ok, infer, skip, i, total, libCnt, ruleCnt }) {
    const pct = Math.round((i + 1) / total * 100);
    setProgress(i + 1, total);
    const statAns = $c('#ata-stat-answered');
    const statHit = $c('#ata-stat-hit');
    const statMiss = $c('#ata-stat-miss');
    if (statAns)  statAns.textContent  = i + 1;
    if (statHit)  statHit.textContent   = ok + infer;
    if (statMiss) statMiss.textContent  = skip;
    return pct;
  }

  /* ---- 提取：题目遍历与答题核心逻辑 ---- */
  async function processQuestions(containers, seenQ) {
    let ok = 0, skip = 0, infer = 0, libCnt = 0, ruleCnt = 0;
    _speedTimes = [];
    let _speedStart = Date.now();
    const speedWrap = document.getElementById('ata-speed-wrap');
    if (speedWrap) speedWrap.style.display = '';
    _recentLogs = [];
    renderRecentLogs();

    for (let i = 0; i < containers.length; i++) {
      if (!running) break;
      const c   = containers[i];
      const txt = getQText(c);
      const nq  = cleanText(txt);
      if (seenQ.has(nq)) { skip++; continue; }
      seenQ.add(nq);

      const ans = findMatch(txt);
      let matchedAnswer = null, matchMethod = 'none';
      if (ans !== null) {
        matchedAnswer = ans; matchMethod = 'library';
        libCnt++;
        await fill(c, ans);
        c.classList.add('ata-answered');
        const ansStr = Array.isArray(ans) ? ans.join('') : String(ans);
        uLog('✅ ' + txt.substring(0, 35) + '… → ' + ansStr, 'ok');
        ok++;
      } else {
        const inputs = Array.from(c.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
        const ruleAns = ruleInfer(txt, inputs);
        if (ruleAns) {
          matchedAnswer = ruleAns; matchMethod = 'rule';
          ruleCnt++;
          await fill(c, ruleAns);
          c.classList.add('ata-answered');
          uLog('🔎 规则推断 ' + txt.substring(0, 30) + '… → ' + ruleAns, 'info');
          infer++;
        } else {
          c.classList.add('ata-no-match');
          uLog('⚠️ 未匹配: ' + txt.substring(0, 40), 'warn');
          skip++;
        }
      }
      _logAnswer(txt, matchedAnswer, matchMethod);
      if (CFG.wrongReviewEnable && !matchedAnswer) {
        // WrongQuestionManager.add(txt, '', '');
      }
      addRecentLog(txt, matchedAnswer, matchMethod);
      updateAccuracyHistory(matchedAnswer !== null);
      const pct = updateStatsCards({ ok, infer, skip, i, total: containers.length, libCnt, ruleCnt });
      const elapsed = Date.now() - _speedStart;
      _speedTimes.push(elapsed);
      if (_speedTimes.length > 200) _speedTimes = _speedTimes.slice(-200);
      drawSpeedChart();
      setRunningStatus('答题中 ' + (i+1) + '/' + containers.length + ' ' + pct + '%', 'running');

      while (paused && running) {
        setRunningStatus('⏸ 已暂停 ' + (i+1) + '/' + containers.length + ' ' + pct + '%', 'running');
        await sleep(300);
      }
      if (!running) break;
      await sleep(CFG.answerDelay + Math.random() * 200);
    }
    return { ok, infer, skip };
  }

  async function runAutoAnswer() {
    if (running) { uLog('已在运行，请勿重复点击', 'warn'); return; }
    running = true;
    paused  = false;
    inCountdown = false;
    const pauseBtn = $('#ata-pause');
    if (pauseBtn) { pauseBtn.style.display = ''; pauseBtn.textContent = '⏸ 暂停'; pauseBtn.className = 'ata-btn yellow'; }
    setRunningStatus('答题中…', 'running');
    uLog('=== 开始自动答题 ===', 'ok');

    try {
      const containers = findQContainers();
      uLog('找到 ' + containers.length + ' 个题目容器', 'info');
      if (!containers.length) {
        uLog('未找到题目！请点 "扫描结构" 查看页面情况', 'err');
        setRunningStatus('❌ 未找到题目', 'idle');
        running = false; return;
      }

      // 更新总题数统计卡
      const statTotalEl = $('#ata-stat-total');
      if (statTotalEl) statTotalEl.textContent = containers.length;

      setProgress(0, containers.length);
      const seenQ = new Set();

      const { ok, infer, skip } = await processQuestions(containers, seenQ);

      uLog('完成！命中 ' + ok + '，推断 ' + infer + '，跳过 ' + skip, 'ok');
      setRunningStatus('✅ 完成！命中' + (ok+infer) + '题', 'done');
      gmNotify('答题完成', '命中 ' + (ok+infer) + ' 题，跳过 ' + skip + ' 题');

      if (CFG.autoSubmit) {
        handleSubmitCountdown(CFG.submitDelayMin, CFG.submitDelayMax);
      }
    } catch (e) {
      uLog('运行出错: ' + e.message, 'err');
      setRunningStatus('❌ 出错', 'idle');
      console.error(e);
      // 出错时也要清理倒计时状态
      clearInterval(submitTickId);
      submitTickId = null;
      running = false;
      paused  = false;
      inCountdown = false;
      const pBtn = $('#ata-pause');
      if (pBtn) { pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    } finally {
      // 正常完成后（非autoSubmit倒计时）重置 running
      if (!inCountdown) {
        running = false;
        paused  = false;
        const pBtn = $('#ata-pause');
        if (pBtn) pBtn.style.display = 'none';
      }
    }
  }

  /* =========================================================
     设置面板 UI 逻辑
  ========================================================= */

  /** 将 CFG 当前值同步渲染到面板控件 */
  function syncSettingsUI() {
    const ge = id => document.getElementById(id);
    const setChk = (id, v) => { const el = ge(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = ge(id); if (el) el.value = v; };

    setChk('cfg-fuzzy-enable',  CFG.fuzzyEnable);
    setVal('cfg-fuzzy-thresh',  Math.round(CFG.fuzzyThresh * 100));
    setVal('cfg-thresh-val',    Math.round(CFG.fuzzyThresh * 100) + '%');
    const hintEl = ge('cfg-fuzzy-hint');
    if (hintEl) { hintEl.textContent = CFG.fuzzyEnable ? '开' : '关'; hintEl.style.color = CFG.fuzzyEnable ? '#66bb6a' : '#ef5350'; }
    const threshRow = ge('cfg-fuzzy-thresh-row');
    if (threshRow) threshRow.style.opacity = CFG.fuzzyEnable ? '1' : '.4';

    setChk('cfg-auto-answer', CFG.autoAnswer);
    setChk('cfg-auto-submit', CFG.autoSubmit);
    setVal('cfg-answer-delay', CFG.answerDelay);
    setVal('cfg-submit-min',   CFG.submitDelayMin);
    setVal('cfg-submit-max',   CFG.submitDelayMax);
    const sdRow = ge('cfg-submit-delay-row');
    if (sdRow) sdRow.style.opacity = CFG.autoSubmit ? '1' : '.4';

    setChk('cfg-auto-login',  CFG.autoLogin);
    setVal('cfg-username',    CFG.username);
    setVal('cfg-password',    CFG.password);
    const loginFields = ge('cfg-login-fields');
    if (loginFields) loginFields.style.opacity = CFG.autoLogin ? '1' : '.4';

    setChk('cfg-debug', CFG.debug);

    // v4.5.39 新增
    setChk('cfg-shortcuts-enable',  CFG.shortcutsEnable);
    setChk('cfg-notify-enable',     CFG.notifyEnable);
    // 根据当前模型加载对应配置
    setChk('cfg-cloud-sync-enable', CFG.cloudSyncEnable);
    setVal('cfg-cloud-file-path',  CFG.cloudFilePath);
    setVal('cfg-cloud-repo-path',  CFG.cloudRepoPath);
    setVal('cfg-cloud-branch',      CFG.cloudBranch);
    setVal('cfg-cloud-token',       CFG.cloudToken);
    setVal('cfg-cloud-read-mode',   CFG.cloudReadMode);
    setChk('cfg-compress-enable',   CFG.compressEnable);
    // 更新分享链接预览
    const preview = ge('cfg-share-preview');
    if (preview) preview.textContent = CFG.cloudFilePath || 'minutestars_qa.json';
    const repoPreview = ge('cfg-share-repo');
    if (repoPreview) repoPreview.textContent = CFG.cloudRepoPath || 'law-of-order/MinuteStars-AutoAnswer';
    const branchPreview = ge('cfg-share-branch');
    if (branchPreview) branchPreview.textContent = CFG.cloudBranch || 'main';
    // 联动显示
    const cloudRow = ge('cfg-cloud-row');
    if (cloudRow) cloudRow.style.opacity = CFG.cloudSyncEnable ? '1' : '.4';

    // v4.6.0 自定义域名列表渲染
    renderCustomDomains();
  }

  /** 渲染自定义域名列表（tag + 删除按钮） */
  function renderCustomDomains() {
    const list = document.getElementById('cfg-custom-domains-list');
    if (!list) return;
    list.innerHTML = '';
    if (!CFG.customDomains || !CFG.customDomains.length) {
      list.innerHTML = '<span style="font-size:10px;color:#aaa">暂无自定义域名</span>';
      return;
    }
    CFG.customDomains.forEach((domain, idx) => {
      const tag = document.createElement('span');
      tag.style = 'display:inline-flex;align-items:center;gap:2px;background:#e3f2fd;color:#1565c0;font-size:11px;padding:2px 6px;border-radius:10px;';
      tag.innerHTML = `${escHtml(domain)} <span data-idx="${idx}" class="cfg-domain-remove" style="cursor:pointer;font-weight:bold;margin-left:2px">&times;</span>`;
      list.appendChild(tag);
    });
    // 绑定删除事件
    list.querySelectorAll('.cfg-domain-remove').forEach(el => {
      el.addEventListener('click', function () {
        const idx = parseInt(this.dataset.idx, 10);
        CFG.customDomains.splice(idx, 1);
        renderCustomDomains();
      });
    });
  }

  /** 从面板控件读取当前值写入 CFG 并持久化 */
  function applySettingsFromUI() {
    const ge  = id => document.getElementById(id);
    const gChk = id => { const el = ge(id); return el ? el.checked : false; };
    const gVal = id => { const el = ge(id); return el ? el.value : ''; };

    CFG.fuzzyEnable     = gChk('cfg-fuzzy-enable');
    CFG.fuzzyThresh     = parseInt(gVal('cfg-fuzzy-thresh'), 10) / 100;
    CFG.autoAnswer      = gChk('cfg-auto-answer');
    CFG.autoSubmit      = gChk('cfg-auto-submit');
    CFG.answerDelay     = Math.max(0, parseInt(gVal('cfg-answer-delay'), 10) || 120);
    CFG.submitDelayMin  = Math.max(5, parseInt(gVal('cfg-submit-min'), 10) || 20);
    CFG.submitDelayMax  = Math.max(CFG.submitDelayMin + 5, parseInt(gVal('cfg-submit-max'), 10) || 30);
    CFG.autoLogin       = gChk('cfg-auto-login');
    CFG.username        = gVal('cfg-username').trim();
    CFG.password        = gVal('cfg-password');
    CFG.debug           = gChk('cfg-debug');

    // v4.5.39 新增
    CFG.shortcutsEnable = gChk('cfg-shortcuts-enable');
    CFG.notifyEnable    = gChk('cfg-notify-enable');
    // 保存每模型配置
    // 同时更新全局（向后兼容）
    CFG.cloudSyncEnable = gChk('cfg-cloud-sync-enable');
    CFG.cloudFilePath    = gVal('cfg-cloud-file-path').trim() || 'minutestars_qa.json';
    CFG.cloudRepoPath    = gVal('cfg-cloud-repo-path').trim() || 'law-of-order/MinuteStars-AutoAnswer';
    CFG.cloudBranch      = gVal('cfg-cloud-branch').trim() || 'main';
    CFG.cloudToken       = gVal('cfg-cloud-token').trim();
    CFG.cloudReadMode    = gVal('cfg-cloud-read-mode') || 'cloud';
    CFG.compressEnable   = gChk('cfg-compress-enable');
    // 模式切换后刷新缓存
    _cache.dirty = true;
    if (CFG.cloudReadMode === 'cloud') fetchCloudDB(); // 立即拉取云端
    else { _cloudCache = null; _cloudCacheTime = 0; }
    refreshLibCount();
  }

  // 折叠展开
  const settingsHd   = document.getElementById('ata-settings-hd');
  const settingsBody = document.getElementById('ata-settings-body');
  const settingsArrow = document.getElementById('ata-settings-arrow');
  settingsHd.addEventListener('click', () => {
    const open = settingsBody.classList.toggle('open');
    settingsArrow.textContent = open ? '▲' : '▼';
    if (open) syncSettingsUI();
  });

  // 设置项搜索
  let _settingsSearchT = null;
  document.getElementById('ata-settings-search')?.addEventListener('input', function() {
    clearTimeout(_settingsSearchT);
    _settingsSearchT = setTimeout(() => {
      const kw = this.value.trim().toLowerCase();
      const rows = settingsBody.querySelectorAll('.ata-row');
      const sections = settingsBody.querySelectorAll('.ata-section-title');
      let visibleCount = 0;
      rows.forEach(row => {
        const label = row.querySelector('.ata-label')?.textContent.toLowerCase() || '';
        const match = !kw || label.includes(kw);
        row.classList.toggle('hidden-by-search', !match);
        if (match && !row.closest('#ata-settings-body').classList.contains('hidden-by-search')) visibleCount++;
      });
      sections.forEach(sec => {
        const nextEls = [];
        let el = sec.nextElementSibling;
        while (el && !el.classList.contains('ata-section-title')) { nextEls.push(el); el = el.nextElementSibling; }
        const hasVisible = nextEls.some(e => !e.classList.contains('hidden-by-search'));
        sec.classList.toggle('hidden-by-search', kw && !hasVisible);
      });
      document.getElementById('ata-settings-count').textContent = kw ? `${visibleCount} 个结果` : '';
    }, 150);
  });

  // 最近答题记录折叠
  const recentHd = document.getElementById('ata-recent-hd');
  const recentBody = document.getElementById('ata-recent-body');
  const recentArrow = document.getElementById('ata-recent-arrow');
  recentHd?.addEventListener('click', () => {
    const open = recentBody.classList.toggle('open');
    recentArrow.textContent = open ? '▲' : '▼';
  });

  /* =========================================================
     实时命中率 & 答题记录
  ========================================================= */
  let _recentLogs = []; // 当前试卷全部答题记录

  /** 更新命中率显示 */
  function updateHitRate({ answered, hit, lib, rule }) {
    const pct = answered > 0 ? Math.round(hit / answered * 100) : 0;
    const fill = document.getElementById('ata-hitrate-fill');
    const pctEl = document.getElementById('ata-stat-hitrate');
    if (fill)  fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    document.getElementById('ata-stat-lib')?.textContent && (document.getElementById('ata-stat-lib').textContent = lib);
    document.getElementById('ata-stat-rule')?.textContent && (document.getElementById('ata-stat-rule').textContent = rule);
  }

  /** 添加答题记录 */
  function addRecentLog(question, answer, method) {
    const q = question.length > 60 ? question.substring(0, 60) + '…' : question;
    const a = Array.isArray(answer) ? answer.join('') : String(answer || '—');
    _recentLogs.push({ q, a, method });
    renderRecentLogs();
  }

  /** 渲染最近答题记录 */
  function renderRecentLogs() {
    const list = document.getElementById('ata-recent-list');
    if (!list) return;
    if (!_recentLogs.length) {
      list.innerHTML = '<div class="ata-recent-empty">暂无答题记录</div>';
      return;
    }
    list.innerHTML = _recentLogs.map((log, i) => `
      <div class="ata-recent-item" data-idx="${i}">
        <span class="ata-recent-q" title="${escHtml(log.q)}">${escHtml(log.q)}</span>
        <span class="ata-recent-ans">${log.a}</span>
      </div>
    `).join('');
  }

  /** 显示答题详情弹窗 */
  function showAnswerDetail(log) {
    const modal = document.createElement('div');
    modal.id = 'ata-detail-modal';
    modal.innerHTML = `
      <div class="ata-detail-box">
        <div class="ata-detail-hd">📋 答题详情 <button class="ata-detail-close">✕</button></div>
        <div class="ata-detail-body">
          <div class="ata-detail-row"><label>题目</label><div class="ata-detail-val">${escHtml(log.q)}</div></div>
          <div class="ata-detail-row"><label>答案</label><div class="ata-detail-val" style="color:var(--nm-success);font-weight:700">${escHtml(log.a)}</div></div>
        </div>
      </div>
    `;
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999999;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(modal);
    modal.querySelector('.ata-detail-close').onclick = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
  }

  // 点击最近答题记录查看详情
  document.getElementById('ata-recent-list')?.addEventListener('click', e => {
    const item = e.target.closest('.ata-recent-item');
    if (item) {
      const idx = parseInt(item.dataset.idx);
      if (_recentLogs[idx]) showAnswerDetail(_recentLogs[idx]);
    }
  });

  /* =========================================================
     答题速度曲线
  ========================================================= */
  function drawSpeedChart() {
    const canvas = document.getElementById('ata-speed-canvas');
    if (!canvas || !_speedTimes.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // 绘制折线
    const step = w / Math.max(_speedTimes.length - 1, 1);
    const maxTime = Math.max(..._speedTimes, 1);
    ctx.beginPath();
    ctx.strokeStyle = '#5a8dee';
    ctx.lineWidth = 1.5;
    _speedTimes.forEach((t, i) => {
      const x = i * step;
      const y = h - (t / maxTime) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 更新平均速度
    const avg = _speedTimes.length > 1
      ? Math.round((_speedTimes[_speedTimes.length - 1] - _speedTimes[0]) / (_speedTimes.length - 1))
      : 0;
    const avgEl = document.getElementById('ata-speed-avg');
    if (avgEl) avgEl.textContent = `平均 ${avg}ms/题`;
  }

  // 模糊匹配开关
  document.getElementById('cfg-fuzzy-enable').addEventListener('change', function () {
    const hintEl  = document.getElementById('cfg-fuzzy-hint');
    const threshRow = document.getElementById('cfg-fuzzy-thresh-row');
    hintEl.textContent = this.checked ? '开' : '关';
    hintEl.style.color = this.checked ? '#66bb6a' : '#ef5350';
    if (threshRow) threshRow.style.opacity = this.checked ? '1' : '.4';
  });

  // 阈值滑块实时更新数值
  document.getElementById('cfg-fuzzy-thresh').addEventListener('input', function () {
    const el = document.getElementById('cfg-thresh-val');
    if (el) el.textContent = this.value + '%';
  });

  // 自动提交开关 → 延迟行的可用状态
  document.getElementById('cfg-auto-submit').addEventListener('change', function () {
    const row = document.getElementById('cfg-submit-delay-row');
    if (row) row.style.opacity = this.checked ? '1' : '.4';
  });

  // 自动登录开关 → 账密区的可用状态
  document.getElementById('cfg-auto-login').addEventListener('change', function () {
    const fields = document.getElementById('cfg-login-fields');
    if (fields) fields.style.opacity = this.checked ? '1' : '.4';
  });


  // v4.5.39 云同步开关 → 配置区可用状态
  document.getElementById('cfg-cloud-sync-enable')?.addEventListener('change', function () {
    const row = document.getElementById('cfg-cloud-row');
    if (row) row.style.opacity = this.checked ? '1' : '.4';
  });

  // v4.5.39 云同步按钮
  document.getElementById('ata-cloud-upload')?.addEventListener('click', () => cloudUpload());
  document.getElementById('ata-cloud-download')?.addEventListener('click', () => cloudDownload());
  document.getElementById('ata-cloud-import')?.addEventListener('click', () => cloudImport());
  document.getElementById('ata-cloud-delete')?.addEventListener('click', () => cloudDelete());

  // v4.5.39 答题报告导出
  document.getElementById('ata-export-report-json')?.addEventListener('click', () => {
    const content = exportAnswerReport('json');
    downloadFile(content, 'ATA_Report_' + Date.now() + '.json', 'application/json');
    uLog('答题报告已导出 (JSON)', 'ok');
  });
  document.getElementById('ata-export-report-csv')?.addEventListener('click', () => {
    const content = exportAnswerReport('csv');
    downloadFile(content, 'ATA_Report_' + Date.now() + '.csv', 'text/csv;charset=utf-8');
    uLog('答题报告已导出 (CSV)', 'ok');
  });

  // 密码显隐
  document.getElementById('cfg-eye').addEventListener('click', () => {
    const inp = document.getElementById('cfg-password');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // 保存
  document.getElementById('cfg-save').addEventListener('click', () => {
    applySettingsFromUI();
    saveCFG();
    const msg = document.getElementById('cfg-save-msg');
    if (msg) { msg.textContent = '✅ 设置已保存'; setTimeout(() => { msg.textContent = ''; }, 2500); }
    uLog('⚙ 设置已保存（模糊匹配:' + (CFG.fuzzyEnable ? '开 阈值' + Math.round(CFG.fuzzyThresh*100) + '%' : '关') + ' 自动登录:' + (CFG.autoLogin ? '开' : '关') + '）', 'ok');
  });

  // 恢复默认
  document.getElementById('cfg-reset-defaults').addEventListener('click', () => {
    if (!confirm('恢复所有设置为默认值？（账号密码也会清空）')) return;
    Object.assign(CFG, CFG_DEFAULT);
    saveCFG();
    syncSettingsUI();
    const msg = document.getElementById('cfg-save-msg');
    if (msg) { msg.textContent = '↺ 已恢复默认'; setTimeout(() => { msg.textContent = ''; }, 2500); }
  });

  // v4.6.0 自定义域名：添加按钮
  document.getElementById('cfg-add-domain-btn')?.addEventListener('click', () => {
    const input = document.getElementById('cfg-custom-domain-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    // 简单验证：必须以 http:// 或 https:// 开头
    if (!/^https?:\/\//i.test(val)) {
      uLog('⚠ 域名格式错误，需包含协议（如 https://example.com）', 'warn');
      return;
    }
    if (!CFG.customDomains) CFG.customDomains = [];
    if (CFG.customDomains.includes(val)) {
      uLog('⚠ 域名已存在', 'warn');
      return;
    }
    CFG.customDomains.push(val);
    input.value = '';
    renderCustomDomains();
    uLog('✅ 已添加域名：' + val, 'ok');
  });
  // 回车添加域名
  document.getElementById('cfg-custom-domain-input')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('cfg-add-domain-btn')?.click();
  });

  /* =========================================================
     键盘导航支持
  ========================================================= */
  // 设置区 Tab 导航
  settingsBody?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('.ata-text-input')) {
      // 非文本输入框的 Enter 触发表单提交
      document.getElementById('cfg-save')?.click();
    }
  });

  // 题库弹窗 Enter 确认
  const libModal = document.getElementById('ata-lib-modal');
  libModal?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      libModal.classList.remove('show');
    }
  });

  /* =========================================================
     策略预设
  ========================================================= */
  const PRESETS_KEY = 'ata_presets';
  const PRESET_DEFS = {
  };
  let _userPresets = {};

  function loadPresets() {
    try { _userPresets = JSON.parse(GM_getValue(PRESETS_KEY, '{}')); } catch { _userPresets = {}; }
  }
  function savePresets() {
    try { GM_setValue(PRESETS_KEY, JSON.stringify(_userPresets)); } catch {}
  }
  function applyPreset(preset) {
    const p = { ...PRESET_DEFS[preset], ..._userPresets[preset] };
    if (!p) return;
    CFG.fuzzyEnable = p.fuzzyEnable;
    CFG.fuzzyThresh = p.fuzzyThresh;
    CFG.answerDelay = p.answerDelay;
    CFG.autoLogin = p.autoLogin;
    syncSettingsUI();
    const hint = document.getElementById('ata-presets-hint');
    if (hint) hint.textContent = '已应用：' + p.name + ' — ' + p.hint;
  }
  function showPresetHint(sel) {
    const hint = document.getElementById('ata-presets-hint');
    if (!hint || !sel) { if (hint) hint.textContent = ''; return; }
    const p = { ...PRESET_DEFS[sel], ..._userPresets[sel] };
    if (hint) hint.textContent = p ? p.hint : '';
  }

  loadPresets();

  // 预设选择提示
  document.getElementById('ata-preset-select')?.addEventListener('change', function() {
    showPresetHint(this.value);
  });

  // 应用预设
  document.getElementById('ata-preset-apply')?.addEventListener('click', () => {
    const sel = document.getElementById('ata-preset-select')?.value;
    if (!sel) { alert('请先选择一个预设'); return; }
    applyPreset(sel);
  });

  // 保存当前设置到预设
  document.getElementById('ata-preset-save')?.addEventListener('click', () => {
    const name = prompt('输入预设名称：');
    if (!name?.trim()) return;
    const presetName = name.trim();
    _userPresets[presetName] = {
      fuzzyEnable: CFG.fuzzyEnable,
      fuzzyThresh: CFG.fuzzyThresh,
      answerDelay: CFG.answerDelay,
      autoLogin: CFG.autoLogin,
      hint: '自定义预设',
    };
    // 更新下拉框
    const select = document.getElementById('ata-preset-select');
    if (select) {
      const opt = document.createElement('option');
      opt.value = '__custom_' + presetName;
      opt.textContent = '★ ' + presetName;
      select.appendChild(opt);
      select.value = opt.value;
    }
    savePresets();
    const hint = document.getElementById('ata-presets-hint');
    if (hint) hint.textContent = '已保存当前设置为：' + presetName;
  });

  /* =========================================================
     按钮事件绑定
  ========================================================= */
  $('#ata-start').addEventListener('click', runAutoAnswer);

  $('#ata-pause').addEventListener('click', () => {
    const btn = $('#ata-pause');
    if (!btn) return;
    // 答题阶段需要 running=true；倒计时阶段只需要 inCountdown=true
    if (!running && !inCountdown) return;
    if (!paused) {
      // 暂停
      paused = true;
      btn.textContent = '▶ 继续';
      btn.className = 'ata-btn green';
      if (inCountdown) {
        setRunningStatus('⏸ 倒计时已暂停（剩余 ' + submitRem + 's）', 'running');
        uLog('⏸ 倒计时已暂停', 'warn');
      } else {
        setRunningStatus('⏸ 已暂停', 'running');
        uLog('⏸ 已暂停', 'warn');
      }
    } else {
      // 继续
      paused = false;
      btn.textContent = '⏸ 暂停';
      btn.className = 'ata-btn yellow';
      if (inCountdown) {
        setRunningStatus('⏳ 倒计时继续…', 'running');
        uLog('▶ 继续倒计时', 'ok');
      } else {
        uLog('▶ 继续答题', 'ok');
      }
    }
  });
  $('#ata-submit').addEventListener('click', doSubmit);
  $('#ata-scan').addEventListener('click', debugScan);
  $('#ata-collect').addEventListener('click', collectAnswers);
  $('#ata-reset').addEventListener('click', () => {
    $$('input').forEach(i => { i.checked = false; i.dispatchEvent(new Event('change', {bubbles:true})); });
    $$('.ata-answered,.ata-no-match').forEach(e => e.classList.remove('ata-answered','ata-no-match'));
    setProgress(0, 1);
    setRunningStatus('等待开始', 'idle');
    ['ata-stat-total','ata-stat-answered','ata-stat-hit','ata-stat-miss'].forEach(id => {
      const el = $(id); if (el) el.textContent = '0';
    });
    running = false; paused = false; inCountdown = false;
    clearInterval(submitTickId); submitTickId = null;
    const pBtn = $('#ata-pause');
    if (pBtn) { pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    uLog('已重置', 'info');
  });
  $('#ata-close').addEventListener('click', () => { panel.style.display = 'none'; });

  $('#ata-collapse-panel').addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    $('#ata-collapse-panel').textContent = collapsed ? '▲' : '▼';
    $('#ata-collapse-panel').title = collapsed ? '展开面板' : '收起面板';
  });

  $('#ata-expand-btn').addEventListener('click', () => {
    panel.classList.remove('collapsed');
    $('#ata-collapse-panel').textContent = '▼';
    $('#ata-collapse-panel').title = '收起面板';
  });

  /* =========================================================
     全局快捷键（Alt+Enter / Alt+S）
     ⚡ v4.5.39：答题时可使用快捷键操作
  ========================================================= */
  document.addEventListener('keydown', e => {
    if (!CFG.shortcutsEnable) return;
    // Alt+Enter → 开始答题
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      if (!running) { runAutoAnswer(); return; }
      // 已运行时则提交
      doSubmit();
    }
    // Alt+S → 暂停/继续
    if (e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!running && !inCountdown) return;
      $('#ata-pause')?.click();
    }
    // Alt+D → 下载题库 JSON
    if (e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const all = getMergedDB();
      downloadFile(JSON.stringify(all, null, 2), 'MinuteStars题库_' + Date.now() + '.json', 'application/json');
      uLog('📤 题库已导出 (Alt+D)', 'ok');
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
    }
  });





  /* =========================================================
     拖拽移动 / Alt+拖拽调整大小（8方向）
  ========================================================= */
  let isDragging = false, isResizing = false, resizeDir = '';
  let dragStartX = 0, dragStartY = 0;
  let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;
  let resizeStartL = 0, resizeStartT = 0;
  const hdr = panel.querySelector('.ata-hdr');
  const minW = 200, minH = 150;

  hdr.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    if (e.altKey) {
      // Alt+拖拽：调整大小（默认右下角se）
      isResizing = true;
      resizeDir = 'se';
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = panel.offsetWidth;
      resizeStartH = panel.offsetHeight;
      resizeStartL = panel.offsetLeft;
      resizeStartT = panel.offsetTop;
      panel.style.right = 'auto';
    } else {
      // 普通拖拽：移动面板
      isDragging = true;
      dragStartX = e.clientX - panel.offsetLeft;
      dragStartY = e.clientY - panel.offsetTop;
    }
    hdr.style.cursor = e.altKey ? 'se-resize' : 'grabbing';
    e.preventDefault();
  });

  // 8方向手柄resize（隐藏手柄，但功能保留）
  document.querySelectorAll('.ata-resize-handle').forEach(rsz => {
    rsz.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizeDir = rsz.dataset.dir;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = panel.offsetWidth;
      resizeStartH = panel.offsetHeight;
      resizeStartL = panel.offsetLeft;
      resizeStartT = panel.offsetTop;
      panel.style.right = 'auto';
      e.preventDefault();
      e.stopPropagation();
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing) {
      const dx = e.clientX - resizeStartX;
      const dy = e.clientY - resizeStartY;
      let newW = resizeStartW, newH = resizeStartH, newL = resizeStartL, newT = resizeStartT;

      if (resizeDir.includes('e')) newW = Math.max(minW, resizeStartW + dx);
      if (resizeDir.includes('w')) { newW = Math.max(minW, resizeStartW - dx); newL = resizeStartL + (resizeStartW - newW); }
      if (resizeDir.includes('s')) newH = Math.max(minH, resizeStartH + dy);
      if (resizeDir.includes('n')) { newH = Math.max(minH, resizeStartH - dy); newT = resizeStartT + (resizeStartH - newH); }

      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.left = newL + 'px';
      panel.style.top = newT + 'px';
    } else if (isDragging) {
      panel.style.right = 'auto';
      panel.style.left = (e.clientX - dragStartX) + 'px';
      panel.style.top = (e.clientY - dragStartY) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
    resizeDir = '';
    hdr.style.cursor = 'move';
    // 保存面板位置和大小
    savePanelPos();
  });

  // 面板位置记忆
  const PANEL_POS_KEY = 'ata_panel_pos';
  function savePanelPos() {
    const pos = {
      left: panel.style.left,
      top: panel.style.top,
      right: panel.style.right,
      width: panel.style.width,
      height: panel.style.height
    };
    try { GM_setValue(PANEL_POS_KEY, JSON.stringify(pos)); } catch {}
  }
  function loadPanelPos() {
    try {
      const saved = GM_getValue(PANEL_POS_KEY, null);
      if (saved) {
        const pos = JSON.parse(saved);
        if (pos.left)  panel.style.left  = pos.left;
        if (pos.top)   panel.style.top   = pos.top;
        if (pos.right) panel.style.right = pos.right;
        if (pos.width) panel.style.width  = pos.width;
        if (pos.height) panel.style.height = pos.height;
      }
    } catch {}
  }
  loadPanelPos();

  /* =========================================================
     深色模式适配：检测页面背景色自动调整
  ========================================================= */
  function detectDarkMode() {
    try {
      // 检测页面根元素背景色
      const root = document.documentElement;
      const rootBg = window.getComputedStyle(root).backgroundColor;
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      const bg = rootBg !== 'rgba(0, 0, 0, 0)' ? rootBg : bodyBg;

      const rgb = bg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
        const isDark = brightness < 128;
        panel.classList.toggle('ata-dark', isDark);

        // 直接设置标题栏背景色
        const hdr = panel.querySelector('.ata-hdr');
        if (hdr) {
          hdr.style.setProperty('background', isDark
            ? 'linear-gradient(145deg, #2a3441, #1e2530)'
            : 'linear-gradient(145deg, #d4d9e2, #ebeff5)', 'important');
        }
      }
    } catch {}
  }
  detectDarkMode();
  // 监听主题变化
  const observer = new MutationObserver(detectDarkMode);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

  // 深色模式 CSS 变量覆盖
  GM_addStyle(`
    #ata-panel.ata-dark {
      --nm-bg: #1e2530;
      --nm-shadow-light: #2a3441;
      --nm-shadow-dark: #151a22;
      --nm-text: #b8c4d4;
      --nm-text-secondary: #7a8a9a;
    }
    #ata-panel.ata-dark #ata-log { background: rgba(0,0,0,0.2); color: #b8c4d4; }
    #ata-panel.ata-dark input, #ata-panel.ata-dark textarea, #ata-panel.ata-dark select {
      background: #1a2028;
      color: #b8c4d4;
      border-color: #3a4555;
    }
    #ata-panel.ata-dark #ata-lib-box { background: #1e2530; }
    /* 深色模式 - 标题栏 */
    #ata-panel.ata-dark .ata-hdr {
      background: linear-gradient(145deg, #2a3441, #1e2530) !important;
      border-bottom-color: rgba(255,255,255,0.05) !important;
    }
    #ata-panel.ata-dark .ata-hdr-title { color: #b8c4d4 !important; }
    #ata-panel.ata-dark .ata-hdr-sub { color: #7a8a9a !important; }
    #ata-panel.ata-dark .ata-hdr-ver { color: #7a8a9a !important; background: #1e2530 !important; }
  `);

  /* =========================================================
     启动时初始化（本地模式异步加载题库到内存）
  ========================================================= */
  (async () => {
    // v4.6.0 域名检测：只允许在 MinuteStars 或自定义域名上运行
    const currentHost = location.hostname;
    const isMinuteStars = /\.minutestars\.com$/i.test(currentHost);
    const isCustom = (CFG.customDomains || []).some(d => {
      try { return new URL(d).hostname === currentHost; } catch { return false; }
    });
    if (!isMinuteStars && !isCustom) {
      uLog('⚠ 当前域名不在允许列表中（' + currentHost + '），脚本不运行', 'warn');
      return;
    }

    _cache.dirty = true;
    refreshLibCount();
    // 云端模式：页面加载时先拉取云端题库（await 确保数据就绪再答题）
    if (CFG.cloudReadMode === 'cloud') {
      try {
        await fetchCloudDB();
      } catch (e) {
        uLog('⚠️ 云端题库加载失败，使用本地题库: ' + (e.message || ''), 'warn');
      }
    }

    setTimeout(() => {
      const qs = findQContainers();
      if (qs.length) {
        uLog('页面就绪，检测到 ' + qs.length + ' 题', 'ok');
        const statTotalEl = $('#ata-stat-total');
        if (statTotalEl) statTotalEl.textContent = qs.length;
        setRunningStatus('✅ ' + qs.length + ' 题已就绪', 'idle');
      } else {
        uLog('暂未检测到题目，等待页面加载…', 'warn');
        setRunningStatus('等待页面加载…', 'idle');
      }
      if (CFG.autoAnswer) {
        uLog('3 秒后自动开始…', 'warn');
        setTimeout(runAutoAnswer, 3000);
      }
    }, 1500);
  })();

})();

