import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import type { RoleUtilisateur } from "../../../config/api";
import {
  creerUtilisateur,
  getUtilisateurs,
  modifierUtilisateur,
  reinitialiserCode,
  type Utilisateur,
} from "../services/utilisateursService";

const ROLES: { valeur: RoleUtilisateur; label: string }[] = [
  { valeur: "PROPRIETAIRE", label: "Propriétaire" },
  { valeur: "CHEF", label: "Chef de cuisine" },
  { valeur: "CUISINIER", label: "Cuisinier" },
  { valeur: "CONSULTANT", label: "Consultant (lecture seule)" },
];

export default function ComptesManager() {
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[]>([]);
  const [nouvelIdentifiant, setNouvelIdentifiant] = useState("");
  const [nouveauCode, setNouveauCode] = useState("");
  const [nouveauRole, setNouveauRole] = useState<RoleUtilisateur>("CUISINIER");

  function charger() {
    getUtilisateurs().then(setUtilisateurs).catch((error) => toast.error(error.message));
  }

  useEffect(() => {
    charger();
  }, []);

  async function ajouter() {
    if (!nouvelIdentifiant.trim() || nouveauCode.length < 6) {
      toast.error("Identifiant requis et code d'au moins 6 caractères");
      return;
    }
    try {
      await creerUtilisateur(nouvelIdentifiant.trim(), nouveauCode, nouveauRole);
      setNouvelIdentifiant("");
      setNouveauCode("");
      setNouveauRole("CUISINIER");
      charger();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function changerRole(utilisateur: Utilisateur, role: RoleUtilisateur) {
    try {
      await modifierUtilisateur(utilisateur.id, { role });
      charger();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function basculerActif(utilisateur: Utilisateur) {
    try {
      await modifierUtilisateur(utilisateur.id, { actif: !utilisateur.actif });
      charger();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function reinitialiser(utilisateur: Utilisateur) {
    const nouveauCodeSaisi = prompt(`Nouveau code pour "${utilisateur.identifiant}" (6 caractères min.)`);
    if (!nouveauCodeSaisi) return;
    if (nouveauCodeSaisi.length < 6) {
      toast.error("Le nouveau code doit faire au moins 6 caractères");
      return;
    }
    try {
      await reinitialiserCode(utilisateur.id, nouveauCodeSaisi);
      toast.success(`Code de "${utilisateur.identifiant}" réinitialisé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: 0, fontSize: 13 }}>
        Un compte par personne : le rôle borne ce que chacun peut modifier (Propriétaire = accès
        total, Chef = recettes/HACCP/production/achats, Cuisinier = production et contrôles HACCP
        uniquement, Consultant = lecture seule).
      </p>

      {utilisateurs.map((utilisateur) => (
        <div
          key={utilisateur.id}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}
        >
          <span style={{ flex: 2, minWidth: 0, opacity: utilisateur.actif ? 1 : 0.5 }}>
            {utilisateur.identifiant}
            {!utilisateur.actif && " (désactivé)"}
          </span>
          <select
            value={utilisateur.role}
            onChange={(e) => changerRole(utilisateur, e.target.value as RoleUtilisateur)}
            style={{ width: 200, padding: 8 }}
          >
            {ROLES.map((r) => (
              <option key={r.valeur} value={r.valeur}>
                {r.label}
              </option>
            ))}
          </select>
          <button onClick={() => reinitialiser(utilisateur)}>Réinitialiser le code</button>
          <button
            className={utilisateur.actif ? "btn-danger" : "btn-primary"}
            onClick={() => basculerActif(utilisateur)}
          >
            {utilisateur.actif ? "Désactiver" : "Réactiver"}
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          id="nouveau-compte-identifiant"
          type="text"
          placeholder="Identifiant"
          value={nouvelIdentifiant}
          onChange={(e) => setNouvelIdentifiant(e.target.value)}
          style={{ flex: 2, minWidth: 0, padding: 8 }}
        />
        <input
          id="nouveau-compte-code"
          type="password"
          placeholder="Code (6 caractères min.)"
          value={nouveauCode}
          onChange={(e) => setNouveauCode(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: 8 }}
        />
        <select
          id="nouveau-compte-role"
          value={nouveauRole}
          onChange={(e) => setNouveauRole(e.target.value as RoleUtilisateur)}
          style={{ width: 200, padding: 8 }}
        >
          {ROLES.map((r) => (
            <option key={r.valeur} value={r.valeur}>
              {r.label}
            </option>
          ))}
        </select>
        <button id="nouveau-compte-ajouter" className="btn-primary" onClick={ajouter}>
          Ajouter
        </button>
      </div>
    </div>
  );
}
