import { MongoClient, Db, MongoClientOptions } from 'mongodb';

export class DatabaseConnection {
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private connectionString: string;
    private databaseName: string;
    private maxRetries: number;
    private retryDelay: number;

    constructor(
        connectionString: string,
        databaseName: string,
        maxRetries: number = 5,
        retryDelay: number = 2000
    ) {
        this.connectionString = connectionString;
        this.databaseName = databaseName;
        this.maxRetries = maxRetries;
        this.retryDelay = retryDelay;
    }

    async connect(): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`Attempting to connect to MongoDB (attempt ${attempt}/${this.maxRetries})`);

                const options: MongoClientOptions = {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 10000,
                    socketTimeoutMS: 45000,
                };

                this.client = new MongoClient(this.connectionString, options);
                await this.client.connect();

                // Test the connection
                await this.client.db(this.databaseName).admin().ping();

                this.db = this.client.db(this.databaseName);
                console.log(`Successfully connected to MongoDB database: ${this.databaseName}`);
                return;
            } catch (error) {
                lastError = error as Error;
                console.error(`Connection attempt ${attempt} failed:`, error);

                if (attempt < this.maxRetries) {
                    console.log(`Retrying in ${this.retryDelay}ms...`);
                    await this.delay(this.retryDelay);
                }
            }
        }

        throw new Error(`Failed to connect to MongoDB after ${this.maxRetries} attempts. Last error: ${lastError?.message}`);
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
            console.log('Disconnected from MongoDB');
        }
    }

    getDatabase(): Db {
        if (!this.db) {
            throw new Error('Database connection not established. Call connect() first.');
        }
        return this.db;
    }

    isConnected(): boolean {
        return this.client !== null && this.db !== null;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}