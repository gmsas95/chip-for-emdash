export interface ProviderConnection {
  pluginId: string;
  basePath: string;
  eventPath: string;
  capabilities: string[];
  sharedSecret: string;
  keyId?: string;
}

export interface ProviderRegistry {
  register(connection: ProviderConnection): void;
  unregister(pluginId: string): void;
  get(pluginId: string): ProviderConnection | undefined;
  require(pluginId: string, capability: string): ProviderConnection;
  list(): ProviderConnection[];
}

function cloneConnection(connection: ProviderConnection): ProviderConnection {
  return { ...connection, capabilities: [...connection.capabilities] };
}

function validateConnection(connection: ProviderConnection): void {
  if (connection.pluginId.length === 0 || connection.sharedSecret.length === 0) {
    throw new Error("Invalid provider connection");
  }
}

export function createProviderRegistry(initial: ProviderConnection[] = []): ProviderRegistry {
  const connections = new Map<string, ProviderConnection>();
  const registry: ProviderRegistry = {
    register(connection) {
      validateConnection(connection);
      connections.set(connection.pluginId, cloneConnection(connection));
    },
    unregister(pluginId) {
      connections.delete(pluginId);
    },
    get(pluginId) {
      const connection = connections.get(pluginId);
      return connection === undefined ? undefined : cloneConnection(connection);
    },
    require(pluginId, capability) {
      const connection = connections.get(pluginId);
      if (!connection || !connection.capabilities.includes(capability)) {
        throw new Error(`Provider ${pluginId} does not support ${capability}`);
      }
      return cloneConnection(connection);
    },
    list() {
      return [...connections.values()].map(cloneConnection);
    },
  };
  for (const connection of initial) {
    registry.register(connection);
  }
  return registry;
}
