/* trove-skills 核心服务端到端验证（不依赖网络，使用本地 git 仓库）
   覆盖：分组主库布局 / 旧扁平布局自动迁移 / 分组冲突后缀 / 项目位点多选 / 全局链接 */
const path = require('path')
const fs = require('fs')

const { GitService } = require('D:/Workspace/Temp/trove-e2e/git.cjs')
const { LibraryManager, sanitizeName } = require('D:/Workspace/Temp/trove-e2e/library.cjs')
const { LinksManager } = require('D:/Workspace/Temp/trove-e2e/links.cjs')

const BASE = 'D:/Workspace/Temp'
const REPO_DIR = BASE + '/trove-test-repo'
const REPO = 'file:///' + REPO_DIR
const SKILLS_DIR = BASE + '/trove-e2e/main-library'
const LINKS_DIR = BASE + '/trove-e2e/links-data'
const PROJECT = BASE + '/test-project'
const GLOBAL_DIR = BASE + '/trove-e2e/global-sites'
const ALT_DIR = BASE + '/trove-e2e/alt-sites'

const { execSync } = require('child_process')

/** 与主进程一致的仓库短名 → 分组目录名 */
function groupDirOf(url) {
  const u = url.trim().replace(/\.git$/, '')
  const m = /(?:https?:\/\/|git@|ssh:\/\/git@)?([\w.-]+)\/([\w.-]+)$/.exec(u.replace(/^.*?:\/\//, ''))
  const short = m ? `${m[1]}/${m[2]}` : u.replace(/^.*?:\/\//, '')
  return sanitizeName(short)
}

function setupSourceRepo() {
  fs.rmSync(REPO_DIR, { recursive: true, force: true })
  fs.rmSync(SKILLS_DIR, { recursive: true, force: true })
  fs.rmSync(LINKS_DIR, { recursive: true, force: true })
  fs.rmSync(GLOBAL_DIR, { recursive: true, force: true })
  fs.rmSync(ALT_DIR, { recursive: true, force: true })
  fs.rmSync(PROJECT, { recursive: true, force: true })
  fs.mkdirSync(REPO_DIR + '/sub-skill', { recursive: true })
  fs.writeFileSync(
    REPO_DIR + '/SKILL.md',
    '---\nname: root-skill\ndescription: 测试用根技能\nversion: 1.0.0\ntags: [test, demo]\n---\n# Root Skill\n\n这是仓库根技能。\n',
    'utf-8'
  )
  fs.writeFileSync(
    REPO_DIR + '/sub-skill/SKILL.md',
    '---\nname: sub-skill\ndescription: 测试用子目录技能\ntags: [test, sub]\n---\n# Sub Skill\n\n子目录技能正文。\n',
    'utf-8'
  )
  execSync(`git -C ${REPO_DIR} init -q`)
  execSync(`git -C ${REPO_DIR} add -A`)
  execSync(`git -C ${REPO_DIR} -c user.email=test@test.com -c user.name=test commit -qm init`)
}

/** 创建含 SKILL.md 的本地技能目录（用于模拟安装源） */
function makeSkillDir(dir, name, description) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    dir + '/SKILL.md',
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\n正文。\n`,
    'utf-8'
  )
}

async function main() {
  setupSourceRepo()
  const git = new GitService(() => 'git')
  const library = new LibraryManager(async () => SKILLS_DIR, BASE + '/trove-e2e/index.json')
  const links = new LinksManager(() => LINKS_DIR)
  const resolve = (name) => library.resolveSkillDir(name)
  const groupDir = groupDirOf(REPO)

  const v = await git.version()
  console.log('✓ git version:', v)

  const check = await git.checkRemote(REPO)
  console.log('✓ checkRemote:', check.ok ? 'ok' : `fail: ${check.message}`)
  if (!check.ok) throw new Error('checkRemote failed')

  const cloneDir = BASE + '/trove-e2e/clone'
  const commit = await git.cloneShallow(REPO, cloneDir)
  console.log('✓ clone shallow, commit:', commit)
  const skills = await git.detectSkills(cloneDir)
  console.log('✓ detected skills:', skills.map((s) => `${s.name}@${s.repoPath}`).join(', '))
  if (skills.length !== 2) throw new Error(`expected 2 skills, got ${skills.length}`)

  const rootSkill = skills.find((s) => s.repoPath === '.')
  const subSkill = skills.find((s) => s.repoPath === 'sub-skill')
  const installed = await library.install(path.join(cloneDir, rootSkill.repoPath), rootSkill.name, {
    kind: 'git',
    url: REPO,
    repoPath: rootSkill.repoPath,
    installedAt: new Date().toISOString(),
    commit
  })
  console.log('✓ installed:', installed.name, '| title:', installed.title, '| desc:', installed.description.slice(0, 20))
  await library.install(path.join(cloneDir, subSkill.repoPath), subSkill.name, {
    kind: 'git',
    url: REPO,
    repoPath: subSkill.repoPath,
    installedAt: new Date().toISOString(),
    commit
  })
  console.log('✓ installed sub:', subSkill.name)

  // 分组布局断言：技能落在 分组目录/技能名 下
  const groupedRoot = path.join(SKILLS_DIR, groupDir, 'root-skill')
  const groupedSub = path.join(SKILLS_DIR, groupDir, 'sub-skill')
  if (!fs.existsSync(groupedRoot + '/SKILL.md')) throw new Error(`未按分组目录安装: ${groupedRoot}`)
  if (!fs.existsSync(groupedSub + '/SKILL.md')) throw new Error(`未按分组目录安装: ${groupedSub}`)
  console.log(`✓ grouped layout: ${groupDir}/root-skill, ${groupDir}/sub-skill`)

  let dupError = false
  try {
    await library.install(path.join(cloneDir, rootSkill.repoPath), rootSkill.name, {
      kind: 'git',
      url: REPO,
      repoPath: '.',
      installedAt: new Date().toISOString()
    })
  } catch {
    dupError = true
  }
  console.log('✓ duplicate install rejected:', dupError)

  const scanned = await library.scan()
  console.log('✓ scan:', scanned.skills.map((s) => `${s.name}(${s.status}/${s.source?.kind})`).join(', '))
  const groupMeta = scanned.groups.find((g) => g.url === REPO)
  if (!groupMeta || groupMeta.dir !== groupDir) throw new Error(`groups 缺少 dir 字段: ${JSON.stringify(scanned.groups)}`)
  console.log('✓ repos group has dir:', groupMeta.dir)

  // 冲突后缀：两个不同 host 短名相同的仓库 → 第二个分组目录加 -2
  const srcA = BASE + '/trove-e2e/src-a'
  const srcB = BASE + '/trove-e2e/src-b'
  makeSkillDir(srcA, 'skill-a1', '模拟仓库 A')
  makeSkillDir(srcB, 'skill-b1', '模拟仓库 B')
  const urlA = 'https://github.com/same/repo'
  const urlB = 'https://gitlab.com/same/repo'
  await library.install(srcA, 'skill-a1', { kind: 'git', url: urlA, installedAt: new Date().toISOString() })
  await library.install(srcB, 'skill-b1', { kind: 'git', url: urlB, installedAt: new Date().toISOString() })
  const snap2 = await library.scan()
  const dirA = snap2.groups.find((g) => g.url === urlA).dir
  const dirB = snap2.groups.find((g) => g.url === urlB).dir
  if (dirA === dirB) throw new Error(`分组目录冲突未处理: ${dirA}`)
  const collisionOk = dirA === 'same-repo' && dirB.startsWith('same-repo-')
  console.log('✓ group dir collision handled:', dirA, '/', dirB, collisionOk)
  if (!collisionOk) throw new Error('分组目录冲突后缀不符合预期')

  // 项目位点：多个位点目录一次链接
  fs.mkdirSync(PROJECT, { recursive: true })
  const project = await links.addProject(PROJECT, [
    { dir: path.join(PROJECT, '.claude', 'skills'), kind: 'claude' },
    { dir: ALT_DIR, kind: 'custom' }
  ])
  console.log('✓ project added:', project.name, '| sites:', project.sites.map((s) => s.dir).join(' ; '))
  if (project.sites.length !== 2) throw new Error(`expected 2 sites, got ${project.sites.length}`)
  const linked = await links.linkProject(project.id, ['root-skill', 'sub-skill'], resolve)
  console.log('✓ linked:', linked.links.map((l) => `${l.skillName}@${path.basename(path.dirname(l.dir))}`).join(', '))
  if (linked.links.length !== 4) throw new Error(`expected 4 links (2 skills x 2 sites), got ${linked.links.length}`)

  const viaLink = fs.readFileSync(path.join(PROJECT, '.claude', 'skills', 'root-skill', 'SKILL.md'), 'utf-8')
  const inLibrary = fs.readFileSync(groupedRoot + '/SKILL.md', 'utf-8')
  console.log('✓ link content match:', viaLink === inLibrary)
  const linkStat = fs.lstatSync(path.join(ALT_DIR, 'root-skill'))
  console.log('✓ is symbolic link:', linkStat.isSymbolicLink())
  if (viaLink !== inLibrary || !linkStat.isSymbolicLink()) throw new Error('链接内容或类型不一致')

  // 位点变更：换成新目录 → 旧目录链接断开、保留位点目录重建
  const changed = await links.setSites(project.id, [{ dir: path.join(PROJECT, '.claude', 'skills'), kind: 'claude' }], resolve)
  if (changed.sites.length !== 1) throw new Error('setSites 后位点数量应为 1')
  if (fs.existsSync(path.join(ALT_DIR, 'root-skill'))) throw new Error('旧位点链接未断开')
  if (!fs.existsSync(path.join(PROJECT, '.claude', 'skills', 'sub-skill'))) throw new Error('保留位点链接丢失')
  console.log('✓ setSites: 旧位点断开，保留位点链接仍在，新链接数:', changed.links.length)

  const unlinked = await links.unlinkSkill(project.id, 'root-skill')
  console.log('✓ unlink, remaining:', unlinked.links.map((l) => l.skillName).join(', '))
  const gone = !fs.existsSync(path.join(PROJECT, '.claude', 'skills', 'root-skill'))
  const libStillThere = fs.existsSync(groupedRoot)
  console.log('✓ link removed & library intact:', gone && libStillThere)
  if (!gone || !libStillThere) throw new Error('断开链接或主库保留失败')

  fs.writeFileSync(REPO_DIR + '/SKILL.md', '---\nname: root-skill\ndescription: v2 描述\ntags: [test]\n---\n# v2\n', 'utf-8')
  execSync(`git -C ${REPO_DIR} add -A && git -C ${REPO_DIR} -c user.email=t@t.com -c user.name=t commit -qm v2`)
  const newClone = BASE + '/trove-e2e/clone2'
  await git.cloneShallow(REPO, newClone)
  const newSkills = await git.detectSkills(newClone)
  const updated = await library.update('root-skill', path.join(newClone, '.'), {
    kind: 'git',
    url: REPO,
    repoPath: '.',
    installedAt: installed.installedAt,
    lastUpdated: new Date().toISOString(),
    commit: await git.headCommit(newClone)
  })
  // 更新后仍在分组目录
  if (!fs.existsSync(groupedRoot + '/SKILL.md')) throw new Error('技能更新后不在分组目录')
  console.log('✓ update works, new desc:', updated.description)
  // 重新链接后验证同步
  await links.linkProject(project.id, ['root-skill'], resolve)
  const updatedLinkContent = fs.readFileSync(path.join(PROJECT, '.claude', 'skills', 'root-skill', 'SKILL.md'), 'utf-8')
  console.log('✓ linked skill still readable:', updatedLinkContent.length > 0)
  if (!updatedLinkContent.includes('v2')) throw new Error('链接未同步到更新内容')

  await library.uninstall('sub-skill')
  const afterUninstall = await library.scan()
  console.log('✓ uninstall, remaining:', afterUninstall.skills.map((s) => s.name).join(', '))
  if (fs.existsSync(groupedSub)) throw new Error('卸载后技能目录仍存在')

  const draft = await library.createDraft('ai-skill', '---\nname: ai-skill\ndescription: AI 生成\n---\n# AI\n正文')
  console.log('✓ ai draft saved:', draft.name, draft.status)
  if (!fs.existsSync(path.join(SKILLS_DIR, '_ai', 'ai-skill', 'SKILL.md'))) throw new Error('AI 草稿未落入 _ai 分组')
  const summarized = await library.applySummary('ai-skill', '新描述', ['t1', 't2'])
  console.log('✓ summary applied:', summarized.description, summarized.tags.join(','))

  // 旧扁平布局自动迁移：手工放一个一级技能目录 → scan 后应迁入 _local 分组
  fs.mkdirSync(SKILLS_DIR + '/plain-skill', { recursive: true })
  fs.writeFileSync(SKILLS_DIR + '/plain-skill/SKILL.md', '---\nname: plain-skill\ndescription: 无来源\n---\n# Plain\n\n正文', 'utf-8')
  const plain = await library.scan()
  const plainSkill = plain.skills.find((s) => s.name === 'plain-skill')
  console.log('✓ plain skill parsed:', plainSkill?.title, '| desc:', plainSkill?.description?.slice(0, 10))
  if (!fs.existsSync(path.join(SKILLS_DIR, '_local', 'plain-skill', 'SKILL.md'))) {
    throw new Error('旧扁平技能未被自动迁移到 _local 分组')
  }
  const legacyGone = !fs.existsSync(path.join(SKILLS_DIR, 'plain-skill'))
  console.log('✓ legacy layout migrated:', legacyGone, plainSkill?.source?.kind)

  // 全局链接：设定位点 → 链接技能 → sync 断开 → 单独断开
  const expectedGlobalDir = path.resolve(GLOBAL_DIR)
  const global = await links.setGlobalSites([{ dir: GLOBAL_DIR, kind: 'global' }], resolve)
  if (global.sites.length !== 1 || global.sites[0].dir !== expectedGlobalDir) throw new Error('全局位点设置失败')
  console.log('✓ global sites set:', global.sites.map((s) => s.dir).join(' ; '))
  const gLinked = await links.linkGlobal(['root-skill', 'plain-skill'], resolve, true)
  if (!fs.existsSync(path.join(GLOBAL_DIR, 'root-skill', 'SKILL.md'))) throw new Error('全局链接未创建')
  if (gLinked.links.length !== 2) throw new Error(`expected 2 global links, got ${gLinked.links.length}`)
  console.log('✓ global linked:', gLinked.links.map((l) => l.skillName).join(', '))
  // sync=true 后再次只勾选一个 → 另一个被断开
  const gSynced = await links.linkGlobal(['root-skill'], resolve, true)
  if (fs.existsSync(path.join(GLOBAL_DIR, 'plain-skill'))) throw new Error('sync 后未勾选技能未断开')
  console.log('✓ global sync removed unselected, remaining:', gSynced.links.map((l) => l.skillName).join(', '))
  const gUn = await links.unlinkGlobal('root-skill')
  if (fs.existsSync(path.join(GLOBAL_DIR, 'root-skill'))) throw new Error('全局链接未断开')
  console.log('✓ global unlinked, remaining:', gUn.links.map((l) => l.skillName).join(', ') || '（空）')

  console.log('\n✅ ALL E2E CHECKS PASSED')
}

main().catch((e) => {
  console.error('❌ E2E FAILED:', e)
  process.exit(1)
})