-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "authEnabled" BOOLEAN NOT NULL DEFAULT false,
    "authOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "registrationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "oidcJitProvisioningEnabled" BOOLEAN,
    "authLoginRateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "authLoginRateLimitWindowMs" INTEGER NOT NULL DEFAULT 900000,
    "authLoginRateLimitMax" INTEGER NOT NULL DEFAULT 20,
    "adminFullAccess" BOOLEAN NOT NULL DEFAULT false,
    "bootstrapSetupCodeHash" TEXT,
    "bootstrapSetupCodeIssuedAt" DATETIME,
    "bootstrapSetupCodeExpiresAt" DATETIME,
    "bootstrapSetupCodeFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemConfig" ("authEnabled", "authLoginRateLimitEnabled", "authLoginRateLimitMax", "authLoginRateLimitWindowMs", "authOnboardingCompleted", "bootstrapSetupCodeExpiresAt", "bootstrapSetupCodeFailedAttempts", "bootstrapSetupCodeHash", "bootstrapSetupCodeIssuedAt", "createdAt", "id", "oidcJitProvisioningEnabled", "registrationEnabled", "updatedAt") SELECT "authEnabled", "authLoginRateLimitEnabled", "authLoginRateLimitMax", "authLoginRateLimitWindowMs", "authOnboardingCompleted", "bootstrapSetupCodeExpiresAt", "bootstrapSetupCodeFailedAttempts", "bootstrapSetupCodeHash", "bootstrapSetupCodeIssuedAt", "createdAt", "id", "oidcJitProvisioningEnabled", "registrationEnabled", "updatedAt" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
