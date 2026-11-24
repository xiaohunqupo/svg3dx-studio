/** Collect unique `id` values from `<s3dx:point id="…">` in document XML. */
export function collectPointIds(content: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /<s3dx:point\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const attrs = m[1] ?? "";
    const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const id = (idM?.[1] ?? idM?.[2] ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
