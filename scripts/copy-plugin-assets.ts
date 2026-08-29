import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const plugin of ["suite-de-agentes", "task-manager"]) {
  const src = path.join(root, "plugins", plugin);
  const dest = path.join(root, "dist", "plugins", plugin);
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (sourcePath) => {
      const relative = path.relative(src, sourcePath);
      if (relative.split(path.sep).includes("node_modules")) return false;
      return true;
    },
  });
}
