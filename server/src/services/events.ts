export interface LiveEvent {
  type: string;
  id: string;
}

const clients = new Set<{
  write: (chunk: string) => boolean;
  end: () => void;
}>();

export const getClientCount = (): number => clients.size;

export const addClient = (client: { write: (chunk: string) => boolean; end: () => void }): void => {
  clients.add(client);
};

export const removeClient = (client: { write: (chunk: string) => boolean; end: () => void }): void => {
  clients.delete(client);
};

export const publish = (event: LiveEvent): void => {
  const payload = `data: ${JSON.stringify({ type: event.type, id: event.id })}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
};

export const closeAllClients = (): void => {
  for (const client of clients) {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
  clients.clear();
};
