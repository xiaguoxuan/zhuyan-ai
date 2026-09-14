import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { ProviderConnectionTestInput, ProviderConnectionTestResult, ProviderSettingsInput, ProviderSettingsView } from "../shared/contracts.js";

const SETTINGS_FILE = "provider-settings.json";
const SETTINGS_SCHEMA_VERSION = 1;
const REQUEST_TIMEOUT_MS = 15_000;

function providerApiErrorText(responseText: string): string | undefined {
  try {
    const payload = JSON.parse(responseText) as { error?: unknown };
    if (!payload.error || typeof payload.error !== "object") return undefined;
    const error = payload.error as Record<string, unknown>;
    const details = [error.code, error.type, error.message]
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim());
    return details.length > 0 ? [...new Set(details)].join(" / ").slice(0, 800) : undefined;
  } catch {
    const text = responseText.trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 500) : undefined;
  }
}

function providerConnectionHttpError(status: number, responseText: string): Error {
  const message = providerApiErrorText(responseText) || "";
  const billingSignal = /insufficient[_ -]?(quota|credit|balance|funds)|quota.*exceed|credit|balance|billing|payment.*required|funds|余额|额度|欠费|充值|账单/i.test(message);
  if (status === 402 || billingSignal) {
    return new Error(`Provider 返回 HTTP ${status}：API 余额或可用额度可能不足，请登录 Provider 控制台检查余额、额度上限和账单状态`);
  }
  if (status === 429) return new Error("Provider 返回 HTTP 429：请求过于频繁或服务正在限流，请稍后重试；如果持续出现，也请检查账号额度");
  if (status === 401) return new Error("Provider 返回 HTTP 401：API Key 无效、已失效或未被当前服务接受");
  if (status === 403) return new Error("Provider 返回 HTTP 403：当前 API Key 或账号没有访问该接口的权限");
  return new Error(`Provider 返回 HTTP ${status}`);
}

export type ProviderRuntimeSettings = {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  visionModel: string;
  imageModel: string;
};

type StoredProviderSettings = {
  schemaVersion: 1;
  baseUrl: string;
  visionModel: string;
  imageModel: string;
  encryptedApiKey: string;
  updatedAt: string;
};

export function normalizeProviderBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("API Base URL 不能为空");
  if (value.trim().length > 500) throw new Error("API Base URL 不能超过 500 个字符");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("API Base URL 格式错误");
  }
  if (url.username || url.password) throw new Error("API Base URL 不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("API Base URL 不能包含查询参数或片段");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("API Base URL 必须是 HTTP 或 HTTPS 地址");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function normalizeProviderModel(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  const model = value.trim();
  if (model.length > 100) throw new Error(`${label}不能超过 100 个字符`);
  if (!/^[A-Za-z0-9@][A-Za-z0-9._:/@+-]{0,99}$/.test(model)) throw new Error(`${label}只能包含字母、数字、点、下划线、斜杠、冒号、@、加号和连字符`);
  return model;
}

function normalizeApiKey(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("API Key 不能为空");
    return undefined;
  }
  if (typeof value !== "string") throw new Error("API Key 格式错误");
  const key = value.trim();
  if (!key) {
    if (required) throw new Error("API Key 不能为空");
    return undefined;
  }
  if (key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error("API Key 格式错误");
  return key;
}

function providerIdFor(baseUrl: string): string {
  return `zhuyan-byok-${createHash("sha256").update(baseUrl).digest("hex").slice(0, 12)}`;
}

function parseStored(value: unknown): StoredProviderSettings {
  if (!value || typeof value !== "object") throw new Error("Provider 设置文件格式错误");
  const stored = value as Partial<StoredProviderSettings>;
  if (stored.schemaVersion !== SETTINGS_SCHEMA_VERSION) throw new Error("Provider 设置版本不受支持");
  if (typeof stored.encryptedApiKey !== "string" || !stored.encryptedApiKey) throw new Error("Provider 加密凭据缺失");
  return {
    schemaVersion: 1,
    baseUrl: normalizeProviderBaseUrl(stored.baseUrl),
    visionModel: normalizeProviderModel(stored.visionModel, "视觉分析模型"),
    imageModel: normalizeProviderModel(stored.imageModel, "图片生成模型"),
    encryptedApiKey: stored.encryptedApiKey,
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : new Date(0).toISOString(),
  };
}

function publicView(stored: StoredProviderSettings): ProviderSettingsView {
  return {
    configured: true,
    source: "byok",
    baseUrl: stored.baseUrl,
    visionModel: stored.visionModel,
    imageModel: stored.imageModel,
    hasApiKey: true,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    runtimeReady: true,
    error: null,
    updatedAt: stored.updatedAt,
  };
}

export class ProviderSettingsStore {
  private readonly filePath: string;

  constructor(private readonly userDataPath: string) {
    this.filePath = path.join(userDataPath, SETTINGS_FILE);
  }

