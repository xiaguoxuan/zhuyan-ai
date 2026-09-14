/// <reference types="vite/client" />

import type { ZhuyanDesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    zhuyan: ZhuyanDesktopApi;
  }
}

export {};
