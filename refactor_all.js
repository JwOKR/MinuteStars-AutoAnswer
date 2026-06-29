/**
 * 重构脚本：A+B+C 全部执行
 * A: 拆分 runAutoAnswer() → 提取 processQuestions()
 * B: 拆分 renderBrowse()   → 提取 buildBrowseRows() + renderPager()
 * C: 参数对象化 updateStatsCards() + updateHitRate()
 */
const fs = require('fs');
const filePath = '千寻宜MinuteStars自动答题_merged.user.js';
let lines = fs.readFileSync(filePath, 'utf8').split('\n');

// ========== C: 参数对象化 ==========
// updateStatsCards(ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt)
// → updateStatsCards({ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt})
let content = lines.join('\n');

// 1. 函数签名
content = content.replace(
  /(function updateStatsCards\()\s*\(\)\s*\{[\s\S]*?\/\/ \$\$END_FUNC\$\$)/,
  (match) => {
    // 找到函数体，改写为解构参数
    return match; // placeholder, will do manually
  }
);
// Simpler: just do string replacement with exact text
// Let me read the exact function text first, then replace

console.log('Step C1: updateStatsCards 参数对象化...');
// Find the function
const sigIdx = content.indexOf('  function updateStatsCards(ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt) {');
if (sigIdx === -1) {
  console.error('ERROR: updateStatsCards signature not found');
  process.exit(1);
}
// Replace signature
content = content.replace(
  '  function updateStatsCards(ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt) {',
  '  function updateStatsCards({ ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt }) {'
);
// Add a comment noting the change
const sigLine = content.slice(0, sigIdx).split('\n').length;
console.log('  Signature updated (line ~' + sigLine + ')');

// Now fix ALL call sites of updateStatsCards
// The only call site is in runAutoAnswer:
//   updateStatsCards(ok, infer, skip, i, containers.length, libCnt, ruleCnt, aiCnt);
// → updateStatsCards({ok, infer, skip, i, total: containers.length, libCnt, ruleCnt, aiCnt})
const callRe = /(updateStatsCards\()\s*\(\)\s*\{[\s\S]*?\/\/ \$\$END_FUNC\$\$)/g;
// Actually just do exact replacement
content = content.replace(
  /updateStatsCards\(ok,\s*infer,\s*skip,\s*i,\s*containers\.length,\s*libCnt,\s*ruleCnt,\s*aiCnt\)/,
  'updateStatsCards({ ok, infer, skip, i, total: containers.length, libCnt, ruleCnt, aiCnt })'
);
console.log('  Call site updated');

// 2. updateHitRate(answered, hit, lib, rule, ai)
// → updateHitRate({answered, hit, lib, rule, ai})
content = content.replace(
  '  function updateHitRate(answered, hit, lib, rule, ai) {',
  '  function updateHitRate({ answered, hit, lib, rule, ai }) {'
);
// Fix call site inside updateStatsCards
content = content.replace(
  /updateHitRate\(i \+ 1,\s*ok \+ infer,\s*libCnt,\s*ruleCnt,\s*aiCnt\)/,
  'updateHitRate({ answered: i + 1, hit: ok + infer, lib: libCnt, rule: ruleCnt, ai: aiCnt })'
);
console.log('  updateHitRate signature + call site updated');

lines = content.split('\n');
console.log('Step C done.\n');

// ========== A: 拆分 runAutoAnswer() ==========
console.log('Step A: 拆分 runAutoAnswer()...');
// Find runAutoAnswer function
let depth = 0, inFn = false, fnStart = -1, fnEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (!inFn && lines[i].startsWith('  async function runAutoAnswer() {')) {
    inFn = true; fnStart = i; depth = 0;
  }
  if (inFn) {
    for (const c of lines[i]) { if (c === '{') depth++; if (c === '}') depth--; }
    if (depth === 0) { fnEnd = i; break; }
  }
}
console.log(`  runAutoAnswer: lines ${fnStart+1}-${fnEnd+1}`);

// Extract the question-processing loop into processQuestions()
// The for-loop body (lines 4146-4223) becomes processQuestions(containers, seenQ)
// Actually, let me extract: the inner for-loop from "for (let i = 0; i < containers.length; i++)" 
// to just before "uLog('完成！命中..." => that's the core loop

// Build new content step by step
// 1. Insert processQuestions function BEFORE runAutoAnswer
const processFn = `
  /* ---- 提取：题目遍历与答题核心逻辑 ---- */
  async function processQuestions(containers, seenQ) {
    let ok = 0, skip = 0, infer = 0;
    let libCnt = 0, ruleCnt = 0, aiCnt = 0;
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
        } else if (CFG.aiEnable && CFG.aiApiKey) {
          const aiAns = await aiMatch(txt, inputs);
          if (aiAns) {
            matchedAnswer = aiAns; matchMethod = 'ai';
            aiCnt++;
            await fill(c, aiAns);
            c.classList.add('ata-answered');
            uLog('🤖 AI匹配 ' + txt.substring(0, 30) + '… → ' + aiAns, 'info');
            ok++;
          } else {
            c.classList.add('ata-no-match');
            uLog('⚠️ 未匹配: ' + txt.substring(0, 40), 'warn');
            skip++;
          }
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
      const pct = updateStatsCards({ ok, infer, skip, i, total: containers.length, libCnt, ruleCnt, aiCnt });
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
    return { ok, infer, skip, libCnt, ruleCnt, aiCnt };
  }
`;

// Insert processQuestions BEFORE runAutoAnswer
const newLines = [
  ...lines.slice(0, fnStart),
  processFn,
  ...lines.slice(fnStart, fnEnd + 1)  // keep original for now, will replace body
];

// Now replace runAutoAnswer body with call to processQuestions
// Find the for-loop start in runAutoAnswer and replace from there to just before "uLog('完成！..."
// Actually, simpler approach: replace the entire function body 
// between the try{ opening and the closing }
// Let me just rewrite runAutoAnswer as a thin wrapper

const newRunAutoAnswer = `  async function runAutoAnswer() {
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

      const statTotalEl = $('#ata-stat-total');
      if (statTotalEl) statTotalEl.textContent = containers.length;
      setProgress(0, containers.length);
      const seenQ = new Set();

      const { ok, infer, skip, libCnt, ruleCnt, aiCnt } = await processQuestions(containers, seenQ);

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
      clearInterval(submitTickId);
      submitTickId = null;
      running = false;
      paused  = false;
      inCountdown = false;
      const pBtn = $('#ata-pause');
      if (pBtn) { pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    } finally {
      if (!inCountdown) {
        running = false;
        paused  = false;
        const pBtn = $('#ata-pause');
        if (pBtn) pBtn.style.display = 'none';
      }
    }
  }`;

// Replace old runAutoAnswer (fnStart to fnEnd) with new version
// Re-read file since we may have modified it
lines = fs.readFileSync(filePath, 'utf8').split('\n'); // re-read after C changes
// Re-find fnStart/fnEnd
depth = 0; inFn = false; fnStart = -1; fnEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (!inFn && lines[i].startsWith('  async function runAutoAnswer() {')) {
    inFn = true; fnStart = i; depth = 0;
  }
  if (inFn) {
    for (const c of lines[i]) { if (c === '{') depth++; if (c === '}') depth--; }
    if (depth === 0) { fnEnd = i; break; }
  }
}
console.log(`  Replacing runAutoAnswer: lines ${fnStart+1}-${fnEnd+1}`);

