import { registerExcalidashImportRoutes } from "./excalidashImportRoutes.js";
import { registerExcalidashExportRoute } from "./exportRoutes.js";
import { registerLegacySqliteImportRoutes } from "./legacySqliteImportRoutes.js";
import { RegisterImportExportDeps } from "./shared.js";

export const registerImportExportRoutes = (deps: RegisterImportExportDeps) => {
  registerExcalidashExportRoute(deps);
  registerExcalidashImportRoutes(deps);
  registerLegacySqliteImportRoutes(deps);
};

export type { RegisterImportExportDeps } from "./shared.js";
