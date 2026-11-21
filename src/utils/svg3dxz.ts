/**
 * Thin host wrapper around svg3dx-core WASM package I/O.
 */

type WasmPkg = {
  default?: (module_or_path?: unknown) => Promise<unknown>;
  openSvg3dxz: (data: Uint8Array | number[]) => PackageHandle;
  Svg3dxPackageBuilder: new (main_xml: string) => PackageBuilder;
};

type PackageHandle = {
  mainXml: string;
  assetPaths(): string[];
  assetBytes(path: string): Uint8Array | undefined;
  free(): void;
};

type PackageBuilder = {
  setAsset(path: string, data: Uint8Array | number[]): void;
  write(): Uint8Array;
  free(): void;
};

let pkg: WasmPkg | null = null;
let initPromise: Promise<void> | null = null;

async function ensureWasm(): Promise<WasmPkg> {
  if (pkg) return pkg;
  if (!initPromise) {
    initPromise = (async () => {
      const loaded = (await import("svg3dx-ffi-wasm")) as unknown as WasmPkg;
      if (typeof loaded.default === "function") {
        await loaded.default();
      }
      pkg = loaded;
    })();
  }
  await initPromise;
  return pkg!;
}

export type OpenedSvg3dxz = {
  mainXml: string;
  assets: { path: string; bytes: Uint8Array }[];
};

export function isSvg3dxzFileName(name: string): boolean {
  return /\.svg3dxz$/i.test(name);
}

export async function openSvg3dxzBytes(
  data: ArrayBuffer | Uint8Array
): Promise<OpenedSvg3dxz> {
  const wasm = await ensureWasm();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const handle = wasm.openSvg3dxz(bytes);
  try {
    const assets: OpenedSvg3dxz["assets"] = [];
    for (const path of handle.assetPaths()) {
      const asset = handle.assetBytes(path);
      if (asset) assets.push({ path, bytes: asset.slice() });
    }
    return { mainXml: handle.mainXml, assets };
  } finally {
    handle.free();
  }
}

export async function writeSvg3dxzBytes(
  mainXml: string,
  assets: { path: string; bytes: Uint8Array | ArrayBuffer | Blob }[]
): Promise<Uint8Array> {
  const wasm = await ensureWasm();
  const builder = new wasm.Svg3dxPackageBuilder(mainXml);
  try {
    for (const asset of assets) {
      let bytes: Uint8Array;
      if (asset.bytes instanceof Uint8Array) {
        bytes = asset.bytes;
      } else if (asset.bytes instanceof ArrayBuffer) {
        bytes = new Uint8Array(asset.bytes);
      } else {
        bytes = new Uint8Array(await asset.bytes.arrayBuffer());
      }
      builder.setAsset(asset.path, bytes);
    }
    return builder.write();
  } finally {
    builder.free();
  }
}

/**
 * Studio list name for an opened package. Keep `.svg3dxz` so it does not collide
 * with a sibling loose `.svg3dx` of the same stem (which has no embedded assets).
 */
export function packageDisplayName(fileName: string): string {
  return fileName.replace(/^.*[/\\]/, "") || "package.svg3dxz";
}

export function packageDownloadName(fileName: string): string {
  if (/\.svg3dxz$/i.test(fileName)) return fileName;
  if (/\.svg3dx$/i.test(fileName)) return fileName.replace(/\.svg3dx$/i, ".svg3dxz");
  if (/\.svg$/i.test(fileName)) return fileName.replace(/\.svg$/i, ".svg3dxz");
  return `${fileName}.svg3dxz`;
}

/** Copy bytes into a Blob-friendly ArrayBuffer view (avoids SharedArrayBuffer typing). */
export function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mime });
}
