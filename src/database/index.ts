// Export database connection and utilities
export { DatabaseConnection } from './DatabaseConnection';
export { Collections } from './Collections';

import { DatabaseConnection } from './DatabaseConnection';
import { Collections } from './Collections';

export class DatabaseManager {
    private connection: DatabaseConnection;
    private collections: Collections | null = null;

    constructor(connectionString: string, databaseName: string) {
        this.connection = new DatabaseConnection(connectionString, databaseName);
    }

    async initialize(): Promise<Collections> {
        await this.connection.connect();
        const db = this.connection.getDatabase();

        this.collections = new Collections(db);
        await this.collections.ensureCollectionsExist();
        await this.collections.initializeCollections();

        return this.collections;
    }

    async disconnect(): Promise<void> {
        await this.connection.disconnect();
        this.collections = null;
    }

    getCollections(): Collections {
        if (!this.collections) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.collections;
    }

    isConnected(): boolean {
        return this.connection.isConnected();
    }
}