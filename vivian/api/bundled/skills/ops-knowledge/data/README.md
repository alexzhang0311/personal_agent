# 用户数据目录

此目录存放用户实际维护的子系统数据和故障记录。

## 目录结构

```
data/
├── index.md                    # 本实例子系统索引
├── {subsystem}/                # 各子系统数据目录
│   ├── metadata.yaml
│   ├── functions.yaml
│   ├── business-scenarios.yaml
│   ├── relations/
│   │   └── *.yaml
│   ├── sop/
│   │   └── sop-*.md
│   ├── index.md
│   ├── deploy.md
│   ├── api.md
│   ├── deps.md
│   └── troubleshoot.md
└── incidents/                  # 历史故障记录
    └── {year}/
        └── incident-*.md
```
