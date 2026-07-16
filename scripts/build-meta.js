#!/usr/bin/env node
/**
 * build-meta.js
 * Reads all YAML app files from the /apps directory and assembles meta.json.
 *
 * Compatible with: Node.js >= 18, Bun, Deno (with --allow-read --allow-write)
 *
 * Usage:
 *   node scripts/build-meta.js
 *   bun scripts/build-meta.js
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the simple flat key: value + list structure
// used in our app files. No external dependencies needed.
// ---------------------------------------------------------------------------

/** Parse a YAML string into a plain JS object (subset parser). */
function parseYaml(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    const obj = {};
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Skip blank / comment lines at this level
        if (line.trim() === "" || line.trimStart().startsWith("#")) {
            i++;
            continue;
        }

        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) { i++; continue; }

        const key = line.slice(0, colonIdx).trim();
        const afterColon = line.slice(colonIdx + 1);
        let valueInline = afterColon.trim();

        // Strip inline comments (# preceded by whitespace)
        const cmtIdx = valueInline.search(/ \#/);
        if (cmtIdx !== -1) valueInline = valueInline.slice(0, cmtIdx).trimEnd();

        if (valueInline === "") {
            // Could be a block sequence — collect list items on following lines
            // indented with "  - "
            const items = [];
            i++;
            while (i < lines.length) {
                const nextLine = lines[i];
                if (nextLine.trim() === "") { i++; continue; }
                if (!nextLine.startsWith(" ") && !nextLine.startsWith("\t")) break;
                const stripped = nextLine.trimStart();
                if (stripped.startsWith("- ")) {
                    items.push(stripped.slice(2).trim());
                    i++;
                } else {
                    // Nested mapping — not needed for our schema, skip
                    i++;
                }
            }
            obj[key] = items;
        } else {
            // Scalar value
            let val = valueInline;

            // Strip surrounding quotes
            if ((val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }

            // Coerce numeric strings to numbers for known numeric fields
            if (key === "id" && /^\d+$/.test(val)) {
                obj[key] = Number(val);
            } else {
                obj[key] = val;
            }
            i++;
        }
    }

    return obj;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const appsDir = join(repoRoot, "apps");
const outFile = join(repoRoot, "meta.json");

async function main() {
    let entries;
    try {
        entries = await readdir(appsDir);
    } catch {
        console.error(`[build-meta] Error: apps directory not found at ${appsDir}`);
        process.exit(1);
    }

    const ymlFiles = entries
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .sort(); // alphabetical — deterministic order

    if (ymlFiles.length === 0) {
        console.warn("[build-meta] Warning: no .yml files found in /apps");
    }

    const apps = [];

    for (const file of ymlFiles) {
        const filePath = join(appsDir, file);
        const raw = await readFile(filePath, "utf8");
        let parsed;
        try {
            parsed = parseYaml(raw);
        } catch (err) {
            console.error(`[build-meta] Failed to parse ${file}: ${err.message}`);
            process.exit(1);
        }

        // Build a clean entry — slug IS included (needed by build-site.js for p/<slug>.html)
        const entry = {};

        const FIELDS = ["id", "slug", "name", "author", "description", "image", "screenshots",
            "downloadUrl", "detailsUrl", "position", "format", "tags"];

        for (const field of FIELDS) {
            const val = parsed[field];
            // Omit undefined, empty strings, and empty arrays
            if (val === undefined || val === "") continue;
            if (Array.isArray(val) && val.length === 0) continue;
            entry[field] = val;
        }

        apps.push(entry);
        console.log(`[build-meta] ✓ ${file}  →  ${parsed.name || file}`);
    }

    // Sort by `id` so the output is always in a stable, predictable order
    apps.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const json = JSON.stringify(apps, null, 4) + "\n";
    await writeFile(outFile, json, "utf8");
    console.log(`\n[build-meta] Wrote ${apps.length} apps to ${outFile}`);
}

main();
