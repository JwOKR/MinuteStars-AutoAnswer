# MinuteStars-AutoAnswer 项目规范

## v4.5.40 新增功能速查（2026-04-28）
- Jaro-Winkler 模糊匹配（替换 Levenshtein）
- N-gram 候选预筛选 + 长度分桶索引
- AI 辅助匹配（DeepSeek/硅基流动 API，CFG.aiEnable）
- GitHub Gist 云同步（CFG.cloudSyncEnable）
- 快捷键：Alt+Enter / Alt+S / Alt+D / Ctrl+Shift+A
- GM_notification 系统通知
- 答题报告 JSON/CSV 导出
- 题库浏览增强：正则搜索、答案筛选、随机抽查
- 配置分离导出/导入

## 踩坑经验
- GM_notification 在不支持的环境中会静默失败，必须包 try-catch
- **GM_xmlhttpRequest 必须声明 `@grant GM_xmlhttpRequest`**，否则跨域请求会失败（GitHub Gist 云同步失败就是这个原因）
- AI 匹配默认用硅基流动 API（https://api.siliconflow.cn/v1/chat/completions），模型 DeepSeek-V3，免费额度足够
- 设置折叠区用 `display:none/block`，不要用 `max-height:0` + `overflow:hidden`，后者会导致内部控件事件无法触发

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
