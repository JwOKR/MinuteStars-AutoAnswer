# MinuteStars-AutoAnswer 项目规范

## Docx 解析代码重构项目（2026-05-20）
### 项目目标
彻底重写 docx 文件解析代码，提高可维护性、支持全面格式、增强调试能力。

### 已完成阶段（全部完成 ✅）
- **Phase 1** (v4.8.35): 基础架构
  - `parseDocxDocument` - 新入口函数
  - `extractDocxXML` - 解压 docx 并提取 XML
  - `extractContentBlocks` - 解析 XML 为段落文本数组
  - `debugLog` - 调试日志函数

- **Phase 2** (v4.8.36-37): 状态机解析
  - `parseWithStateMachine` - 状态机版本解析器
  - 状态定义: `LOOKING_FOR_QUESTION` → `COLLECTING_QUESTION` → `COLLECTING_OPTIONS` → `FOUND_ANSWER` → `FOUND_ANALYSIS`

- **Phase 3** (v4.8.38): 格式扩展
  - `extractBlocksFromTable` - 从表格中提取文本内容
  - `extractHeadersFooters` - 从页眉页脚中提取文本内容
  - `extractBlocksFromElement` - 从元素中提取段落内容
  - `extractTextFromElement` - 从元素中提取文本内容
  - 支持段落、表格、页眉页脚三种格式

- **Phase 4** (v4.8.39): 调试和优化
  - 增强 `debugLog` 函数，添加日志级别控制（ERROR/WARN/INFO/DEBUG/TRACE）
  - 新增 `showDocxDebugLog` 和 `clearDocxDebugLog` 函数
  - 改进错误处理，提供更友好的用户提示

- **Phase 5** (v4.8.40): 代码清理
  - 删除所有遗留的旧函数（共删除 376 行代码）
  - 新架构完全替代旧代码

### 设计决策
1. **状态机模式**: 替代原有的嵌套循环逻辑，更清晰、易维护
2. **增量重构**: 分 5 个阶段逐步完成，每阶段独立提交
3. **代码清理**: 重构完成后删除所有旧函数，保持代码整洁

## v4.5.40 新增功能速查（2026-04-28）
- Jaro-Winkler 模糊匹配（替换 Levenshtein）
- N-gram 候选预筛选 + 长度分桶索引
- AI 辅助匹配（DeepSeek/硅基流动 API，CFG.aiEnable）
- Gitee Gist 云同步（CFG.cloudSyncEnable）
- 快捷键：Alt+Enter / Alt+S / Alt+D / Ctrl+Shift+A
- GM_notification 系统通知
- 答题报告 JSON/CSV 导出
- 题库浏览增强：正则搜索、答案筛选、随机抽查
- 配置分离导出/导入
- Word 文档导入（.docx）- v4.8.35+ 重构，v4.8.43 支持多文件同时导入
- Excel 文档导入（.xlsx）- v4.8.42 新增

## 仓库信息
- GitHub: https://github.com/JwOKR/MinuteStars-AutoAnswer
- Gitee: https://gitee.com/law-of-order/MinuteStars-AutoAnswer

## 踩坑经验
- 状态机模式下，如果传入的 `db` 对象被修改但没有调用 `LibraryManager.save(db)`，数据不会持久化（刷新即丢失）
- GM_notification 在不支持的环境中会静默失败，必须包 try-catch
- **GM_xmlhttpRequest 必须声明 `@grant GM_xmlhttpRequest`**，否则跨域请求会失败（GitHub Gist 云同步失败就是这个原因）
- AI 匹配默认用硅基流动 API（https://api.siliconflow.cn/v1/chat/completions），模型 DeepSeek-V3，免费额度足够
- 设置折叠区用 `display:none/block`，不要用 `max-height:0` + `overflow:hidden`，后者会导致内部控件事件无法触发
- GitHub Gist 上传 404：Gist ID 残留无效值导致 PATCH 请求到不存在的资源，需在上传前验证 ID 有效性

## 代码更新流程
每次更新代码后，**必须按此顺序完成所有步骤**：
1. **更新 `@version` 版本号**（`.user.js` 文件头部，`@version` 开头那行）⚠️ 不要漏！
2. 更新 `CHANGELOG.md`（在 "## v4.5.x" 下添加修改内容）
3. `git add` + `git commit` + `git push` 推送到 GitHub

> ⚠️ **版本号必须在 commit 之前更新**，不要先 push 再补版本号。

## 解析提取规则

## 提取内容
只提取：
- 题干（去除题号，保留出题人）
- 答案行（`答案：X`）

## 丢弃内容
- 题号前缀（如 `2.`）
- 选项（A.开头、B.结尾、C.、D. 等）
- 解析（`解析：` 及之后内容）

## 处理流程
1. 从题目标记开始收集行，直到下一题或遇到 `答案：`、`解析：`
2. 遇到 `答案：` 标记时，保留该行并停止收集
3. 去除题号前缀（正则匹配 `^\d+[\.、\s　]+`）
4. 保留出题人信息（如 `？余思思`）
5. 过滤掉选项行（以 `A.` `B.` `C.` `D.` 等开头的行）
6. 过滤空行

## 示例
**输入：**
```
2.徽标贯穿于视觉交流的始末，一般在企业设计手册的哪里？余思思
A.开头
B.结尾
答案：A
解析：
```

**输出：**
```
徽标贯穿于视觉交流的始末，一般在企业设计手册的哪里？余思思
答案：A
```
