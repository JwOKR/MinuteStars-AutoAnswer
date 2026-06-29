#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Remove all AI-related code from the userscript."""
import re

with open('千寻宜MinuteStars自动答题_merged.user.js', 'r', encoding='utf-8') as f:
    content = f.read()

changes = []

def safe_replace(old, new):
    """Replace old with new if found."""
    if old in content:
        global content
        content = content.replace(old, new)
        return True
    return False

# 1. CSS rules for AI
safe_replace('.ata-method-dot.ai{background:#8b5cf6}\n', '')
safe_replace('.ata-method-dot.ai{background:#48bb78;}\n', '')

# 2. Stats header - remove AI span
safe_replace(
    '        <span class="ata-method-dot ai" title="AI匹配"></span><span id="ata-stat-ai">0</span>\n',
    ''
)

# 3. AI settings UI - Find section boundaries
start_marker = '<div class="ata-section-title">AI 辅助 <span'
end_marker = '<div class="ata-section-title">云同步 <span'
idx_s = content.find(start_marker)
idx_e = content.find(end_marker)
if idx_s >= 0 and idx_e > idx_s:
    content = content[:idx_s] + content[idx_e:]
    changes.append('AI settings UI section')

# 4. processQuestions - aiCnt variable and AI matching block
safe_replace(
    '    let libCnt = 0, ruleCnt = 0, aiCnt = 0;',
    '    let libCnt = 0, ruleCnt = 0;'
)
# Remove AI matching block
block = (
    '        } else if (CFG.aiEnable && CFG.aiApiKey) {\n'
    '          const aiAns = await aiMatch(txt, inputs);\n'
    '          if (aiAns) {\n'
    '            matchedAnswer = aiAns; matchMethod = \'ai\';\n'
    '            aiCnt++;\n'
    '            await fill(c, aiAns);\n'
    "            uLog('\U0001f916 AI匹配 \' + txt.substring(0, 30) + '\U2026 \U2192 \' + aiAns, \'info\');\n"
    '          }\n'
    '        }'
)
safe_replace(block, '')

safe_replace(
    '      const pct = updateStatsCards({ ok, infer, skip, i, total: containers.length, libCnt, ruleCnt, aiCnt });',
    '      const pct = updateStatsCards({ ok, infer, skip, i, total: containers.length, libCnt, ruleCnt });'
)
safe_replace(
    '    return { ok, infer, skip, libCnt, ruleCnt, aiCnt };',
    '    return { ok, infer, skip, libCnt, ruleCnt };'
)
safe_replace(
    '      const { ok, infer, skip, libCnt, ruleCnt, aiCnt } = await processQuestions(containers, seenQ);',
    '      const { ok, infer, skip, libCnt, ruleCnt } = await processQuestions(containers, seenQ);'
)
safe_replace(
    '  function updateStatsCards({ ok, infer, skip, i, total, libCnt, ruleCnt, aiCnt }) {',
    '  function updateStatsCards({ ok, infer, skip, i, total, libCnt, ruleCnt }) {'
)
safe_replace(
    '    updateHitRate({ answered: i + 1, hit: ok + infer, lib: libCnt, rule: ruleCnt, ai: aiCnt });',
    '    updateHitRate({ answered: i + 1, hit: ok + infer, lib: libCnt, rule: ruleCnt });'
)
safe_replace(
    '  function updateHitRate({ answered, hit, lib, rule, ai }) {',
    '  function updateHitRate({ answered, hit, lib, rule }) {'
)
safe_replace(
    "    document.getElementById('ata-stat-ai')?.textContent && (document.getElementById('ata-stat-ai').textContent = ai);\n",
    ''
)

# 5. AI in log rendering (method === 'ai' check)
safe_replace(
    "log.method === 'ai' ? 'AI匹配' : ",
    ''
)

# 6. Sync settings
safe_replace(
    "    setChk('cfg-ai-enable',         CFG.aiEnable);\n"
    "    setVal('cfg-ai-model',        CFG.aiModel || 'deepseek');\n"
    "\n"
    '    const curModelCfg = CFG.aiModels?.[CFG.aiModel] || {};\n'
    '    setVal(\'cfg-ai-api-key\',      curModelCfg.apiKey || CFG.aiApiKey);\n'
    '    setVal(\'cfg-ai-endpoint\',     curModelCfg.endpoint || CFG.aiEndpoint);\n'
    "    setVal('cfg-ai-endpoint',     CFG.aiEndpoint);\n",
    ''
)
safe_replace(
    "    const aiRow = ge('cfg-ai-row');\n"
    "    if (aiRow) aiRow.style.opacity = CFG.aiEnable ? '1' : '.4';\n",
    ''
)

