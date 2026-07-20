# 版本号与 Git 分支管理规范

状态：生效
生效日期：2026-07-17
适用范围：TCTP Vivian 全仓库，包括后端、Web 前端、脚本、内置技能与项目文档。

## 1. 目标与原则

本项目采用“语义化版本 + 轻量 GitFlow + Conventional Commits”。目标是让任意提交、构建包和生产版本都可以追踪来源，并将开发中代码与生产代码隔离。

必须遵守以下原则：

1. `main` 始终代表生产基线，只接收正式发布和紧急修复。
2. `develop` 是日常开发集成分支，每项工作使用独立的短生命周期分支，完成验证后可直接合入 `develop`。
3. 常规发布只有 `develop -> main` 必须通过 Pull Request；其他合并不强制 PR。
4. 根目录 `VERSION` 是项目版本号的唯一可信来源（Single Source of Truth）。
5. 普通开发分支不修改正式版本号；版本号只在 `develop` 准备正式发布时或 `hotfix` 分支中调整。
6. 所有正式版本都使用不可移动的 Git 标签 `vX.Y.Z` 标记。
7. 禁止对 `main`、`develop`、正式版本标签执行强制推送或改写历史。

## 2. 版本号规则

### 2.1 格式

正式版本采用 Semantic Versioning 2.0.0：

```text
MAJOR.MINOR.PATCH
例如：1.4.2
```

| 版本位 | 何时递增 | 示例 |
| --- | --- | --- |
| `MAJOR` | 出现不兼容的 API、配置、数据格式或部署方式变更 | `1.8.3 -> 2.0.0` |
| `MINOR` | 新增向后兼容的功能或能力 | `1.8.3 -> 1.9.0` |
| `PATCH` | 向后兼容的缺陷、安全或小型性能修复 | `1.8.3 -> 1.8.4` |

递增高位时，低位归零。不能用日期、提交次数或“最终版”等名称替代语义化版本。

当前项目已使用 `1.0.0` 作为后端版本，因此本规范以 `1.0.0` 为版本基线，不重新降为 `0.x`。

### 2.2 预发布版本

需要 UAT 或灰度验证时，可使用：

```text
1.5.0-alpha.1   # 内部早期验证
1.5.0-beta.1    # 功能基本完整，扩大验证
1.5.0-rc.1      # 发布候选，只接受阻断性修复
```

编号从 `1` 开始递增。同一个正式版本的阶段顺序为 `alpha -> beta -> rc -> 正式版`。正式发布时移除预发布后缀。

构建元数据可用于临时制品，例如 `1.5.0-rc.1+g1a2b3c4`，但正式 Git 标签不使用 `+...` 元数据。

### 2.3 版本文件与镜像字段

根目录 `VERSION` 是唯一可信来源，内容只能是一行不带 `v` 前缀的版本号：

```text
1.0.0
```

后端启动时直接向上查找并读取 `VERSION`，FastAPI 元数据、启动日志和健康检查接口都使用该值。仓库中的 `vivian/api/config.yaml` 不得再包含 `app_version`。生产环境保留的旧配置即使仍含该字段，后端也只为兼容启动而接收并忽略它，不会覆盖新代码的版本号。

下列前端生态字段是镜像，发布时必须与 `VERSION` 一致：

- `vivian/web/package.json` 中的 `version`
- `vivian/web/package-lock.json` 顶层及根包的 `version`

校验命令：

```bash
python3 scripts/check_version.py
```

打包脚本必须从根目录 `VERSION` 读取制品版本，不得自行维护默认正式版本。发布包中必须同时包含 `VERSION` 与 `CHANGELOG.md`，用于部署核对和问题追溯。

## 3. 分支模型

### 3.1 长期分支

| 分支 | 用途 | 允许的合并来源 | 保护要求 |
| --- | --- | --- | --- |
| `main` | 已发布的生产基线 | `develop`（PR）、`hotfix/*`（紧急直合） | 禁止普通直推和强推；`develop` 合入必须 PR |
| `develop` | 下一版本的集成基线 | 日常工作分支、`main`/`hotfix/*` 回合并 | 日常分支验证后可直接合入，不强制 PR |

采用本规范后，应从当时的 `main` 一次性创建 `develop`。若存在尚未合并的工作，先完成或整理该工作，再建立 `develop`，不要在脏工作区中强行切换分支。

### 3.2 短期分支类型

| 前缀 | 基于 | 合并到 | 用途 |
| --- | --- | --- | --- |
| `feature/` | `develop` | `develop` | 新功能 |
| `fix/` | `develop` | `develop` | 尚未发布代码的缺陷修复 |
| `refactor/` | `develop` | `develop` | 不改变外部行为的重构 |
| `perf/` | `develop` | `develop` | 性能优化 |
| `docs/` | `develop` | `develop` | 纯文档变更 |
| `test/` | `develop` | `develop` | 纯测试变更 |
| `chore/` | `develop` | `develop` | 工具、依赖或维护工作 |
| `hotfix/vX.Y.Z-*` | `main` | `main`，随后回合并 `develop` | 已发布生产版本的紧急修复 |

