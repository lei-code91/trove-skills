import React, { createContext, useCallback, useContext, useRef, useState } from 'react'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'err'
}

const ToastContext = createContext<{ push: (text: string, kind?: 'info' | 'err') => void }>({
  push: () => {}
})

export function useToast(): { push: (text: string, kind?: 'info' | 'err') => void } {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<Toast[]>([])
  const idRef = useRef(0)

  const push = useCallback((text: string, kind: 'info' | 'err' = 'info') => {
    const id = ++idRef.current
    setItems((prev) => [...prev, { id, text, kind }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 3600)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}