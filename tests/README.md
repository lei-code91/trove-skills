# 核心服务端到端回归测试

验证 trove-skills 主进程核心链路（不依赖网络，使用本地 git 仓库）：

1. git 可用性 / 远程可达性检查
2. 浅克隆 + 技能识别（仓库根 SKILL.md + 子目录技能）
3. 安装进主库 / 重复安装拦截 / 扫描
4. 项目添加 + junction 链接（验证链接内容与主库一致、isSymbolicLink）
5. 断开链接（链接消失、主库保留）
6. 更新（模拟仓库 v1→v2）与链接自动同步
7. 卸载 / AI 草稿保存 / AI 摘要应用 / 无 frontmatter 容错解析

## 运行

```bash
# 先 bundle 服务模块（esbuild 来自 electron-vite 依赖）
npx esbuild src/main/services/git.ts --bundle --platform=node --format=cjs --outfile="D:/Workspace/Temp/trove-e2e/git.cjs"
npx esbuild src/main/services/library.ts --bundle --platform=node --format=cjs --outfile="D:/Workspace/Temp/trove-e2e/library.cjs"
npx esbuild src/main/services/links.ts --bundle --platform=node --format=cjs --outfile="D:/Workspace/Temp/trove-e2e/links.cjs"

node tests/e2e-core.js
```

注意：脚本使用 `D:/Workspace/Temp` 作为测试暂存区（本机固定），且每次运行会重建本地 git 测试仓库。