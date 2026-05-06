# 千寻宜 MinuteStars 自动答题器 Pro

Tampermonkey 自动答题脚本，支持 MinuteStars 在线答题平台。

## 功能特性

- **纯云端题库** — 用户题库通过 GitHub Gist 同步，随时随地保持最新
- **直读云端模式** — 答题实时拉取云端题库，无需下载到本地，5 分钟内存缓存
- **Jaro-Winkler 模糊匹配** — 替换旧版 Levenshtein，N-gram 预筛选 + 长度分桶索引，匹配更快更准
- **规则推断** — 自动推断错题答案策略（如"以上都对"等常见规律）
- **AI 语义兜底** — 模糊匹配未命中时，自动调用 DeepSeek / 硅基流动 API 语义匹配
- **Gist 云同步** — 上传（合并）/ 下载（覆盖）均可，支持 Gitee Gist
- **答题报告导出** — 支持 JSON / CSV 格式导出答题记录
- **题库浏览增强** — 正则搜索、答案筛选、随机抽查
- **Word 文档导入** — 一键导入 .docx 格式题库
- **配置分离备份** — 导出 / 导入独立配置文件
- **快捷键** — `Alt+Enter` 开始答题、`Alt+S` 暂停、`Alt+D` 重置、`Ctrl+Shift+A` 扫描
- **GM 系统通知** — 答题完成、错题提醒等通过系统通知推送
- **可视化面板** — 实时显示正确率、正确数、错题数、速度曲线、饼图统计
- **拖拽 + 调整大小** — 答题面板可拖拽移动、8 方向调整尺寸
- **多域名支持** — `pcs` / `erp` / `marketoperation` / `multimedia` / `zhibo` 全覆盖
- **深色模式** — 自动跟随系统主题
- **题库标签 & 策略预设** — 支持给题目打标签、分组管理
- **设置搜索** — 快速定位配置项

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 [千寻宜MinuteStars自动答题_merged.user.js](./千寻宜MinuteStars自动答题_merged.user.js) 安装脚本
3. 打开 MinuteStars 答题页面，脚本自动运行

## 版本

当前版本：**v4.5.66**

详见 [CHANGELOG](./CHANGELOG.md)。
