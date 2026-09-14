import { contextBridge, ipcRenderer } from "electron";
import type { ReferenceAnalysisEvent, RunEvent, ShoppingListEvent, ZhuyanDesktopApi } from "../shared/contracts.js";

const IPC = {
  selectRoomImage: "zhuyan:select-room-image",
  selectReferenceImage: "zhuyan:select-reference-image",
  analyzeReferenceStyle: "zhuyan:analyze-reference-style",
  analyzeReferenceFurnishingSet: "zhuyan:analyze-reference-furnishing-set",
  cancelReferenceAnalysis: "zhuyan:cancel-reference-analysis",
  listProjects: "zhuyan:list-projects",
  getProject: "zhuyan:get-project",
  manageProject: "zhuyan:manage-project",
  generateShoppingList: "zhuyan:generate-shopping-list",
  getShoppingList: "zhuyan:get-shopping-list",
  saveShoppingList: "zhuyan:save-shopping-list",
  cancelShoppingList: "zhuyan:cancel-shopping-list",
  openShoppingSearch: "zhuyan:open-shopping-search",
  copyShoppingKeywords: "zhuyan:copy-shopping-keywords",
  startDesign: "zhuyan:start-design",
  startRevision: "zhuyan:start-revision",
  retryVersion: "zhuyan:retry-version",
  cancelRun: "zhuyan:cancel-run",
  downloadVersion: "zhuyan:download-version",
  getProviderSettings: "zhuyan:get-provider-settings",
  testProviderSettings: "zhuyan:test-provider-settings",
  saveProviderSettings: "zhuyan:save-provider-settings",
  clearProviderSettings: "zhuyan:clear-provider-settings",
  runEvent: "zhuyan:run-event",
  referenceAnalysisEvent: "zhuyan:reference-analysis-event",
  shoppingListEvent: "zhuyan:shopping-list-event",
} as const;

function userFacingIpcError(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  while (/^Error:\s*/i.test(message)) message = message.replace(/^Error:\s*/i, "");
  return new Error(message.trim() || "操作失败，请稍后重试");
}

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw userFacingIpcError(error);
  }
}

const api: ZhuyanDesktopApi = {
  selectRoomImage: () => invoke(IPC.selectRoomImage),
  selectReferenceImage: () => invoke(IPC.selectReferenceImage),
  analyzeReferenceStyle: (referenceImageToken, rightsConfirmed) => invoke(IPC.analyzeReferenceStyle, referenceImageToken, rightsConfirmed),
  analyzeReferenceFurnishingSet: (referenceImageToken, rightsConfirmed) => invoke(IPC.analyzeReferenceFurnishingSet, referenceImageToken, rightsConfirmed),
  cancelReferenceAnalysis: () => invoke(IPC.cancelReferenceAnalysis),
  listProjects: (limit, filter) => invoke(IPC.listProjects, limit, filter),
  getProject: (projectId) => invoke(IPC.getProject, projectId),
  manageProject: (projectId, action, title) => invoke(IPC.manageProject, projectId, action, title),
  generateShoppingList: (projectId, versionId, replaceExisting) => invoke(IPC.generateShoppingList, projectId, versionId, replaceExisting),
  getShoppingList: (projectId, versionId) => invoke(IPC.getShoppingList, projectId, versionId),
  saveShoppingList: (shoppingList) => invoke(IPC.saveShoppingList, shoppingList),
  cancelShoppingList: () => invoke(IPC.cancelShoppingList),
  openShoppingSearch: (projectId, versionId, itemId, platform, mode) => invoke(IPC.openShoppingSearch, projectId, versionId, itemId, platform, mode),
  copyShoppingKeywords: (projectId, versionId, itemId, mode) => invoke(IPC.copyShoppingKeywords, projectId, versionId, itemId, mode),
  startDesign: (input) => invoke(IPC.startDesign, input),
  startRevision: (input) => invoke(IPC.startRevision, input),
  retryVersion: (projectId, failedVersionId) => invoke(IPC.retryVersion, projectId, failedVersionId),
  cancelRun: (runId) => invoke(IPC.cancelRun, runId),
  downloadVersion: (projectId, versionId) => invoke(IPC.downloadVersion, projectId, versionId),
  getProviderSettings: () => invoke(IPC.getProviderSettings),
  testProviderSettings: (input) => invoke(IPC.testProviderSettings, input),
  saveProviderSettings: (input) => invoke(IPC.saveProviderSettings, input),
  clearProviderSettings: () => invoke(IPC.clearProviderSettings),
  onReferenceAnalysisEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: ReferenceAnalysisEvent) => listener(payload);
    ipcRenderer.on(IPC.referenceAnalysisEvent, handler);
    return () => ipcRenderer.removeListener(IPC.referenceAnalysisEvent, handler);
  },
  onShoppingListEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: ShoppingListEvent) => listener(payload);
    ipcRenderer.on(IPC.shoppingListEvent, handler);
    return () => ipcRenderer.removeListener(IPC.shoppingListEvent, handler);
  },
  onRunEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: RunEvent) => listener(payload);
    ipcRenderer.on(IPC.runEvent, handler);
    return () => ipcRenderer.removeListener(IPC.runEvent, handler);
  },
};

contextBridge.exposeInMainWorld("zhuyan", Object.freeze(api));
