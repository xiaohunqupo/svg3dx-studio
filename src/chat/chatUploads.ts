/**
 * Stage chat attachments for `import_file({ uploadId })`.
 * CopilotKit's onUpload registers here; the tool consumes by id.
 */

import { createFileId } from "@/repos/ids";
import { isSvg3dxzFileName } from "@/utils/svg3dxz";

export type ChatUploadKind = "svg3dx" | "svg3dxz" | "other";

export type ChatUploadRecord = {
  uploadId: string;
  name: string;
  kind: ChatUploadKind;
  mime: string;
  size: number;
  bytes: ArrayBuffer;
  createdAt: number;
};

const uploads = new Map<string, ChatUploadRecord>();

function kindForName(name: string): ChatUploadKind {
  if (isSvg3dxzFileName(name)) return "svg3dxz";
  if (/\.(svg3dx|svg)$/i.test(name)) return "svg3dx";
  return "other";
}

export function listChatUploads(): Omit<ChatUploadRecord, "bytes">[] {
  return [...uploads.values()].map(({ bytes: _bytes, ...meta }) => meta);
}

export function getChatUpload(uploadId: string): ChatUploadRecord | undefined {
  return uploads.get(uploadId);
}

/** Register a File and return metadata (bytes kept in memory until consumed/cleared). */
export async function registerChatUpload(
  file: File
): Promise<Omit<ChatUploadRecord, "bytes">> {
  const uploadId = createFileId();
  const bytes = await file.arrayBuffer();
  const record: ChatUploadRecord = {
    uploadId,
    name: file.name,
    kind: kindForName(file.name),
    mime: file.type || "application/octet-stream",
    size: file.size,
    bytes,
    createdAt: Date.now(),
  };
  uploads.set(uploadId, record);
  const { bytes: _bytes, ...meta } = record;
  return meta;
}

/** Take and remove an upload (one-shot import). */
export function consumeChatUpload(
  uploadId: string
): ChatUploadRecord | undefined {
  const record = uploads.get(uploadId);
  if (!record) return undefined;
  uploads.delete(uploadId);
  return record;
}

export function clearChatUploads(): void {
  uploads.clear();
}
