import { registerExcalidashImportRoutes } from "./excalidashImportRoutes.js";
import { registerExcalidashExportRoute } from "./exportRoutes.js";
import { RegisterImportExportDeps } from "./shared.js";

export const registerImportExportRoutes = (deps: RegisterImportExportDeps) => {
  registerExcalidashExportRoute(deps);
  registerExcalidashImportRoutes(deps);
};

export type { RegisterImportExportDeps } from "./shared.js";
