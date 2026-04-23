# Changelog

## v4.4.1
- 修复多选题命中但不勾选的问题：checkInput 增加 label 优先触发 + pointerdown/pointerup 事件链 + await 顺序执行防止并行冲突

## v4.4.0
- 主面板 UI 全面升级：暗色主题 + 渐变色 + 统计卡片 + 进度条动画

## v4.3.3
- 重写答案采集逻辑，兼容 MinuteStars 结果页 `.answer-badge.reference` 结构

## v4.3.2
- 修复答案采集误采集用户自己答案的问题

## v4.3.1
- 修复 Tampermonkey 沙箱下 MouseEvent view 报错
