/** URL 归一化：支持 https URL、github.com/owner/repo、owner/repo、git@ 形式 */
export function normalizeRepoUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new Error('请输入仓库地址')
  // 已经是绝对 URL 或 ssh
  if (/^(https?|git|ssh):\/\//i.test(url) || /^git@/i.test(url)) {
    if (/^git@/i.test(url)) return url
    if (!/\.git$/.test(url)) url += '.git'
    return url
  }
  // github.com/owner/repo 或 owner/repo 或 owner/repo.git
  const m = /^(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url)
  if (m) return `https://github.com/${m[1]}/${m[2]}.git`
  throw new Error('无法识别的仓库地址，支持：https URL、github.com/owner/repo、owner/repo')
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function shortUrl(url?: string): string {
  if (!url) return '本地'
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}