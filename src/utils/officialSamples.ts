/** Fetch official samples from the svg3dx GitHub repo. */

import { mimeForAssetPath } from "@/utils/documentAssets";
import {
  bytesToBlob,
  isSvg3dxzFileName,
  openSvg3dxzBytes,
  packageDisplayName,
} from "@/utils/svg3dxz";

const SAMPLES_API =
  "https://api.github.com/repos/xiaohunqupo/svg3dx/contents/samples?ref=main";

/** Document base for relative `s3dx:gltf` hrefs in official samples. */
export const OFFICIAL_SAMPLES_BASE_URL =
  "https://raw.githubusercontent.com/xiaohunqupo/svg3dx/main/samples/";

const PREFERRED_SAMPLE = "draft-0.1-example.svg3dx";

type GithubContentEntry = {
  name: string;
  type: string;
  download_url: string | null;
};

export type OfficialSampleAsset = {
  path: string;
  blob: Blob;
};

export type OfficialSample = {
  name: string;
  content: string;
  documentBaseUrl?: string;
  /** Sidecars unpacked from `.svg3dxz` (no base URL needed). */
  packageAssets?: OfficialSampleAsset[];
};

function isSampleFile(entry: GithubContentEntry): boolean {
  return (
    entry.type === "file" &&
    !!entry.download_url &&
    /\.(svg3dx|svg|svg3dxz)$/i.test(entry.name)
  );
}

/** Prefer `.svg3dxz` when both the loose doc and the package exist. */
function preferPackageOverLoose(
  entries: GithubContentEntry[]
): GithubContentEntry[] {
  const names = new Set(entries.map((e) => e.name));
  return entries.filter((e) => {
    if (!/\.(svg3dx|svg)$/i.test(e.name)) return true;
    const pkg = e.name.replace(/\.(svg3dx|svg)$/i, ".svg3dxz");
    return !names.has(pkg);
  });
}

function sortSamples(a: OfficialSample, b: OfficialSample): number {
  if (a.name === PREFERRED_SAMPLE) return -1;
  if (b.name === PREFERRED_SAMPLE) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * Loose `.svg3dx` / `.svg` names superseded by a fetched `.svg3dxz` package
 * (same stem) — remove from the studio list after sample refresh.
 */
export function supersededLooseNames(samples: OfficialSample[]): string[] {
  const out: string[] = [];
  for (const s of samples) {
    if (!/\.svg3dxz$/i.test(s.name)) continue;
    const stem = s.name.replace(/\.svg3dxz$/i, "");
    out.push(`${stem}.svg3dx`, `${stem}.svg`);
  }
  return out;
}

/** List and download all sample documents under `samples/` on main. */
export async function fetchOfficialSamples(): Promise<OfficialSample[]> {
  const listRes = await fetch(SAMPLES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!listRes.ok) {
    throw new Error(`Official samples list failed (${listRes.status})`);
  }

  const entries = (await listRes.json()) as GithubContentEntry[];
  if (!Array.isArray(entries)) {
    throw new Error("Official samples directory response invalid");
  }

  const files = preferPackageOverLoose(entries.filter(isSampleFile));
  if (!files.length) {
    throw new Error("Official samples directory empty");
  }

  const samples = await Promise.all(
    files.map(async (file) => {
      const res = await fetch(file.download_url!);
      if (!res.ok) {
        throw new Error(`Download ${file.name} failed (${res.status})`);
      }
      if (isSvg3dxzFileName(file.name)) {
        const opened = await openSvg3dxzBytes(await res.arrayBuffer());
        return {
          name: packageDisplayName(file.name),
          content: opened.mainXml,
          // No documentBaseUrl — assets are embedded in the package (may be empty).
          packageAssets: opened.assets.map((a) => ({
            path: a.path,
            blob: bytesToBlob(a.bytes, mimeForAssetPath(a.path)),
          })),
        } satisfies OfficialSample;
      }
      return {
        name: file.name,
        content: await res.text(),
        documentBaseUrl: OFFICIAL_SAMPLES_BASE_URL,
      } satisfies OfficialSample;
    })
  );

  return samples.sort(sortSamples);
}

export function preferredSampleName(samples: OfficialSample[]): string {
  return (
    samples.find((s) => s.name === PREFERRED_SAMPLE)?.name ?? samples[0]?.name ?? ""
  );
}
