import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const envPath = ".env";
const outputPath = "public/env.js";

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index === -1) return [line, ""];
        const key = line.slice(0, index).trim();
        const rawValue = line.slice(index + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

const source = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
const env = parseEnv(source);

await mkdir("public", { recursive: true });
await writeFile(
  outputPath,
  `window.NOVELCHAIN_ENV = ${JSON.stringify(
    {
      SUPABASE_URL: process.env.SUPABASE_URL || env.SUPABASE_URL || "",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "",
    },
    null,
    2,
  )};\n`,
);

console.log(`Wrote ${outputPath}`);
