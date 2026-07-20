# 更新日志

本文件记录 TCTP Vivian 的重要变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 建立统一的语义化版本、分支、提交、发布与热修复管理规范。
- 新增项目 README，说明开发环境启动、打包、离线生产部署和增量更新流程。

### Changed

- 应用版本从运行配置 `config.yaml` 中移出，统一由发布包根目录 `VERSION` 提供，避免生产保留旧配置时显示错误版本。

### Deprecated

### Removed

### Fixed

- 修复新对话列表延迟、页面刷新中断活动任务、多 Chat 并发串线及审批状态产生重复列表项的问题。
- API 启动失败时保留 Uvicorn 导入异常和 traceback，并在启动命令中回显本次失败日志。

### Security

> 项目在采用本规范前的历史变更不做追溯补录。当前版本基线见根目录
> `VERSION` 文件；只有完成正式发布后，才在此处新增带日期的版本章节。
