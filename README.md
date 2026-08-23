# Trove Skills

> AI Agent Skills 管理桌面应用 —— 从 Git 仓库安装技能，按项目链接使用，LLM 辅助管理。

Trove Skills 是一款 Windows 桌面应用（Electron + TypeScript + React），用于管理你的 Agent Skills（以 `SKILL.md` 为单位的技能包）。安装与应用彻底解耦：技能从 Git 仓库**安装**到技能主库（唯一权威来源），再按项目把需要的技能**链接**过去，不复制文件、随主库自动同步。

## 功能特性

- 📦 **从 Git 安装技能**：输入仓库地址（https / `owner/repo`）浅克隆，自动识别仓库内所有含 `SKILL.md` 的技能（仓库根或子目录），勾选后一键安装进主库；也支持导入本地技能文件夹
- 🔗 **按项目链接**：添加任意项目文件夹，为该项目勾选所需技能，在 `<项目>/skills/` 下创建指向主库的链接（Windows junction，无需管理员权限），主库更新后项目自动同步，断开链接不影响主库
- ✨ **AI 辅助**：可保存多个 OpenAI 兼容 API 配置（Base URL / Key / 模型）随时切换，用于技能 AI 摘要（优化 description / 标签）与 AI 创建技能（一句话生成 `SKILL.md` 草稿）
- 🛡️ **安全设计**：渲染进程无 Node 权限，所有磁盘 / Git / 网络操作走主进程白名单 IPC；安装仅落盘 + 解析元数据，不执行仓库内脚本；删除前校验目标是链接才动手

## 核心概念

```
trove LIBRARY（技能主库，唯一权威来源）
  ├─ skill-a/  SKILL.md ...
  └─ skill-b/  SKILL.md ...

project/（用户选择的任意项目文件夹）
  └─ skills/
      ├─ skill-a/  ← junction 链接 → 主库/skill-a（不复制文件）
      └─ skill-b/  ← junction 链接 → 主库/skill-b
```

- **安装 ≠ 应用**：安装只把技能放进主库，不会直接写入任何 Agent
- **链接 = 引用**：项目通过 junction 引用主库技能，始终与主库保持同步

## 快速开始

1. 从 [Releases](https://github.com/lei-code91/trove-skills/releases) 下载最新版安装包（`Trove Skills Setup x.y.z.exe`）并安装
2. 启动应用 → **设置** → 配置技能主库目录（默认 `%APPDATA%/Trove Skills/skills`）
3. **技能库** → 「⬇️ 从 Git 安装」输入仓库地址 → 勾选技能 → 安装
4. **项目链接** → 「＋ 添加项目」选择项目文件夹 → 「管理链接」勾选所需技能
5. （可选）**设置 → LLM 配置** → 新增 OpenAI 兼容端点 → 测试连接 → 保存，可保存多个配置一键切换

## 开发

```bash
npm install        # 安装依赖（.npmrc 已配置 npmmirror 镜像）
npm run dev        # 开发模式启动桌面应用
npm run typecheck  # 类型检查（node + web）
npm run build      # 构建 out/
npm run build:win  # 打包 Windows 安装包（输出到 dist/）
```

### 环境要求

- Node.js ≥ 20
- Git（安装技能必需；可在应用设置中指定 `git.exe` 路径）

## 项目结构

```
src/
├─ main/            # 主进程（Electron）
│  ├─ index.ts      # 窗口与生命周期
│  ├─ ipc.ts        # IPC 注册（受控白名单）
│  └─ services/     # settings / library / git / links / llm
├─ preload/         # contextBridge 安全桥
├─ renderer/        # React UI（技能库 / 项目链接 / 设置）
└─ shared/          # main / preload / renderer 共享类型
```

## 安全设计

- 渲染进程无 Node 权限，所有磁盘 / Git / 网络操作走主进程白名单 IPC
- 安装仅落盘 + 解析元数据，**不执行仓库内任何脚本**
- Git 克隆使用 `--depth 1` 浅克隆；卸载 / 断开链接时先校验目标是链接才删除，绝不递归删除真实目录
- API Key 仅存本机配置文件（`%APPDATA%/Trove Skills/settings.json`），不进代码仓库

## License

MIT © Flyyun.Lei