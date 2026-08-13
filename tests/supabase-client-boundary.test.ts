import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(absolute);
    return sourceExtensions.includes(path.extname(entry.name)) ? [absolute] : [];
  });
}

function importedSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }

  return [...specifiers];
}

function resolveLocalImport(from: string, specifier: string): string | undefined {
  const unresolved = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : undefined;

  if (!unresolved) return undefined;

  for (const candidate of [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) => path.join(unresolved, `index${extension}`)),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  return undefined;
}

function dependencyClosure(entry: string): string[] {
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;

    visited.add(current);
    const source = fs.readFileSync(current, "utf8");

    for (const specifier of importedSpecifiers(source)) {
      const resolved = resolveLocalImport(current, specifier);
      if (resolved) pending.push(resolved);
    }
  }

  return [...visited];
}

describe("Supabase client boundaries", () => {
  const productionFiles = [path.join(root, "app"), path.join(root, "src")].flatMap(sourceFiles);

  it("keeps elevated keys inside server-prefixed modules and API routes", () => {
    const violations = productionFiles
      .filter((file) => /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).replaceAll("\\", "/"))
      .filter(
        (file) =>
          !file.startsWith("app/api/") && !file.startsWith("src/lib/supabase/server"),
      );

    expect(violations).toEqual([]);
  });

  it("makes elevated clients unreachable from every client component import graph", () => {
    const clientEntries = productionFiles.filter((file) =>
      /^\s*["']use client["'];?/.test(fs.readFileSync(file, "utf8")),
    );
    const violations = clientEntries.flatMap((entry) =>
      dependencyClosure(entry)
        .filter((file) => {
          const relative = path.relative(root, file).replaceAll("\\", "/");
          const source = fs.readFileSync(file, "utf8");

          return (
            relative.startsWith("src/lib/supabase/server") ||
            /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/.test(source)
          );
        })
        .map((file) => ({
          client: path.relative(root, entry).replaceAll("\\", "/"),
          serverOnlyDependency: path.relative(root, file).replaceAll("\\", "/"),
        })),
    );

    expect(violations).toEqual([]);
  });
});
