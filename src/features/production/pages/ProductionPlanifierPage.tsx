import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ChampNombre from "../../../common/ChampNombre";
import { getDepots } from "../../depots/services/depotService";
import { getRecetteDetail } from "../../recettes/services/recetteService";
import { planifierProduction, proposerAchat } from "../services/productionService";
import type { BesoinAchat, CibleProduction, LigneAchat, PlanificationProduction, PropositionAchat } from "../types/production";
import type { Depot } from "../../depots/types/depot";
import { creerCommandes } from "../../commandes/services/commandeService";
import type { Commande } from "../../commandes/types/commande";

// Écran « PRODUIRE » pour une recette précise : planifie les quantités réellement nécessaires
// (stock déduit), puis génère une proposition d'achat au conditionnement fournisseur — consomme
// les deux endpoints déjà existants et déjà testés côté serveur (production.ts, achats.ts),
// jamais réimplémentés ici. Voir types/production.ts pour le contrat de composition entre les
// deux (quantiteProduction, jamais besoinNet, transmis à l'achat).
export default function ProductionPlanifierPage() {
  const { recetteId } = useParams<{ recetteId: string }>();
  const id = Number(recetteId);
  const navigate = useNavigate();

  const [recetteNom, setRecetteNom] = useState("");
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState<number | undefined>(undefined);

  const [mode, setMode] = useState<CibleProduction["mode"]>("portions");
  const [cible, setCible] = useState(1);

  const [planification, setPlanification] = useState<PlanificationProduction | null>(null);
  const [chargementPlan, setChargementPlan] = useState(false);
  const [erreurPlan, setErreurPlan] = useState<string | null>(null);

  const [proposition, setProposition] = useState<PropositionAchat | null>(null);
  const [chargementAchat, setChargementAchat] = useState(false);
  const [erreurAchat, setErreurAchat] = useState<string | null>(null);

  const [chargementCommande, setChargementCommande] = useState(false);
  const [commandesEnregistrees, setCommandesEnregistrees] = useState<Commande[] | null>(null);

  useEffect(() => {
    getRecetteDetail(id).then((recette) => {
      setRecetteNom(recette.nom);
      setCible(recette.portions);
    });
    getDepots().then(setDepots);
  }, [id]);

  // Masque la barre latérale à l'impression (voir le <style> ci-dessous) : cette page est un
  // écran dédié, pas un pop-up par-dessus le reste — inutile de rejouer le portail vers <body>
  // utilisé par RecetteDetail, il suffit de cibler la structure fixe de MainLayout.
  useEffect(() => {
    document.body.classList.add("feuille-production-ouverte");
    return () => document.body.classList.remove("feuille-production-ouverte");
  }, []);

  async function lancerPlanification() {
    setChargementPlan(true);
    setErreurPlan(null);
    setProposition(null);
    setErreurAchat(null);
    try {
      // Le champ "Poids fini" se saisit en kg (plus pratique qu'en grammes pour une quantité de
      // production réaliste) mais l'API attend toujours des grammes (voir CibleProduction,
      // server/utils/planifierProduction.ts) — conversion uniquement à cette frontière.
      const valeur = mode === "poidsFiniG" ? cible * 1000 : cible;
      const res = await planifierProduction(id, { mode, valeur }, depotId);
      setPlanification(res);
    } catch (e) {
      setErreurPlan(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setChargementPlan(false);
    }
  }

  function besoinsAchat(): BesoinAchat[] {
    if (!planification) return [];
    return planification.lignes.map((ligne) => ({
      articleId: ligne.articleId,
      quantite: ligne.quantiteProduction,
      facteurUniteRecette: 1,
    }));
  }

  async function genererPropositionAchat() {
    if (!planification) return;
    setChargementAchat(true);
    setErreurAchat(null);
    setCommandesEnregistrees(null);
    try {
      const res = await proposerAchat(besoinsAchat(), depotId);
      setProposition(res);
    } catch (e) {
      setErreurAchat(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setChargementAchat(false);
    }
  }

  // Recalcule toujours côté serveur au moment de l'enregistrement (voir calculerPropositionAchat,
  // jamais la proposition affichée transmise telle quelle) — depotId est ici obligatoire : une
  // commande réelle a toujours un dépôt de destination, contrairement à la prévisualisation.
  async function enregistrerCommande() {
    if (!depotId) {
      toast.error("Choisis un dépôt avant d'enregistrer la commande.");
      return;
    }
    setChargementCommande(true);
    try {
      const commandes = await creerCommandes(besoinsAchat(), depotId);
      if (commandes.length === 0) {
        toast("Rien à commander : le stock couvre déjà tous les besoins.", { icon: "ℹ️" });
      } else {
        toast.success(`${commandes.length} commande(s) enregistrée(s).`);
      }
      setCommandesEnregistrees(commandes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d'enregistrer la commande");
    } finally {
      setChargementCommande(false);
    }
  }

  return (
    <div>
      <style>{`
        @media print {
          body.feuille-production-ouverte aside { display: none !important; }
          body.feuille-production-ouverte main { padding: 0 !important; }
          .feuille-production-sans-impression { display: none !important; }
        }
      `}</style>

      <div className="feuille-production-sans-impression" style={{ marginBottom: 16 }}>
        <Link to="/production">← Retour au choix de la recette</Link>
      </div>

      <h1>🏭 Planifier une production — {recetteNom || "…"}</h1>

      <div
        className="feuille-production-sans-impression"
        style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", margin: "20px 0" }}
      >
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setMode("portions")}
              style={{ fontWeight: mode === "portions" ? "bold" : "normal" }}
            >
              Portions
            </button>
            <button
              type="button"
              onClick={() => setMode("poidsFiniG")}
              style={{ fontWeight: mode === "poidsFiniG" ? "bold" : "normal" }}
            >
              Poids fini (kg)
            </button>
          </div>
          <ChampNombre valeur={cible} onChanger={(n) => setCible(n ?? 0)} style={{ width: 140, padding: 10, boxSizing: "border-box" }} />
        </div>

        <div>
          <div style={{ marginBottom: 4, fontSize: 13, color: "#666" }}>Dépôt (déduction de stock)</div>
          <select
            value={depotId ?? ""}
            onChange={(e) => setDepotId(e.target.value === "" ? undefined : Number(e.target.value))}
            style={{ padding: 10 }}
          >
            <option value="">Aucun (pas de déduction de stock)</option>
            {depots.map((depot) => (
              <option key={depot.id} value={depot.id}>
                {depot.nom}
              </option>
            ))}
          </select>
        </div>

        <button className="btn-primary" onClick={lancerPlanification} disabled={chargementPlan}>
          {chargementPlan ? "Calcul…" : "Planifier"}
        </button>
      </div>

      {erreurPlan && <p style={{ color: "#b3261e" }}>{erreurPlan}</p>}

      {planification && (
        <div className="fiche-technique-impression" style={{ marginBottom: 24 }}>
          <p style={{ color: "#666" }}>
            Cible : {planification.mode === "portions" ? `${planification.portionsCible} portion(s)` : `${(planification.poidsFiniCibleG / 1000).toFixed(2)} kg fini`}
            {" · "}échelle ×{planification.echelle.toFixed(2)}
          </p>

          <h3>Besoins matières</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 0" }}>Ingrédient</th>
                <th style={{ padding: "6px 0" }}>Quantité de production</th>
                <th style={{ padding: "6px 0" }}>Stock disponible</th>
                <th style={{ padding: "6px 0" }}>Besoin net</th>
              </tr>
            </thead>
            <tbody>
              {planification.lignes.map((ligne) => (
                <tr key={ligne.articleId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 0" }}>{ligne.article.nom}</td>
                  <td style={{ padding: "6px 0" }}>
                    {(ligne.quantiteProduction / ligne.unite.facteurBase).toFixed(2)} {ligne.unite.symbole}
                  </td>
                  <td style={{ padding: "6px 0" }}>
                    {(ligne.stockDisponible / ligne.unite.facteurBase).toFixed(2)} {ligne.unite.symbole}
                  </td>
                  <td style={{ padding: "6px 0" }}>
                    {(ligne.besoinNet / ligne.unite.facteurBase).toFixed(2)} {ligne.unite.symbole}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="feuille-production-sans-impression" style={{ marginBottom: 20 }}>
            <button className="btn-primary" onClick={genererPropositionAchat} disabled={chargementAchat}>
              {chargementAchat ? "Calcul…" : "Générer la proposition d'achat"}
            </button>
          </div>

          {erreurAchat && <p style={{ color: "#b3261e" }}>{erreurAchat}</p>}

          {proposition && (
            <>
              <h3>Proposition d'achat</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                    <th style={{ padding: "6px 0" }}>Article</th>
                    <th style={{ padding: "6px 0" }}>Fournisseur</th>
                    <th style={{ padding: "6px 0" }}>À commander</th>
                    <th style={{ padding: "6px 0", textAlign: "right" }}>Coût HT</th>
                  </tr>
                </thead>
                <tbody>
                  {proposition.lignes.map((ligne) => (
                    <LigneAchatRow key={ligne.articleId} ligne={ligne} />
                  ))}
                </tbody>
              </table>
              <div style={{ textAlign: "right", fontWeight: "bold" }}>Total HT : {proposition.totalHT.toFixed(2)} €</div>

              <div className="feuille-production-sans-impression" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button className="btn-primary" onClick={enregistrerCommande} disabled={chargementCommande || !depotId}>
                  {chargementCommande ? "Enregistrement…" : "Enregistrer la commande"}
                </button>
              </div>
              {!depotId && (
                <p className="feuille-production-sans-impression" style={{ textAlign: "right", fontSize: 13, color: "#666" }}>
                  Choisis un dépôt pour pouvoir enregistrer la commande.
                </p>
              )}

              {commandesEnregistrees && commandesEnregistrees.length > 0 && (
                <div className="feuille-production-sans-impression" style={{ marginTop: 12, fontSize: 14 }}>
                  {commandesEnregistrees.map((commande) => (
                    <p key={commande.id} style={{ margin: "4px 0" }}>
                      ✅ Commande #{commande.id} enregistrée chez <strong>{commande.fournisseur.nom}</strong> —{" "}
                      <Link to={`/commandes/${commande.id}`}>voir la commande</Link>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="feuille-production-sans-impression" style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button onClick={() => navigate("/production")}>Fermer</button>
            <button onClick={() => window.print()}>Imprimer la feuille de production</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LigneAchatRow({ ligne }: { ligne: LigneAchat }) {
  if (ligne.statut === "ARTICLE_INTROUVABLE") {
    return (
      <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
        <td style={{ padding: "6px 0" }}>{ligne.article}</td>
        <td colSpan={3} style={{ padding: "6px 0", color: "#b3261e" }}>
          Article introuvable
        </td>
      </tr>
    );
  }

  if (ligne.statut === "FOURNISSEUR_MANQUANT") {
    return (
      <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
        <td style={{ padding: "6px 0" }}>{ligne.article}</td>
        <td colSpan={3} style={{ padding: "6px 0", color: "#b3261e" }}>
          Aucun fournisseur avec tarif actif
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
      <td style={{ padding: "6px 0" }}>{ligne.article}</td>
      <td style={{ padding: "6px 0" }}>{ligne.fournisseur}</td>
      <td style={{ padding: "6px 0" }}>
        {ligne.statut === "STOCK_SUFFISANT"
          ? "Stock suffisant"
          : `${ligne.conditionnements} × ${ligne.conditionnement}`}
      </td>
      <td style={{ padding: "6px 0", textAlign: "right" }}>{ligne.coutCommandeHT.toFixed(2)} €</td>
    </tr>
  );
}
