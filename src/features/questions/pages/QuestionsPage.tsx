import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  getCatalogueQuestions,
  getReponseQuestion,
  type QuestionCatalogue,
  type ReponseQuestion,
} from "../services/questionService";

// Catalogue fixe de questions, chacune répondue par une requête déterministe côté serveur (voir
// server/routes/questionsReponses.ts) — aucun appel à un modèle de langage, donc aucun coût
// d'utilisation. Une question libre appuyée sur une IA générative pourra être ajoutée plus tard,
// sans remettre en cause ce catalogue qui restera la version "sans coût" de la fonctionnalité.
export default function QuestionsPage() {
  const [catalogue, setCatalogue] = useState<QuestionCatalogue[]>([]);
  const [chargementCatalogue, setChargementCatalogue] = useState(true);
  const [cleSelectionnee, setCleSelectionnee] = useState<string | null>(null);
  const [reponse, setReponse] = useState<ReponseQuestion | null>(null);
  const [chargementReponse, setChargementReponse] = useState(false);

  useEffect(() => {
    getCatalogueQuestions()
      .then(setCatalogue)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setChargementCatalogue(false));
  }, []);

  function poserQuestion(cle: string) {
    setCleSelectionnee(cle);
    setReponse(null);
    setChargementReponse(true);
    getReponseQuestion(cle)
      .then(setReponse)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setChargementReponse(false));
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>💬 Questions / Réponses</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Choisis une question dans la liste — la réponse est calculée directement à partir de tes
        données (recettes, ventes, stock, commandes), sans intelligence artificielle.
      </p>

      {chargementCatalogue && <p style={{ color: "#666" }}>Chargement…</p>}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div
          style={{
            background: "white",
            borderRadius: 10,
            padding: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            minWidth: 280,
            flex: "1 1 280px",
          }}
        >
          {catalogue.map((q) => (
            <button
              key={q.cle}
              onClick={() => poserQuestion(q.cle)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 12,
                marginBottom: 8,
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                background: cleSelectionnee === q.cle ? "#16a085" : "#f2f2f2",
                color: cleSelectionnee === q.cle ? "white" : "inherit",
              }}
            >
              {q.question}
            </button>
          ))}
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 10,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            minWidth: 280,
            flex: "2 1 400px",
          }}
        >
          {!cleSelectionnee && <p style={{ color: "#999" }}>Sélectionne une question à gauche.</p>}
          {chargementReponse && <p style={{ color: "#666" }}>Calcul en cours…</p>}
          {reponse && !chargementReponse && (
            <>
              <h3 style={{ marginTop: 0 }}>{reponse.question}</h3>
              <p style={{ fontSize: 16 }}>{reponse.reponse}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
