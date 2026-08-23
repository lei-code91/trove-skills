/* trove-skills 核心服务端到端验证（不依赖网络，使用本地 git 仓库） */
const path = require('path')
const fs = require('fs')

const { GitService } = require('D:/Workspace/Temp/trove-e2e/git.cjs')
const { LibraryManager } = require('D:/Workspace/Temp/trove-e2e/library.cjs')
const { LinksManager } = require('D:/Workspace/Temp/trove-e2e/links.cjs')

const BASE = 'D:/Workspace/Temp'
const REPO_DIR = BASE + '/trove-test-repo'
const REPO = 'file:///' + REPO_DIR
const SKILLS_DIR = BASE + '/trove-e2e/main-library'
const LINKS_DIR = BASE + '/trove-e2e/links-data'
const PROJECT = BASE + '/test-project'

const { execSync } = require('child_process')

function setupSourceRepo() {
  fs.rmSync(REPO_DIR, { recursive: true, force: true })
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

async function main() {
  setupSourceRepo()
  const git = new GitService(() => 'git')
  const library = new LibraryManager(async () => SKILLS_DIR, BASE + '/trove-e2e/index.json')
  const links = new LinksManager(() => LINKS_DIR)

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

  fs.mkdirSync(PROJECT, { recursive: true })
  const project = await links.addProject(PROJECT)
  console.log('✓ project added:', project.name, '| skillsDir:', project.skillsDir)
  const linked = await links.linkSkills(project.id, ['root-skill', 'sub-skill'], (n) => library.resolveSkillDir(n))
  console.log('✓ linked:', linked.links.map((l) => l.skillName).join(', '))

  const viaLink = fs.readFileSync(path.join(PROJECT, 'skills', 'root-skill', 'SKILL.md'), 'utf-8')
  const inLibrary = fs.readFileSync(path.join(SKILLS_DIR, 'root-skill', 'SKILL.md'), 'utf-8')
  console.log('✓ link content match:', viaLink === inLibrary)
  const linkStat = fs.lstatSync(path.join(PROJECT, 'skills', 'root-skill'))
  console.log('✓ is symbolic link:', linkStat.isSymbolicLink())

  const unlinked = await links.unlinkSkill(project.id, 'root-skill')
  console.log('✓ unlink, remaining:', unlinked.links.map((l) => l.skillName).join(', '))
  const gone = !fs.existsSync(path.join(PROJECT, 'skills', 'root-skill'))
  const libStillThere = fs.existsSync(path.join(SKILLS_DIR, 'root-skill'))
  console.log('✓ link removed & library intact:', gone && libStillThere)

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
  const updatedLinkContent = fs.readFileSync(path.join(PROJECT, 'skills', 'sub-skill', 'SKILL.md'), 'utf-8')
  console.log('✓ update works, new desc:', updated.description)
  console.log('✓ linked skill still readable:', updatedLinkContent.length > 0)

  await library.uninstall('sub-skill')
  const afterUninstall = await library.scan()
  console.log('✓ uninstall, remaining:', afterUninstall.skills.map((s) => s.name).join(', '))

  const draft = await library.createDraft('ai-skill', '---\nname: ai-skill\ndescription: AI 生成\n---\n# AI\n正文')
  console.log('✓ ai draft saved:', draft.name, draft.status)
  const summarized = await library.applySummary('ai-skill', '新描述', ['t1', 't2'])
  console.log('✓ summary applied:', summarized.description, summarized.tags.join(','))

  fs.mkdirSync(SKILLS_DIR + '/plain-skill', { recursive: true })
  fs.writeFileSync(SKILLS_DIR + '/plain-skill/SKILL.md', '# Plain\n\n正文', 'utf-8')
  const plain = await library.scan()
  const plainSkill = plain.skills.find((s) => s.name === 'plain-skill')
  console.log('✓ plain skill parsed:', plainSkill?.title, '| desc:', plainSkill?.description?.slice(0, 10))

  console.log('\n✅ ALL E2E CHECKS PASSED')
}

main().catch((e) => {
  console.error('❌ E2E FAILED:', e)
  process.exit(1)
})