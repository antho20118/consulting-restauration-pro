import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ChampNombre from "../../../common/ChampNombre";
import { getDepots } from "../../depots/services/depotService";
import { getEvaluationHACCP, getRecetteDetail } from "../../recettes/services/recetteService";
import type { EtapeEvalueeHACCP, Recette } from "../../recettes/types/recette";
import { planifierProduction, proposerAchat } from "../services/productionService";
import type { BesoinAchat, CibleProduction, LigneAchat, PlanificationProduction, PropositionAchat } from "../types/production";
import type { Depot } from "../../depots/types/depot";
import { creerCommandes } from "../../commandes/services/commandeService";
import type { Commande } from "../../commandes/types/commande";
import { getProduction } from "../../productions/services/productionService";
import type { ProductionDetail } from "../../productions/types/production";
import {
  ajouterControleSurProductionLocale,
  enregistrerProductionResiliente,
  type ControleSaisi,
} from "../../../offline/actionsProduction";
import { busFileAttente } from "../../../offline/fileAttenteDb";
import { EVENEMENT_PRODUCTION_SYNCHRONISEE } from "../../../offline/synchronisation";

type BrouillonControle = { valeur: string; conforme: boolean; commentaire: string };
const BROUILLON_VIDE: BrouillonControle = { valeur: "", conforme: true, commentaire: "" };

// Une étape critique recomposée CÔTÉ CLIENT, sans endpoint dédié : identique à
// etapesCritiquesDeLaRecette (server/routes/productions.ts) — pointCritiqueHACCP déclaré par
// l'utilisateur OU règle détectée automatiquement (voir evaluerEtapesHACCP) — mais calculée ici à
// partir de deux appels déjà nécessaires sur cette page (la recette, son évaluation HACCP) pour ne
// JAMAIS dépendre d'un id de production réel : une production mise en file hors ligne n'en a pas
// encore, et c'est justement le cas que ça doit couvrir.
type EtapeCritiqueLocale = {
  id: number;
  description: string;
  controleHACCP: string | null;
  reglesDetectees: EtapeEvalueeHACCP["reglesDetectees"];
};

