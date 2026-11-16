/** Fetch official samples from the svg3dx GitHub repo. */

const SAMPLES_API =
  "https://api.github.com/repos/xiaohunqupo/svg3dx/contents/samples?ref=main";

const PREFERRED_SAMPLE = "draft-0.1-example.svg3dx";

type GithubContentEntry = {
  name: string;
  type: string;
  download_url: string | null;
};

export type OfficialSample = {
  name: string;
  content: string;
};

function isSampleFile(entry: GithubContentEntry): boolean {
  return (
    entry.type === "file" &&
    !!entry.download_url &&
    /\.(svg3dx|svg)$/i.test(entry.name)
  );
}

function sortSamples(a: OfficialSample, b: OfficialSample): number {
  if (a.name === PREFERRED_SAMPLE) return -1;
  if (b.name === PREFERRED_SAMPLE) return 1;
  return a.name.localeCompare(b.name);
}

/** List and download all `.svg3dx` / `.svg` files under `samples/` on main. */
export async function fetchOfficialSamples(): Promise<OfficialSample[]> {
  const listRes = await fetch(SAMPLES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!listRes.ok) {
    throw new Error(`列出官方示例失败 (${listRes.status})`);
  }

  const entries = (await listRes.json()) as GithubContentEntry[];
  if (!Array.isArray(entries)) {
    throw new Error("官方示例目录响应无效");
  }

  const files = entries.filter(isSampleFile);
  if (!files.length) {
    throw new Error("官方示例目录为空");
  }

  const samples = await Promise.all(
    files.map(async (file) => {
      const res = await fetch(file.download_url!);
      if (!res.ok) {
        throw new Error(`下载 ${file.name} 失败 (${res.status})`);
      }
      return { name: file.name, content: await res.text() };
    })
  );

  return samples.sort(sortSamples);
}

export function preferredSampleName(samples: OfficialSample[]): string {
  return (
    samples.find((s) => s.name === PREFERRED_SAMPLE)?.name ?? samples[0]?.name ?? ""
  );
}
