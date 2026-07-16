/**
 * $lib/meta.js — single source of truth for app data.
 * Reads apps/*.yml at build time; used by all server routes + the meta.json endpoint.
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

//  Minimal YAML parser 
// Handles: flat scalars, block sequences (- item), and literal block scalars (|)

/** @param {string} src */
function parseYaml(src) {
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    /** @type {Record<string, any>} */
    const obj = {};
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '' || line.trimStart().startsWith('#')) { i++; continue; }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) { i++; continue; }

        const key = line.slice(0, colonIdx).trim();
        let valueInline = line.slice(colonIdx + 1).trim();

        // Strip inline comments (# preceded by whitespace)
        const cmtIdx = valueInline.search(/ \#/);
        if (cmtIdx !== -1) valueInline = valueInline.slice(0, cmtIdx).trimEnd();

        //  Literal / folded block scalar: `key: |` or `key: |-` or `key: >` 
        if (valueInline === '|' || valueInline === '|-' || valueInline === '>' || valueInline === '>-') {
            const chomp = valueInline.endsWith('-'); // strip final newline
            i++;
            const blockLines = [];
            // Detect indentation from first non-empty line
            let baseIndent = -1;
            while (i < lines.length) {
                const bl = lines[i];
                // Empty line inside block
                if (bl.trim() === '') {
                    blockLines.push('');
                    i++;
                    continue;
                }
                const indent = bl.match(/^(\s*)/)?.[1]?.length ?? 0;
                if (baseIndent === -1) baseIndent = indent;
                // Block ends when indentation returns to same or lower level
                if (indent < baseIndent) break;
                blockLines.push(bl.slice(baseIndent));
                i++;
            }
            // Trim trailing empty lines for chomp (-) variants
            if (chomp) while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
            obj[key] = blockLines.join('\n');
            continue;
        }

        //  Empty value: could be a block sequence 
        if (valueInline === '') {
            const items = [];
            i++;
            while (i < lines.length) {
                const next = lines[i];
                if (next.trim() === '') { i++; continue; }
                if (!next.startsWith(' ') && !next.startsWith('\t')) break;
                const stripped = next.trimStart();
                if (stripped.startsWith('- ')) {
                    items.push(stripped.slice(2).trim());
                    i++;
                } else { i++; }
            }
            obj[key] = items;
            continue;
        }

        //  Scalar value 
        let val = valueInline;
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        obj[key] = key === 'id' && /^\d+$/.test(val) ? Number(val) : val;
        i++;
    }
    return obj;
}

//  Field allow-list 
const FIELDS = [
    'id', 'slug', 'name', 'author',
    'description', 'longDescription',
    'image', 'screenshots',
    'downloadUrl', 'detailsUrl',
    'position', 'format', 'tags',
    'website', 'contact', 'privacy',
    'rating', 'ratingCount', 'downloads',
];

/** @returns {Record<string, any>[]} */
export function loadApps() {
    const dirs = ['apps', 'python'];
    /** @type {Record<string, any>[]} */
    let allApps = [];

    for (const dirName of dirs) {
        const dirPath = resolve(dirName);
        let files = [];
        try {
            files = readdirSync(dirPath)
                .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
                .sort();
        } catch { continue; }

        const apps = files.map((file) => {
            const raw = readFileSync(join(dirPath, file), 'utf-8');
            const parsed = parseYaml(raw);
            /** @type {Record<string, any>} */
            const entry = {};
            for (const field of FIELDS) {
                const val = parsed[field];
                if (val === undefined || val === '') continue;
                if (Array.isArray(val) && val.length === 0) continue;
                entry[field] = val;
            }
            return entry;
        });
        allApps = allApps.concat(apps);
    }

    allApps.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return allApps;
}

const DEV_FIELDS = ['name', 'headline', 'featuredApp'];

/** @returns {Record<string, any>[]} */
export function loadDevs() {
    const devsDir = resolve('devs');
    let files = [];
    try {
        files = readdirSync(devsDir)
            .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
            .sort();
    } catch {
        // devs directory might not exist yet
        return [];
    }

    const devs = files.map((file) => {
        const raw = readFileSync(join(devsDir, file), 'utf-8');
        const parsed = parseYaml(raw);
        /** @type {Record<string, any>} */
        const entry = {};
        // Use filename base as dev id/slug
        entry.id = file.replace(/\.ya?ml$/, '');
        for (const field of DEV_FIELDS) {
            const val = parsed[field];
            if (val === undefined || val === '') continue;
            entry[field] = val;
        }
        return entry;
    });

    return devs;
}
