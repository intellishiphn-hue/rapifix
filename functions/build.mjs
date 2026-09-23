// Empaqueta las Functions con esbuild. El código de packages/shared se incluye
// dentro del bundle, así Cloud Build no necesita resolver el workspace.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "lib/index.js",
  sourcemap: true,
  external: ["firebase-admin", "firebase-functions"],
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
