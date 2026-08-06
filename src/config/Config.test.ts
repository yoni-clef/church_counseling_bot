import { Config, validateConfig } from './Config';

describe('Config', () => {
    beforeEach(() => {
        // Reset the singleton instance
        (Config as any).instance = undefined;
        // Reset environment variables
        delete process.env.BOT_TOKEN;
        delete process.env.MONGODB_URI;
    });

    it('should load configuration from environment variables', () => {
        process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789';
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';

        const config = Config.getInstance();

        expect(config.botToken).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789');
        expect(config.mongodbUri).toBe('mongodb://localhost:27017/test');
    });

    it('should throw error for missing required environment variables', () => {
        expect(() => Config.getInstance()).toThrow('Required environment variable BOT_TOKEN is not set');
    });

    it('should validate bot token format', () => {
        const config = {
            botToken: 'invalid-token',
            mongodbUri: 'mongodb://localhost:27017/test',
            mongodbDbName: 'test',
            nodeEnv: 'test',
            port: 3000,
            sessionRetentionDays: 90,
            cleanupIntervalHours: 24,
            reportSuspendThreshold: 3,
            reportRevokeThreshold: 5,
            adminChatIds: [],
            logLevel: 'info'
        };

        expect(() => validateConfig(config)).toThrow('Invalid BOT_TOKEN format');
    });
});