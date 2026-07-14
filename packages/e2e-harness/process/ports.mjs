import net from 'node:net';

const probe = (host, port) => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', (error) => reject(error));
  server.listen({ host, port, exclusive: true }, () => server.close((error) => (error ? reject(error) : resolve())));
});

export const assertPortsAvailable = async (config) => {
  for (const [name, port] of Object.entries(config.ports)) {
    try {
      await probe(config.host, port);
    } catch {
      throw new Error(`El puerto E2E ${name} (${config.host}:${port}) ya está ocupado. Detén el proceso residual antes de ejecutar ${config.appName}.`);
    }
  }
};

const isListening = (host, port) => new Promise((resolve) => {
  const socket = net.createConnection({ host, port });
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});

export const assertPortsReleased = async (config, attempts = 60) => {
  for (let index = 0; index < attempts; index += 1) {
    const active = [];
    for (const [name, port] of Object.entries(config.ports)) {
      if (await isListening(config.host, port)) active.push(`${name}:${port}`);
    }
    if (active.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const active = [];
  for (const [name, port] of Object.entries(config.ports)) {
    if (await isListening(config.host, port)) active.push(`${name}:${port}`);
  }
  if (active.length > 0) throw new Error(`Quedaron puertos E2E activos para ${config.appName}: ${active.join(', ')}.`);
};
