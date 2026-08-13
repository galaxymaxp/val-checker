import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
const result = spawnSync(process.execPath, [executable, "start", ...process.argv.slice(2)], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

function redactDiagnostic(value) {
  return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[redacted-api-key]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[redacted]@")
    .split(/\r?\n/)
    .map((line) =>
      /(?:authorization|anon key|service_role key|jwt secret|secret key|encrypted_jar)/i.test(line)
        ? "[credential-bearing line redacted]"
        : line,
    )
    .filter(Boolean)
    .slice(-40)
    .join("\n");
}

if (result.status === 0) {
  console.log("Supabase local stack started. Credentials were intentionally redacted.");
  process.exit(0);
}

const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (/docker (?:desktop|daemon).*(?:unavailable|not running|not found)|cannot connect to the docker daemon/i.test(diagnostic)) {
  console.error("Supabase local stack could not start because Docker is unavailable.");
} else {
  console.error("Supabase local stack could not start:");
  console.error(redactDiagnostic(diagnostic));
}

process.exit(result.status ?? 1);