  private async readStored(): Promise<StoredProviderSettings | null> {
    try {
      return parseStored(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const backupPath = `${this.filePath}.bak`;
      try {
        const recovered = parseStored(JSON.parse(await readFile(backupPath, "utf8")) as unknown);
        await rename(backupPath, this.filePath).catch(() => {});
        return recovered;
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw backupError;
      }
    }
  }

  async getView(developmentFallback: boolean): Promise<ProviderSettingsView> {
    const stored = await this.readStored();
    if (stored) return publicView(stored);
    return {
      configured: false,
      source: developmentFallback ? "development_fallback" : "unconfigured",
      baseUrl: null,
      visionModel: developmentFallback ? "gpt-5.6-sol" : "",
      imageModel: developmentFallback ? "gpt-image-2" : "",
      hasApiKey: false,
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      runtimeReady: developmentFallback,
      error: null,
      updatedAt: null,
    };
  }

  async loadRuntime(): Promise<ProviderRuntimeSettings | null> {
    const stored = await this.readStored();
    if (!stored) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储当前不可用，无法解密 Provider API Key");
    let apiKey: string;
    try {
      apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    } catch {
      throw new Error("Provider API Key 无法由当前系统用户解密，请清除后重新配置");
    }
    if (!apiKey) throw new Error("Provider API Key 为空，请重新配置");
    return {
      providerId: providerIdFor(stored.baseUrl),
      baseUrl: stored.baseUrl,
      apiKey,
      visionModel: stored.visionModel,
      imageModel: stored.imageModel,
    };
  }

  async resolveInput(input: ProviderSettingsInput | ProviderConnectionTestInput): Promise<ProviderRuntimeSettings> {
    if (!input || typeof input !== "object") throw new Error("Provider 设置格式错误");
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
    const visionModel = normalizeProviderModel(input.visionModel, "视觉分析模型");
    const imageModel = normalizeProviderModel(input.imageModel, "图片生成模型");
    const suppliedKey = normalizeApiKey(input.apiKey, false);
    const existing = suppliedKey ? null : await this.loadRuntime();
    if (!suppliedKey && existing && existing.baseUrl !== baseUrl) throw new Error("更换 API Base URL 时必须重新输入 API Key");
    const apiKey = suppliedKey || existing?.apiKey;
    if (!apiKey) throw new Error("请输入 API Key");
    return { providerId: providerIdFor(baseUrl), baseUrl, apiKey, visionModel, imageModel };
  }

  async save(input: ProviderSettingsInput): Promise<{ view: ProviderSettingsView; runtime: ProviderRuntimeSettings }> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储当前不可用，已拒绝以明文保存 API Key");
    const runtime = await this.resolveInput(input);
    const stored: StoredProviderSettings = {
      schemaVersion: 1,
      baseUrl: runtime.baseUrl,
      visionModel: runtime.visionModel,
      imageModel: runtime.imageModel,
      encryptedApiKey: safeStorage.encryptString(runtime.apiKey).toString("base64"),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(this.userDataPath, { recursive: true });
    const nonce = `${process.pid}.${Date.now()}`;
    const temporaryPath = `${this.filePath}.${nonce}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    let backedUp = false;
    try {
      await unlink(backupPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      try {
        await rename(this.filePath, backupPath);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporaryPath, this.filePath);
      if (backedUp) await unlink(backupPath).catch(() => {});
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      if (backedUp) await rename(backupPath, this.filePath).catch(() => {});
      throw error;
    }
    return { view: publicView(stored), runtime };
  }

  async clear(): Promise<void> {
    await Promise.all([this.filePath, `${this.filePath}.bak`].map(async (file) => {
      await unlink(file).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }));
  }
}

export async function testProviderConnection(runtime: ProviderRuntimeSettings, signal?: AbortSignal): Promise<ProviderConnectionTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Provider 连接测试超时")), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abortFromParent();
    else signal.addEventListener("abort", abortFromParent, { once: true });
  }
  try {
    const response = await fetch(`${runtime.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 2_000_000) throw new Error("Provider 模型列表响应超过安全限制");
    const responseText = await response.text();
    if (responseText.length > 2_000_000) throw new Error("Provider 模型列表响应超过安全限制");
    if (!response.ok) throw providerConnectionHttpError(response.status, responseText);
    let payload: unknown;
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      throw new Error("Provider /models 返回了无法解析的响应");
    }
    const data = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : null;
    if (!data) throw new Error("Provider /models 未返回可识别的模型数组");
    const ids = new Set(data.map((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : "").filter(Boolean));
    const visionModelFound = ids.has(runtime.visionModel);
    const imageModelFound = ids.has(runtime.imageModel);
    const missing = [!visionModelFound ? "视觉分析模型" : "", !imageModelFound ? "图片生成模型" : ""].filter(Boolean);
    return {
      ok: true,
      message: missing.length > 0
        ? `连接成功，但模型列表中未找到${missing.join("和")}；部分兼容服务不会在 /models 返回图片模型。`
        : "连接成功，已在模型列表中找到视觉分析模型和图片生成模型。",
      modelsEndpointSupported: true,
      visionModelFound,
      imageModelFound,
      availableModelCount: ids.size,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Provider 连接测试已取消或超时");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}
