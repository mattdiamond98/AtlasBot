const REPO_OWNER = "Atlas-Conquest-Game";
const REPO_NAME = "atlas-conquest-website";
const BRANCH = "main";
const FOLDER = "CardScreenshots";
const CONTENTS_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FOLDER}?ref=${BRANCH}`;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const CACHE_TTL_MS = 60 * 60 * 1000;

export type CardEntry = {
  name: string;
  filename: string;
  imageUrl: string;
  normalized: string;
};

type GitHubContentItem = {
  name: string;
  download_url: string | null;
  type: string;
};

let cache: { entries: CardEntry[]; loadedAt: number } | null = null;
let inflight: Promise<CardEntry[]> | null = null;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function displayNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/-/g, " ");
}

async function fetchCatalog(): Promise<CardEntry[]> {
  const res = await fetch(CONTENTS_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  const items = (await res.json()) as GitHubContentItem[];
  return items
    .filter(
      (i) =>
        i.type === "file" &&
        i.download_url &&
        IMAGE_EXTENSIONS.some((ext) => i.name.toLowerCase().endsWith(ext)),
    )
    .map((i) => {
      const name = displayNameFromFilename(i.name);
      return {
        name,
        filename: i.name,
        imageUrl: i.download_url as string,
        normalized: normalize(name),
      };
    });
}

async function loadCatalog(forceRefresh = false): Promise<CardEntry[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cache &&
    now - cache.loadedAt < CACHE_TTL_MS
  ) {
    return cache.entries;
  }
  if (inflight) return inflight;
  inflight = fetchCatalog()
    .then((entries) => {
      cache = { entries, loadedAt: Date.now() };
      return entries;
    })
    .finally(() => {
      inflight = null;
    });
  try {
    return await inflight;
  } catch (err) {
    if (cache) return cache.entries;
    throw err;
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = i;
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
      prev[j] = cur;
    }
  }
  return prev[b.length];
}

function scoreEntry(entry: CardEntry, normQuery: string): number {
  if (!normQuery) return 1000;
  if (entry.normalized === normQuery) return 0;
  if (entry.normalized.startsWith(normQuery)) return 1;
  if (entry.normalized.includes(normQuery)) return 2;
  const dist = levenshtein(entry.normalized, normQuery);
  if (dist <= Math.max(2, Math.floor(normQuery.length / 3))) return 3 + dist;
  return 1000;
}

export async function searchCards(
  query: string,
  limit: number,
): Promise<CardEntry[]> {
  const entries = await loadCatalog();
  const normQuery = normalize(query);
  if (!normQuery) {
    return entries.slice(0, limit);
  }
  return entries
    .map((e) => ({ e, s: scoreEntry(e, normQuery) }))
    .filter((x) => x.s < 1000)
    .sort((a, b) => a.s - b.s || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

export async function findCardByName(name: string): Promise<CardEntry | null> {
  const entries = await loadCatalog();
  const normQuery = normalize(name);
  return entries.find((e) => e.normalized === normQuery) ?? null;
}

export async function refreshCatalog(): Promise<number> {
  const entries = await loadCatalog(true);
  return entries.length;
}