Codex 创建的分支保留平台要求的 `codex/` 前缀，并在其后使用相同分类：

```text
codex/feature/session-export
codex/fix/VIV-142-sse-reconnect
codex/docs/version-policy
```

### 3.3 命名要求

格式：

```text
<type>/<ticket-id>-<short-description>
```

规则：

- 全部使用小写英文字母、数字和连字符 `-`。
- 有任务编号时保留编号，例如 `feature/VIV-128-skill-sharing`；若任务系统区分大小写，可保留编号的大写部分。
- 描述控制在 3 至 6 个英文单词，表达结果而不是实现过程。
- 禁止使用个人姓名、`temp`、`test1`、`new` 等无语义名称。
- 一个分支只解决一个主题；发现无关问题时另开分支。

### 3.4 分支生命周期

1. 开始前同步基线分支，再创建工作分支。
2. 工作分支应尽量在 1 至 3 个工作日内合并；大型工作拆成可独立验证的小批次。
3. 开发期间定期将最新 `develop` 合入或 rebase 到工作分支；已多人共享的分支不要随意改写历史。
4. 合入 `develop` 后删除远端和本地短期分支。
5. 已合并分支不得复用；后续修改创建新分支。

常规工作示例：

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/VIV-128-session-export
```

## 4. 提交信息规范

提交采用 Conventional Commits：

```text
<type>(<scope>): <subject>
```

常用类型：

| 类型 | 含义 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `build` | 构建或依赖 |
| `ci` | CI/CD |
| `chore` | 其他维护工作 |
| `revert` | 撤销提交 |

建议 scope：`api`、`web`、`auth`、`agent`、`skills`、`scheduler`、`channels`、`build`、`docs`。

示例：

```text
feat(skills): add skill publication review
fix(api): prevent duplicate active runs
docs(release): define hotfix workflow
```

要求：

- subject 使用祈使语气，简洁说明结果，不以句号结尾。
- 每个提交保持单一目的，并保证仓库处于可构建、可测试状态。
- 不允许 `update`、`fix bug`、`wip` 等无法追踪意图的正式提交。
- 不兼容变更使用 `!`，并在正文写明迁移方式，例如 `feat(api)!: remove legacy token format`。
- 关联任务可在正文或 footer 写 `Refs: VIV-128`；自动关闭任务使用 `Closes: VIV-128`。

## 5. Pull Request 与合并规则

只有常规发布的 `develop -> main` 强制使用 PR。该发布 PR 必须包含：

- 变更目的和范围。
- 采用的验证方式及结果。
- 风险、兼容性与回滚方式。
- 用户可感知变更对应的 `CHANGELOG.md` 条目。
- API、配置、数据结构或部署方式变更对应的文档更新。

合并策略：

- 普通工作分支合入 `develop`：不强制 PR；合并前由开发者完成代码检查和相关测试，优先使用 squash 保持单一主题。
- 常规发布 `develop` 合入 `main`：必须使用 PR，检查通过后使用 **Merge commit** 保留发布边界。
- 紧急修复：从 `main` 创建 `hotfix/*`，验证通过后由有权限的维护者直接合入 `main`，不要求 PR；发布后必须立即同步到 `develop`。
- 除经过验证的 `hotfix/*` 外，禁止直接向 `main` 推送或合并其他分支。

建议在代码托管平台启用：

1. `main` 禁止强制推送，常规账号禁止直接推送。
2. `develop -> main` 要求 PR、最新分支、测试、构建和 `python3 scripts/check_version.py` 通过。
3. `develop -> main` 至少需要 1 名非提交者审核。
4. 为指定维护者保留 hotfix 紧急合入权限；该权限不得用于普通功能或绕过常规发布。
5. `develop` 不要求 PR，但禁止强制推送；自动删除已合并的短期分支。

## 6. CHANGELOG 规则

`CHANGELOG.md` 使用以下分类：

```text
Added / Changed / Deprecated / Removed / Fixed / Security
```

- 日常开发只维护 `[Unreleased]`。
- 记录用户、运维或集成方能感知的变化，不逐条复制 Git 提交。
- 纯格式化、内部测试补充等无外部影响的变化可以不记录。
- 发布时把 `[Unreleased]` 内容移动到 `## [X.Y.Z] - YYYY-MM-DD`，然后创建新的空 `[Unreleased]`。
- 安全问题在披露前不得把利用细节写入公开日志。

## 7. 正式发布流程

假设从 `1.4.2` 发布 `1.5.0`：

1. 确认 `develop` 已通过测试，功能冻结。
2. 在 `develop` 将 `VERSION` 和前端镜像字段更新为 `1.5.0`。
3. 整理 `CHANGELOG.md`，写入发布日期。
4. 运行版本校验、后端测试、前端测试和前端构建。
5. 发布冻结期间只在 `develop` 修复发布阻断问题并重新验证。
6. 创建 `develop -> main` PR，审核通过后使用 merge commit 合并。
7. 在 `main` 的发布合并提交上创建 annotated tag `v1.5.0` 并推送。
8. 从该标签构建并发布制品，记录制品校验值和部署环境。
9. 将 `main` 的发布合并提交同步回 `develop`，保持清晰的共同历史。

推荐命令：

```bash
python3 scripts/check_version.py
python3 -m pytest
npm --prefix vivian/web test
npm --prefix vivian/web run build
git tag -a v1.5.0 -m "Release v1.5.0"
git push origin v1.5.0
```

标签创建前必须确认：

- 标签名与 `VERSION` 完全一致，仅多一个 `v`。
- 工作区干净，HEAD 是已审核的 `main` 发布提交。
- 同名标签不存在。正式标签一旦推送，不得删除后重建；如发布有误，发布新的 PATCH 版本。

## 8. 紧急修复流程

生产版本 `1.5.0` 出现紧急问题时：

1. 从 `main` 创建 `hotfix/v1.5.1-<description>`。
2. 只包含必要修复、回归测试、版本更新和 CHANGELOG。
3. 版本按 PATCH 递增到 `1.5.1`；若修复本身造成不兼容变化，必须重新评估版本级别。
4. 验证通过后由有权限的维护者直接合入 `main`，创建 `v1.5.1` 标签并从标签部署，不要求 PR。
5. 立即把更新后的 `main` 回合并到 `develop`；若 `develop` 已准备更高版本，保留较高版本号并带入修复内容。

hotfix 不先进入 `develop`，避免把未发布功能带入生产。紧急不等于跳过代码检查、测试、版本检查或标签。若必须先恢复服务，应优先回滚到上一已知正常标签，再按流程修复。

## 9. 每次开发的执行清单

### 开始前

- [ ] 阅读本规范并确认当前任务类型。
- [ ] 运行 `git status --short --branch`，确保不会覆盖他人或未提交改动。
- [ ] 从正确基线创建符合规范的分支；不得直接在 `main`/`develop` 开发。
- [ ] 明确验收标准、兼容性影响和是否需要 CHANGELOG。

### 开发中

- [ ] 提交保持小而完整，信息符合 Conventional Commits。
- [ ] 新增或改变行为时同步测试和文档。
- [ ] 不在普通工作分支修改正式版本号。
- [ ] 不把凭据、运行数据、构建产物或本机配置提交到仓库。

### 合入 `develop` 前

- [ ] 查看完整 diff，移除调试代码和无关变更。
- [ ] 运行相关测试；若未运行，必须在合并记录或交付说明中写明原因和风险。
- [ ] 用户可感知变更已写入 `CHANGELOG.md` 的 `[Unreleased]`。
- [ ] 运行 `python3 scripts/check_version.py`。
- [ ] 最终提交信息符合 Conventional Commits。

### `develop -> main` 发布 PR 前

- [ ] `VERSION`、前端镜像字段和目标发布版本一致。
- [ ] CHANGELOG 已从 `[Unreleased]` 整理为带日期的发布章节。
- [ ] 后端测试、前端测试、前端构建和版本检查全部通过。
- [ ] PR 中写明发布范围、风险与回滚方案。

## 10. 首次启用步骤

本规范合并后执行一次以下初始化；不要在含未提交改动的工作区中执行：

1. 先合并或妥善保存采用规范前遗留的开发分支，确认 `main` 对应的真实生产状态。
2. 仅当 `main` 的提交确实对应已发布的 `1.0.0` 时，在该提交创建 `v1.0.0` 标签。若不对应，不得为了补齐形式伪造标签，应按正式发布流程产生下一个真实版本。
3. 从最新 `main` 创建并推送 `develop`。
4. 按第 5 节配置权限：`develop -> main` 必须 PR，并把 `Check project version` 设为必需检查；指定维护者保留 hotfix 合入权限。
5. 后续新任务全部从规范规定的基线创建分支；采用规范前的存量分支可完成当前工作后删除，不要求为改名而重写历史。

参考命令：

```bash
git status --short --branch
git switch main
git pull --ff-only origin main
git switch -c develop
git push -u origin develop
```

`v1.0.0` 标签是否创建必须根据真实部署记录单独判断，不包含在上述通用命令中。

## 11. 例外处理

确有必要偏离本规范时，必须在提交或发布记录中写明原因、影响范围、补救动作和恢复日期，并由仓库维护者批准。口头约定或“临时处理”不能自动成为新规则；长期例外应更新本文档。