# 7. Apply settings from UI
safe_replace(
    "    CFG.aiEnable        = gChk('cfg-ai-enable');\n"
    "    CFG.aiModel         = gVal('cfg-ai-model') || 'deepseek';\n"
    "\n"
    '    if (!CFG.aiModels) CFG.aiModels = {};\n'
    '    if (!CFG.aiModels[CFG.aiModel]) CFG.aiModels[CFG.aiModel] = {};\n'
    "    CFG.aiModels[CFG.aiModel].apiKey = gVal('cfg-ai-api-key').trim();\n"
    "    CFG.aiModels[CFG.aiModel].endpoint = gVal('cfg-ai-endpoint').trim();\n"
    "\n"
    '    CFG.aiApiKey   = CFG.aiModels[CFG.aiModel].apiKey;\n'
    "    CFG.aiEndpoint = CFG.aiModels[CFG.aiModel].endpoint || 'https://api.siliconflow.cn/v1/chat/completions';\n",
    ''
)

# 8. Presets - remove aiEnable
safe_replace(
    "' fast:     { name: '\u26a1 \u5feb\u901f\u7b54\u9898', fuzzyEnable: true, fuzzyThresh: 0.65, answerDelay: 50,  autoLogin: false, aiEnable: false, hint: '\u4f4e\u5ef6\u8fdf\uff0c\u9898\u5e93\u4f18\u5148\uff0c\u9002\u5408\u7b80\u5355\u8003\u8bd5' },",
    "' fast:     { name: '\u26a1 \u5feb\u901f\u7b54\u9898', fuzzyEnable: true, fuzzyThresh: 0.65, answerDelay: 50,  autoLogin: false, hint: '\u4f4e\u5ef6\u8fdf\uff0c\u9898\u5e93\u4f18\u5148\uff0c\u9002\u5408\u7b80\u5355\u8003\u8bd5' },"
)
safe_replace(
    "' accurate: { name: '\U0001f3af \u7cbe\u51c6\u7b54\u9898', fuzzyEnable: true, fuzzyThresh: 0.85, answerDelay: 150, autoLogin: false, aiEnable: false, hint: '\u9ad8\u9608\u503c\uff0c\u964d\u4f4e\u8bef\u5339\u914d' },",
    "' accurate: { name: '\U0001f3af \u7cbe\u51c6\u7b54\u9898', fuzzyEnable: true, fuzzyThresh: 0.85, answerDelay: 150, autoLogin: false, hint: '\u9ad8\u9608\u503c\uff0c\u964d\u4f4e\u8bef\u5339\u914d' },"
)
safe_replace(
    "' safe:     { name: '\U0001f6e1\ufe0f \u5b89\u5168\u7b54\u9898',  fuzzyEnable: true, fuzzyThresh: 0.75, answerDelay: 300, autoLogin: true,  aiEnable: true,  hint: '\u957f\u5ef6\u8fdf+AI\u515c\u5e95\uff0c\u9002\u5408\u4e25\u683c\u8003\u8bd5' },",
    "' safe:     { name: '\U0001f6e1\ufe0f \u5b89\u5168\u7b54\u9898',  fuzzyEnable: true, fuzzyThresh: 0.75, answerDelay: 300, autoLogin: true,  hint: '\u957f\u5ef6\u8fdf\uff0c\u9002\u5408\u4e25\u683c\u8003\u8bd5' },"
)
safe_replace('    CFG.aiEnable = p.aiEnable;\n', '')
safe_replace('      aiEnable: CFG.aiEnable,\n', '')

# 9. Keyboard shortcut
safe_replace(
    '    // Ctrl+Shift+A \u2192 AI \u5339\u914d\u6d4b\u8bd5\uff08\u4ec5\u5728\u63a7\u5236\u53f0\uff09\n'
    "    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {\n"
    '      e.preventDefault();\n'
    '      CFG.aiEnable = !CFG.aiEnable;\n'
    "      uLog('AI \u8f85\u52a9: ' + (CFG.aiEnable ? '\u5f00\u542f' : '\u5173\u95ed'), 'info');\n"
    '      return;\n'
    '    }\n',
    ''
)

with open('千寻宜MinuteStars自动答题_merged.user.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'All AI removal complete!')
