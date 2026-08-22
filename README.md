# Trove Skills

AI Agent Skills 管理桌面应用（Electron + TypeScript + React）。

管理你的 Agent Skills（以 `SKILL.md` 为单位的技能包）：从 Git 仓库安装到**技能主库**，再按项目把需要的技能**链接**过去 —— 安装与应用彻底解耦，主库是唯一权威来源。

## 核心概念

```
trove LIBRARY（主库，唯一权威来源）
  └─ skill-a/ SKILL.md ...
  └─ skill-b/

project/（用户选择的任意项目文件夹）
  └─ skills/
      ├─ skill-a/  ← junction 链接 → 主库/skill-a（不复制文件）
      └─ skill-b/  ← junction 链接 → 主库/skill-b
```

- **安装**：从 Git 仓库（https / owner/repo）浅克隆，自动识别仓库内所有含 `SKILL.md` 的技能（仓库根或子目录），勾选后安装进主库。**不会直接写入任何 Agent**。
- **链接**：添加项目文件夹后，勾选该项目需要的技能，应用在 `<项目>/skills/` 下创建指向主库的链接（Windows junction，不需要管理员权限）。主库技能更新后项目自动同步；断开链接随时可做，不影响主库。
- **LLM**：可保存多个 OpenAI 兼容 API 配置（Base URL / Key / 模型）随时切换，用于 AI 摘要（优化 description/标签）与 AI 创建技能（一句话生成 SKILL.md 草稿）。

## 开发

```bash
npm install        # 安装依赖（.npmrc 已配置 npmmirror 镜像）
npm run dev        # 开发模式启动桌面应用
npm run typecheck  # 类型检查
npm run build      # 构建 out/
npm run build:win  # 打包 Windows 安装包（dist/）
```

### 环境要求

- Node.js ≥ 20
- Git（安装技能必需；可在应用设置中指定 git.exe 路径）

## 使用

1. `npm run dev` 或安装打包后的安装包
2. **设置** → 配置技能主库目录（默认 `%APPDATA%/Trove Skills/skills`）
3. **技能库** → 「⬇️ 从 Git 安装」输入仓库地址 → 勾选技能 → 安装
   - 也支持「导入本地技能」（选择含 SKILL.md 的文件夹）与「✨ AI 创建」
4. **项目链接** → 「＋ 添加项目」选择项目文件夹 → 「管理链接」勾选需要的技能
5. **设置 → LLM 配置** → 新增配置（OpenAI 兼容端点）→ 测试连接 → 保存；可保存多个并一键切换

## 项目结构

```
src/
├─ main/            # 主进程（Electron）
│  ├─ index.ts      # 窗口与生命周期
│  ├─ ipc.ts        # IPC 注册（受控白名单）
│  └─ services/     # settings / library / git / links / llm
├─ preload/         # contextBridge 安全桥
├─ renderer/        # React UI（技能库 / 项目链接 / 设置）
└─ shared/          # main/preload/renderer 共享类型
```

## 安全设计

- 渲染进程无 Node 权限，所有磁盘 / Git / 网络操作走主进程白名单 IPC
- 安装仅落盘 + 解析元数据，**不执行仓库内任何脚本**
- Git 克隆使用 `--depth 1` 浅克隆；卸载/断开链接时先校验目标是链接才删除，绝不递归删除真实目录
- API Key 仅存本机配置文件（`%APPDATA%/Trove Skills/settings.json`），不进代码仓库

## License

MIT