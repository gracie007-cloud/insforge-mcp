import Redis, { Cluster } from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  tls: boolean;
  cluster: boolean;
}

/**
 * Get Redis configuration from environment variables
 */
export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    tls: process.env.REDIS_TLS === 'true',
    cluster: process.env.REDIS_CLUSTER === 'true',
  };
}

/**
 * Create a Redis client based on configuration
 * Supports both standalone and cluster mode with optional TLS
 */
export function createRedisClient(config?: RedisConfig): Redis | Cluster {
  const redisConfig = config || getRedisConfig();
  const { host, port, tls, cluster } = redisConfig;

  const tlsOptions = tls ? { tls: {} } : {};

  if (cluster) {
    // Cluster mode (for AWS ElastiCache Serverless, etc.)
    return new Redis.Cluster(
      [{ host, port }],
      {
        redisOptions: {
          ...tlsOptions,
        },
        dnsLookup: (address, callback) => callback(null, address),
        slotsRefreshTimeout: 2000,
        enableReadyCheck: true,
      }
    );
  } else {
    // Standalone mode (local development)
    return new Redis({
      host,
      port,
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
    });
  }
}

// Singleton instance
let redisClient: Redis | Cluster | null = null;

/**
 * Get or create the singleton Redis client
 */
export function getRedisClient(): Redis | Cluster {
  if (!redisClient) {
    redisClient = createRedisClient();

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Ready to accept commands');
    });
  }
  return redisClient;
}

/**
 * Close the Redis connection gracefully
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('[Redis] Connection closed');
  }
}
