import { Config, validateConfig } from './config';
import { BotHandler } from './components/BotHandler';

async function main() {
    try {
        // Load and validate configuration
        const config = Config.getInstance();
        validateConfig(config);

        console.log('Starting Telegram Counseling Bot...');
        console.log(`Environment: ${config.nodeEnv}`);
        console.log(`Database: ${config.mongodbDbName}`);

        // Initialize bot handler
        const botHandler = new BotHandler(config);
        await botHandler.initialize();

        console.log('Bot started successfully!');

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('Shutting down bot...');
            await botHandler.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('Shutting down bot...');
            await botHandler.shutdown();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the application
if (require.main === module) {
    main().catch(console.error);
}