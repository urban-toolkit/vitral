import { build } from "esbuild";

/**
 * Bundle one evaluation script for plain node.
 *
 * The other `test:*` scripts call esbuild straight from `package.json`, and this one cannot: the
 * harness imports the product's client code, which reads `import.meta.env` at module scope, and
 * defining a JSON object through a shell argument is quoting roulette on Windows. Two lines of
 * config here beats a script line nobody can safely edit.
 *
 * `import.meta.env` is replaced wholesale rather than key by key, so a `VITE_*` flag added to the
 * app later resolves to `undefined` and takes its own default instead of crashing the harness.
 *
 * Usage: node eval/build.mjs <runBenchmark|report>
 */

const TARGETS = {
    runBenchmark: "node_modules/.cache/evalRun.mjs",
    report: "node_modules/.cache/evalReport.mjs",
    runCrossLink: "node_modules/.cache/evalCrossLink.mjs",
};

const name = process.argv[2];
const outfile = TARGETS[name];
if (!outfile) {
    console.error(`Unknown target "${name}". Expected one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
}

await build({
    entryPoints: [`eval/${name}.ts`],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    alias: { "@": "./src" },
    logLevel: "warning",
    define: {
        "import.meta.env": JSON.stringify({
            // Where the backend lives. The harness talks to it directly rather than through the Vite
            // proxy, so this is an absolute URL and not the app's `/api`.
            VITE_BACKEND_URL: process.env.VITRAL_API_BASE ?? "http://localhost:3000/api",
            BASE_URL: "/",
            NODE_ENV: "production",
        }),
    },
});
