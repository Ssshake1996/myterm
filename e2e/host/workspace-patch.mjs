// Headless hosts have no Documents directory. This user patch tells the
// workspace controller where to create deepseek-harness/default-workspace.
export function workspacePatch(documentsDirectory) {
  if (typeof documentsDirectory !== "string" || !documentsDirectory.startsWith("/")) {
    throw new Error(`documentsDirectory must be an absolute path, got ${documentsDirectory}`);
  }
  const escaped = documentsDirectory.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `- id: workspace-controller\n  config:\n    documentsDirectory: "${escaped}"\n`;
}
