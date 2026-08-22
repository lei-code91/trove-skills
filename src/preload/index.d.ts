import type { TroveApi } from './index'

declare global {
  interface Window {
    trove: TroveApi
  }
}

export {}