import { useState } from "react";
import { modifierIdentifiants } from "../../auth/services/authService";

export default function IdentifiantsSection() {
  const [codeActuel, setCodeActuel] = useState("");
  const [nouvelIdentifiant, setNouvelIdentifiant] = useState("");
  const [nouveauCode, setNouveauCode] = useState("");
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  async function enregistrer() {
    setErreur("");
    setMessage("");

    if (!codeActuel || !nouvelIdentifiant.trim() || !nouveauCode) {
      setErreur("Tous les champs sont requis");
      return;
    }

    try {
      await modifierIdentifiants(codeActuel, nouvelIdentifiant.trim(), nouveauCode);
      setMessage("Identifiants modifiés avec succès");
      setCodeActuel("");
      setNouvelIdentifiant("");
      setNouveauCode("");
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 400 }}>
      <label>
        Code actuel
        <input
          type="password"
          value={codeActuel}
          onChange={(e) => setCodeActuel(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      <label>
        Nouvel identifiant
        <input
          type="text"
          value={nouvelIdentifiant}
          onChange={(e) => setNouvelIdentifiant(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      <label>
        Nouveau code
        <input
          type="password"
          value={nouveauCode}
          onChange={(e) => setNouveauCode(e.target.value)}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      {erreur && <p style={{ color: "#c0392b", margin: 0 }}>{erreur}</p>}
      {message && <p style={{ color: "#16a085", margin: 0 }}>{message}</p>}

      <button onClick={enregistrer} style={{ alignSelf: "flex-start", padding: "8px 16px" }}>
        Enregistrer
      </button>
    </div>
  );
}
