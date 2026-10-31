import { useState } from "react";
import toast from "react-hot-toast";
import { genererPaireClesSauvegarde, type PaireClesSauvegarde } from "../utils/clesSauvegarde";
import { telechargerFichier } from "../../../common/telechargerFichier";

// Préparation des clés de chiffrement de la sauvegarde hors de Railway (voir
// server/utils/sauvegardeExterne/chiffrement.ts) : fabriquées ici, dans le navigateur — rien n'est
// envoyé au serveur ni conservé par l'application. La clé publique va dans la variable Railway
// SAUVEGARDE_CLE_PUBLIQUE ; la clé privée reste chez le propriétaire, jamais dans Railway.

function ChampCle({ libelle, valeur, testId }: { libelle: string; valeur: string; testId: string }) {
  async function copier() {
    try {
      await navigator.clipboard.writeText(valeur);
      toast.success(`${libelle} copiée.`);
    } catch {
      toast.error("Copie impossible : sélectionne le texte et copie-le à la main.");
    }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{libelle}</div>
      <textarea
        readOnly
        value={valeur}
        data-testid={testId}
        rows={3}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button onClick={copier} style={{ marginTop: 4 }}>
        Copier
      </button>
    </div>
  );
}

export default function GenerateurClesSauvegarde() {
  const [cles, setCles] = useState<PaireClesSauvegarde | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function generer() {
    setEnCours(true);
    try {
      setCles(await genererPaireClesSauvegarde());
    } catch {
      toast.error("Ce navigateur ne sait pas fabriquer ces clés : essaie avec Safari ou Chrome à jour.");
    } finally {
      setEnCours(false);
    }
  }

  function telechargerClePrivee() {
    if (!cles) return;
    const contenu =
      "Clé PRIVÉE de déchiffrement des sauvegardes — Consulting Restauration Pro\n" +
      `Créée le ${new Date().toLocaleString("fr-FR")}\n` +
      "À conserver hors de Railway (gestionnaire de mots de passe, copie papier). Ne jamais la mettre dans Railway.\n\n" +
      `${cles.clePrivee}\n`;
    telechargerFichier("cle-privee-sauvegardes.txt", new Blob([contenu], { type: "text/plain" }));
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #ddd" }}>
      <div style={{ fontWeight: 600 }}>Clés de chiffrement de la sauvegarde hors de Railway</div>
      <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
        Fabriquées dans ce navigateur : rien n'est envoyé au serveur. À faire une seule fois, à la mise en place.
      </p>
      {!cles && (
        <button onClick={generer} disabled={enCours}>
          {enCours ? "Fabrication…" : "Générer une paire de clés"}
        </button>
      )}
      {cles && (
        <>
          <ChampCle libelle="Clé publique" valeur={cles.clePublique} testId="cle-publique" />
          <p style={{ fontSize: 13, marginTop: 0 }}>→ À coller dans la variable Railway <code>SAUVEGARDE_CLE_PUBLIQUE</code>.</p>
          <ChampCle libelle="Clé privée" valeur={cles.clePrivee} testId="cle-privee" />
          <div style={{ background: "#fdecea", color: "#b3261e", padding: 10, borderRadius: 8, fontSize: 13 }}>
            ⚠ La clé privée est la SEULE qui permet de relire les sauvegardes. Garde-la dans ton gestionnaire de mots de
            passe et sur papier, <strong>jamais dans Railway</strong>. Elle disparaît de cet écran dès que tu le quittes.
            Si tu remplaces un jour cette paire de clés, garde aussi l'ancienne clé privée : elle reste la seule à
            pouvoir relire les sauvegardes déjà faites.
            <div style={{ marginTop: 8 }}>
              <button onClick={telechargerClePrivee}>Télécharger la clé privée (.txt)</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