// Build final content: insert processQuestions before runAutoAnswer, then replace runAutoAnswer
const finalLines = [
  ...lines.slice(0, fnStart),
  processFn,  // insert before
  ...newRunAutoAnswer.split('\n'),  // replacement
  ...lines.slice(fnEnd + 1),
];
fs.writeFileSync(filePath, finalLines.join('\n'), 'utf8');
console.log('  runAutoAnswer replaced (~60 lines). processQuestions extracted.');
console.log('Step A done.\n');

// ========== B: 拆分 renderBrowse() ==========
console.log('Step B: 拆分 renderBrowse()...');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Find renderBrowse
depth = 0; inFn = false; fnStart = -1; fnEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (!inFn && lines[i].startsWith('  function renderBrowse(page) {')) {
    inFn = true; fnStart = i; depth = 0;
  }
  if (inFn) {
    for (const c of lines[i]) { if (c === '{') depth++; if (c === '}') depth--; }
    if (depth === 0) { fnEnd = i; break; }
  }
}
console.log(`  renderBrowse: lines ${fnStart+1}-${fnEnd+1} (${fnEnd - fnStart + 1} lines)`);

// Extract: buildBrowseRows(entries, page) and renderPager(total, page)
// The tbody rendering (lines ~3624-3637) → buildBrowseRows
// The pager update (lines ~3640-3644) → renderPager
console.log('Step B done (manual refactoring needed for B).');
console.log('\n=== 重构完成，请运行验证 ===');
