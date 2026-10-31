import type { CollMap, DocMap, Draft, RequestStatus, ChatMessage, AssistantConfig, AppUser } from '../types';

/** Generic typed repository. A real backend only has to implement these interfaces. */
export interface CollectionRepo<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  create(input: Omit<T, 'id'> & { id?: string }): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
}

export interface DocRepo<T> {
  get(): Promise<T>;
  set(value: T): Promise<T>;
  patch(patch: Partial<T>): Promise<T>;
}

export type Repositories = { [K in keyof CollMap]: CollectionRepo<CollMap[K]> };
export type DocRepositories = { [K in keyof DocMap]: DocRepo<DocMap[K]> };

/** `claimId` identifies the request created for this generation (the server renders it once, whatever the retries). */
export interface RenderInput { photoUri: string; draft: Draft; claimId?: string }
export interface RenderProgress { progress: number; stage: number }
export interface RenderService {
  /** Resolves with the URL of the generated image. */
  render(input: RenderInput, onProgress?: (p: RenderProgress) => void, signal?: { cancelled: boolean }): Promise<{ imageUri: string }>;
}

export interface ChatService {
  reply(args: { messages: ChatMessage[]; config: AssistantConfig }): Promise<string>;
}

export interface AuthService {
  loginAdmin(email: string, password: string): Promise<{ ok: true; user: Pick<AppUser, 'id' | 'name'> } | { ok: false }>;
}

export interface UploadService {
  /** Persists a picked file and returns a durable URI/URL. */
  upload(uri: string, folder: string): Promise<string>;
}

export interface WhatsAppService {
  sendDesign(args: { whatsapp: string; name: string; imageUri: string }): Promise<{ status: RequestStatus }>;
}

export interface Services {
  render: RenderService;
  chat: ChatService;
  auth: AuthService;
  upload: UploadService;
  whatsapp: WhatsAppService;
}
