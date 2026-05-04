import pino from "pino";

const isProduction =
  (process.env.NODE_ENV || "development") === "production";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  ...(isProduction
    ? {
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }),
});
