import test from "node:test";
import assert from "node:assert/strict";
import app from "../../server/app.js";

test("GET /health répond sans base de données", async () => {
  const server = app.listen(0, "127.0.0.1");

  // Sous le test runner de Node, server.address() peut encore être null juste après l'appel à
  // listen() (la liaison du socket n'est pas garantie synchrone ici) : on attend l'évènement
  // "listening" plutôt que de lire l'adresse immédiatement, pour ne pas fermer un serveur qui
  // n'a pas fini de démarrer.
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      application: "Consulting Restauration Pro",
      version: "1.0.0",
      status: "OK",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
