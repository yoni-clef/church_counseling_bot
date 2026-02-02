import { AppConfig } from './Config';

export function validateConfig(config: AppConfig): void {
    // Validate bot token format (should be a valid Telegram bot token)
    if (!config.botToken.match(/^\d+:[A-Za-z0-9_-]{35}$/)) {
        throw new Error('Invalid BOT_TOKEN format. Expected format: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789');
    }

    // Validate MongoDB URI format
    if (!config.mongodbUri.startsWith('mongodb://') && !config.mongodbUri.startsWith('mongodb+srv://')) {
        throw new Error('Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://');
    }

    // Validate port range
    if (config.port < 1 || config.port > 65535) {
        throw new Error('PORT must be between 1 and 65535');
    }

    // Validate session retention days
    if (config.sessionRetentionDays < 1) {
        throw new Error('SESSION_RETENTION_DAYS must be at least 1');
    }

    // Validate cleanup interval
    if (config.cleanupIntervalHours < 1) {
        throw new Error('CLEANUP_INTERVAL_HOURS must be at least 1');
    }

    // Validate report thresholds
    if (config.reportSuspendThreshold < 1) {
        throw new Error('REPORT_SUSPEND_THRESHOLD must be at least 1');
    }

    if (config.reportRevokeThreshold < config.reportSuspendThreshold) {
        throw new Error('REPORT_REVOKE_THRESHOLD must be greater than or equal to REPORT_SUSPEND_THRESHOLD');
    }

    // Validate admin chat IDs
    for (const chatId of config.adminChatIds) {
        if (!Number.isInteger(chatId) || chatId === 0) {
            throw new Error('All ADMIN_CHAT_IDS must be valid non-zero integers');
        }
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(config.logLevel)) {
        throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }
}