import { PubSub, ApolloError } from "apollo-server";

const closeEvents = new PubSub();
let connectionsMap: Record<string, string | undefined> = {};
let connectingAttempts: Record<string, Promise<void> | undefined> = {};

export const getPort = (connectionId: string): string => {
  const port = connectionsMap[connectionId];

  if (!port) {
    throw new ApolloError("Connection is not active");
  }

  return port;
};

export const isOpen = (connectionId: string): boolean =>
  !!connectionsMap[connectionId];

export const connectLock = async (
  port: string,
  connectFunction: () => Promise<void>
): Promise<void> => {
  if (connectingAttempts[port]) {
    return connectingAttempts[port];
  }

  const connectPromise = connectFunction();
  connectingAttempts[port] = connectPromise;

  return connectPromise.finally(() => {
    if (connectingAttempts[port] === connectPromise) {
      connectingAttempts[port] = undefined;
    }
  });
};

export const add = (port: string, connnectionId: string): void => {
  connectionsMap[connnectionId] = port;
};

export const remove = (port: string): void => {
  Object.entries(connectionsMap).forEach(([connectionId, connectionPort]) => {
    if (port === connectionPort) {
      closeEvents.publish(connectionId, connectionId);
      connectionsMap[connectionId] = undefined;
    }
  });
};

export const onClosed = (connectionId: string): AsyncIterator<string> => {
  return closeEvents.asyncIterator<string>(connectionId);
};

export const reset = (): void => {
  connectionsMap = {};
  connectingAttempts = {};
};
