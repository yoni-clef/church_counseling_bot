import dotenv from 'dotenv';
import { LogLevel } from '../utils/logger';
import { validateConfig } from './validation';

// Load environment variables
dotenv.config();

export interface AppConfig {
    botToken: string;
    mongodbUri: string;
    mongodbDbName: string;
    nodeEnv: string;
    port: number;
    sessionRetentionDays: number;
    cleanupIntervalHours: number;
    reportSuspendThreshold: number;
    reportRevokeThreshold: number;
    adminChatIds: number[];
    logLevel: LogLevel;
}

export class Config {
    private static instance: AppConfig;

    public static getInstance(): AppConfig {
        if (!Config.instance) {
            Config.instance = Config.loadConfig();
        }
        return Config.instance;
    }

    private static loadConfig(): AppConfig {
        const requiredEnvVars = ['BOT_TOKEN', 'MONGODB_URI'];

        for (const envVar of requiredEnvVars) {
            if (!process.env[envVar]) {
                throw new Error(`Required environment variable ${envVar} is not set`);
            }
        }

        const dbNameFromUri = (() => {
            try {
                const url = new URL(process.env.MONGODB_URI!);
                const name = url.pathname?.replace(/^\//, '');
                return name || undefined;
            } catch {
                return undefined;
            }
        })();

        const rawDbName = process.env.MONGODB_DB_NAME;
        const normalizedDbName = rawDbName?.includes('/')
            ? rawDbName.split('/').pop()
            : rawDbName;

        const config: AppConfig = {
            botToken: process.env.BOT_TOKEN!,
            mongodbUri: process.env.MONGODB_URI!,
            mongodbDbName: normalizedDbName || dbNameFromUri || 'telegram-counseling-bot',
            nodeEnv: process.env.NODE_ENV || 'development',
            port: parseInt(process.env.PORT || '3000', 10),
            sessionRetentionDays: parseInt(process.env.SESSION_RETENTION_DAYS || '90', 10),
            cleanupIntervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10),
            reportSuspendThreshold: parseInt(process.env.REPORT_SUSPEND_THRESHOLD || '3', 10),
            reportRevokeThreshold: parseInt(process.env.REPORT_REVOKE_THRESHOLD || '5', 10),
            adminChatIds: process.env.ADMIN_CHAT_IDS
                ? process.env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim(), 10))
                : [],
            logLevel: (process.env.LOG_LEVEL || 'info') as LogLevel
        };

        validateConfig(config);
        return config;
    }
}

// Re-export validateConfig for convenience
export { validateConfig };