function etapesCritiquesLocales(recette: Recette | null, evaluation: EtapeEvalueeHACCP[]): EtapeCritiqueLocale[] {
  if (!recette) return [];
  const evaluationParId = new Map(evaluation.map((e) => [e.id, e]));
  return recette.etapes
    .filter((etape) => etape.pointCritiqueHACCP || (evaluationParId.get(etape.id)?.reglesDetectees.length ?? 0) > 0)
    .map((etape) => ({
      id: etape.id,
      description: etape.description,
      controleHACCP: etape.controleHACCP,
      reglesDetectees: evaluationParId.get(etape.id)?.reglesDetectees ?? [],
    }));
}

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
  const [recette, setRecette] = useState<Recette | null>(null);
  const [evaluationHaccp, setEvaluationHaccp] = useState<EtapeEvalueeHACCP[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState<number | undefined>(undefined);

  const [mode, setMode] = useState<CibleProduction["mode"]>("portions");
  const [cible, setCible] = useState(1);

  const [planification, setPlanification] = useState<PlanificationProduction | null>(null);
  const [chargementPlan, setChargementPlan] = useState(false);
  const [erreurPlan, setErreurPlan] = useState<string | null>(null);
  // Le calcul des besoins matières (planifierProduction) a besoin du stock en temps réel —
  // impossible hors ligne, contrairement à l'enregistrement de la production lui-même (voir
  // enregistrerLaProduction, qui ne lit jamais `planification`) : débloque donc l'enregistrement
  // et la saisie HACCP sans le tableau de besoins ni la proposition d'achat, qui eux restent
  // indisponibles tant que le réseau n'est pas revenu.
  const [planificationIndisponibleHorsLigne, setPlanificationIndisponibleHorsLigne] = useState(false);

  const [proposition, setProposition] = useState<PropositionAchat | null>(null);
  const [chargementAchat, setChargementAchat] = useState(false);
  const [erreurAchat, setErreurAchat] = useState<string | null>(null);

  const [chargementCommande, setChargementCommande] = useState(false);
  const [commandesEnregistrees, setCommandesEnregistrees] = useState<Commande[] | null>(null);

  const [chargementProduction, setChargementProduction] = useState(false);
  const [productionEnregistree, setProductionEnregistree] = useState<ProductionDetail | null>(null);
  // Non nul quand la production a été mise en file d'attente hors ligne (voir
  // enregistrerProductionResiliente) plutôt que réellement créée : aucun id réel n'existe encore,
  // donc aucun lien vers /productions/:id n'est possible tant qu'elle n'est pas synchronisée — les
  // contrôles HACCP saisis dans l'intervalle sont mis en file contre CET idLocal (voir
  // ajouterControleSurProductionLocale) plutôt que contre un id de production qui n'existe pas
  // encore côté serveur.
  const [idLocalProductionEnAttente, setIdLocalProductionEnAttente] = useState<string | null>(null);
  const [brouillonsLocaux, setBrouillonsLocaux] = useState<Record<number, BrouillonControle>>({});
  const [controlesLocauxEnAttente, setControlesLocauxEnAttente] = useState<
    { idLocal: string; etapeId: number; valeur: string; conforme: boolean; commentaire: string | null }[]
  >([]);

  useEffect(() => {
    getRecetteDetail(id)
      .then((r) => {
        setRecette(r);
        setRecetteNom(r.nom);
        setCible(r.portions);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"));
    getEvaluationHACCP(id)
      .then((res) => setEvaluationHaccp(res.etapes))
      .catch(() => setEvaluationHaccp([]));
    getDepots()
      .then(setDepots)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"));
  }, [id]);

  // Dès que la production mise en file hors ligne synchronise réellement (voir
  // src/offline/synchronisation.ts), bascule vers l'affichage normal "production enregistrée" —
  // les contrôles mis en file contre son idLocal sont traités dans le MÊME passage de
  // synchronisation (voir fileAttenteCore.ts), donc déjà résolus à ce moment.
  useEffect(() => {
    function surProductionSynchronisee(evenement: Event) {
      const { idLocal, id: idReel } = (evenement as CustomEvent<{ idLocal: string; id: number }>).detail;
      if (idLocal !== idLocalProductionEnAttente) return;
      getProduction(idReel)
        .then((production) => {
          setProductionEnregistree(production);
          setIdLocalProductionEnAttente(null);
          setControlesLocauxEnAttente([]);
          toast.success(`Production #${idReel} synchronisée.`);
        })
        .catch(() => {
          // Best-effort : la production est bel et bien synchronisée (voir le serveur) même si
          // cette relecture échoue — l'utilisateur la retrouvera de toute façon dans la
          // traçabilité HACCP.
        });
    }
    busFileAttente.addEventListener(EVENEMENT_PRODUCTION_SYNCHRONISEE, surProductionSynchronisee);
    return () => busFileAttente.removeEventListener(EVENEMENT_PRODUCTION_SYNCHRONISEE, surProductionSynchronisee);
  }, [idLocalProductionEnAttente]);

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
    setProductionEnregistree(null);
    setIdLocalProductionEnAttente(null);
    setControlesLocauxEnAttente([]);
    setBrouillonsLocaux({});
    setPlanification(null);
    setPlanificationIndisponibleHorsLigne(false);
    try {
      // Le champ "Poids fini" se saisit en kg (plus pratique qu'en grammes pour une quantité de
      // production réaliste) mais l'API attend toujours des grammes (voir CibleProduction,
      // server/utils/planifierProduction.ts) — conversion uniquement à cette frontière.
      const valeur = mode === "poidsFiniG" ? cible * 1000 : cible;
      const res = await planifierProduction(id, { mode, valeur }, depotId);
      setPlanification(res);
    } catch (e) {
      if (!navigator.onLine || e instanceof TypeError) {
        setPlanificationIndisponibleHorsLigne(true);
      } else {
        setErreurPlan(e instanceof Error ? e.message : "Erreur inconnue");
      }
    } finally {
      setChargementPlan(false);
    }
  }

  function besoinsAchat(): BesoinAchat[] {
    if (!planification) return [];
    // Une ligne à 0 (ingrédient dont la quantité à cette échelle arrondit à rien, voir
    // ligne.quantiteProduction) n'a aucun besoin d'achat à proposer, et ferait échouer la
    // validation serveur (quantite: z.number().positive(), strictement > 0) pour TOUT le lot —
    // donc exclue ici plutôt que transmise.
    return planification.lignes
      .filter((ligne) => ligne.quantiteProduction > 0)
      .map((ligne) => ({
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

  // Enregistre la production réellement réalisée — quantités toujours recalculées côté serveur
  // (voir planifierProduction dans server/routes/productions.ts, même principe que
  // enregistrerCommande ci-dessus), jamais celles affichées ici transmises telles quelles. C'est
  // ce lot qui sert ensuite d'ancrage daté aux contrôles HACCP (voir ProductionDetailPage).
  async function enregistrerLaProduction() {
    // planification n'est jamais lue ci-dessous (le serveur recalcule tout à l'enregistrement,
    // voir le commentaire au-dessus) : seul planificationIndisponibleHorsLigne autorise à
    // continuer sans elle, jamais un clic "orphelin" avant tout calcul de planification.
    if (!planification && !planificationIndisponibleHorsLigne) return;
    setChargementProduction(true);
    try {
      const valeur = mode === "poidsFiniG" ? cible * 1000 : cible;
      const resultat = await enregistrerProductionResiliente(id, { mode, valeur }, depotId);
      if (resultat.sorte === "synchronise") {
        setProductionEnregistree(resultat.production);
        toast.success("Production enregistrée.");
      } else {
        setIdLocalProductionEnAttente(resultat.idLocal);
        toast("Hors ligne : production mise en attente de synchronisation.", { icon: "📡" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d'enregistrer la production");
    } finally {
      setChargementProduction(false);
    }
  }

  function brouillonLocal(etapeId: number): BrouillonControle {
    return brouillonsLocaux[etapeId] ?? BROUILLON_VIDE;
  }

  function majBrouillonLocal(etapeId: number, changement: Partial<BrouillonControle>) {
    setBrouillonsLocaux((prec) => ({ ...prec, [etapeId]: { ...brouillonLocal(etapeId), ...changement } }));
  }

  // Met en file un contrôle HACCP rattaché à la production encore en attente de synchronisation —
  // jamais un appel réseau direct (voir ajouterControleSurProductionLocale : aucun id réel
  // n'existe tant que la production elle-même n'a pas synchronisé).
  async function enregistrerControleLocal(etapeId: number) {
    if (!idLocalProductionEnAttente) return;
    const saisie = brouillonLocal(etapeId);
    if (!saisie.valeur.trim()) {
      toast.error("Indique la valeur constatée (ex. température, observation).");
      return;
    }
    const controle: ControleSaisi = {
      recetteEtapeId: etapeId,
      valeur: saisie.valeur.trim(),
      conforme: saisie.conforme,
      commentaire: saisie.commentaire.trim() || undefined,
    };
    const { idLocal } = await ajouterControleSurProductionLocale(idLocalProductionEnAttente, controle);
    setControlesLocauxEnAttente((prec) => [
      ...prec,
      { idLocal, etapeId, valeur: controle.valeur, conforme: controle.conforme, commentaire: controle.commentaire ?? null },
    ]);
    setBrouillonsLocaux((prec) => ({ ...prec, [etapeId]: BROUILLON_VIDE }));
    toast("Contrôle mis en attente de synchronisation.", { icon: "📡" });
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

      {(planification || planificationIndisponibleHorsLigne) && (
        <div className="fiche-technique-impression" style={{ marginBottom: 24 }}>
          {planification && (
            <>
              <p style={{ color: "#666" }}>
                Cible : {planification.mode === "portions" ? `${planification.portionsCible} portion(s)` : `${(planification.poidsFiniCibleG / 1000).toFixed(2)} kg fini`}
                {" · "}échelle ×{planification.echelle.toFixed(2)}
              </p>

              <h3>Besoins matières</h3>
              <div style={{ overflowX: "auto" }}>
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
              </div>
            </>
          )}

          {planificationIndisponibleHorsLigne && (
            <p style={{ color: "#946200" }}>
              📡 Besoins matières indisponibles hors ligne (nécessite le stock en temps réel) — tu
              peux tout de même enregistrer la production et ses contrôles HACCP ci-dessous ; la
              proposition d'achat ne sera disponible qu'au retour du réseau.
            </p>
          )}

          <div className="feuille-production-sans-impression" style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {planification && (
              <button className="btn-primary" onClick={genererPropositionAchat} disabled={chargementAchat}>
                {chargementAchat ? "Calcul…" : "Générer la proposition d'achat"}
              </button>
            )}
            <button onClick={enregistrerLaProduction} disabled={chargementProduction}>
              {chargementProduction ? "Enregistrement…" : "Enregistrer la production"}
            </button>
            {productionEnregistree && (
              <span style={{ fontSize: 14 }}>
                ✅ Production #{productionEnregistree.id} enregistrée —{" "}
                <Link to={`/productions/${productionEnregistree.id}`}>
                  {productionEnregistree.etapesCritiques.length > 0
                    ? "enregistrer les contrôles HACCP"
                    : "voir la production"}
                </Link>
              </span>
            )}
            {idLocalProductionEnAttente && (
              <span style={{ fontSize: 14, color: "#946200" }}>
                📡 Production en attente de synchronisation — tu peux déjà saisir ses contrôles
                HACCP ci-dessous, ils se synchroniseront avec elle.
              </span>
            )}
          </div>

          {idLocalProductionEnAttente && (
            <div className="feuille-production-sans-impression" style={{ marginBottom: 20 }}>
              {etapesCritiquesLocales(recette, evaluationHaccp).length === 0 && (
                <p style={{ color: "#0ca30c" }}>✓ Cette recette n'a aucun point critique HACCP identifié.</p>
              )}
              {etapesCritiquesLocales(recette, evaluationHaccp).map((etape) => {
                const controlesEtape = controlesLocauxEnAttente.filter((c) => c.etapeId === etape.id);
                const saisie = brouillonLocal(etape.id);
                return (
                  <div
                    key={etape.id}
                    style={{
                      background: "#fff4e5",
                      border: "1px solid #f0b429",
                      borderRadius: 8,
                      padding: "14px 18px",
                      marginBottom: 16,
                    }}
                  >
                    <h3 style={{ margin: "0 0 6px" }}>⚠ {etape.description}</h3>
                    {etape.controleHACCP && (
                      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                        Procédure : {etape.controleHACCP}
                      </p>
                    )}
                    {etape.reglesDetectees.length > 0 && (
                      <div style={{ marginBottom: 10, fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                        Détecté automatiquement : {etape.reglesDetectees.map((r) => r.nom).join(", ")}
                      </div>
                    )}

                    {controlesEtape.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>En attente de synchronisation</div>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                          {controlesEtape.map((controle) => (
                            <li key={controle.idLocal} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
                              <span style={{ color: controle.conforme ? "#1a7a3c" : "#b3261e", fontWeight: 600 }}>
                                {controle.conforme ? "✓ Conforme" : "✗ Non conforme"}
                              </span>
                              <span>{controle.valeur}</span>
                              {controle.commentaire && (
                                <span style={{ color: "var(--couleur-texte-attenue)" }}>— {controle.commentaire}</span>
                              )}
                              <span style={{ color: "#946200", marginLeft: "auto" }}>📡 en attente</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Valeur constatée (ex. 72°C)"
                        value={saisie.valeur}
                        onChange={(e) => majBrouillonLocal(etape.id, { valeur: e.target.value })}
                        style={{ padding: 8, flex: 1, minWidth: 160 }}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={saisie.conforme}
                          onChange={(e) => majBrouillonLocal(etape.id, { conforme: e.target.checked })}
                        />
                        Conforme
                      </label>
                      <input
                        type="text"
                        placeholder="Commentaire (optionnel)"
                        value={saisie.commentaire}
                        onChange={(e) => majBrouillonLocal(etape.id, { commentaire: e.target.value })}
                        style={{ padding: 8, flex: 1, minWidth: 160 }}
                      />
                      <button className="btn-primary" onClick={() => enregistrerControleLocal(etape.id)}>
                        Enregistrer le contrôle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {erreurAchat && <p style={{ color: "#b3261e" }}>{erreurAchat}</p>}

          {proposition && (
            <>
              <h3>Proposition d'achat</h3>
              <div style={{ overflowX: "auto" }}>
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
              </div>
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
