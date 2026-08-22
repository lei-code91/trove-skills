import React, { useEffect, useState } from 'react'

/**
 * 应用内标题栏：无边框窗口的拖拽区 + 最小化 / 最大化-还原 / 关闭。
 * - 左侧为拖拽区（-webkit-app-region: drag），双击最大化/还原
 * - 右侧为窗口控制按钮（no-drag）
 */
export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.trove.isMaximized().then(setMaximized)
    const off = window.trove.onMaximizeChange(setMaximized)
    return off
  }, [])

  return (
    <div className="titlebar">
      <div
        className="titlebar-drag"
        onDoubleClick={() => void window.trove.toggleMaximizeWindow()}
        title="双击最大化/还原"
      >
        <span className="titlebar-logo">🗃️</span>
        <span className="titlebar-name">Trove Skills</span>
        <span className="titlebar-current">AI Agent Skills 管理</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="tb-btn"
          onClick={() => void window.trove.minimizeWindow()}
          title="最小化"
          aria-label="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="tb-btn"
          onClick={() => void window.trove.toggleMaximizeWindow()}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="3.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M3.5 3.5 V2 H10.5 V9 H9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button
          className="tb-btn tb-close"
          onClick={() => void window.trove.closeWindow()}
          title="关闭"
          aria-label="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}