import { useState } from "react";
import type { FormEvent } from "react";
import { seConnecter } from "../services/authService";

export default function LoginPage({ onConnexion }: { onConnexion: () => void }) {
  const [identifiant, setIdentifiant] = useState("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function valider(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    setEnCours(true);
    try {
      await seConnecter(identifiant.trim(), code);
      onConnexion();
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#202729",
      }}
    >
      <form
        onSubmit={valider}
        style={{
          background: "white",
          borderRadius: 10,
          padding: 32,
          width: 320,
          boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        }}
      >
        <h2 style={{ marginTop: 0, textAlign: "center" }}>🍽 Consulting Restauration Pro</h2>

        <label style={{ display: "block", marginBottom: 12 }}>
          Identifiant
          <input
            type="text"
            value={identifiant}
            onChange={(e) => setIdentifiant(e.target.value)}
            autoFocus
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 16 }}>
          Code
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>

        {erreur && <p style={{ color: "#c0392b", marginTop: 0 }}>{erreur}</p>}

        <button
          type="submit"
          disabled={enCours || !identifiant.trim() || !code}
          style={{
            width: "100%",
            padding: 10,
            background: "#16a085",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {enCours ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
