export type RegleHACCP = {
  code: string;
  nom: string;
  motsCles: string[];
  risque: string;
  mesurePreventive: string;
  limiteCritique: string;
  surveillance: string;
  actionCorrective: string;
};

export const reglesHACCP: RegleHACCP[] = [
  { code: "LEGUMES_CRUS", nom: "Traitement des légumes", motsCles: ["légume", "salade", "crudité"], risque: "Contamination microbiologique", mesurePreventive: "Trier, laver et désinfecter selon le plan sanitaire", limiteCritique: "Respect du protocole interne de désinfection", surveillance: "Contrôle du protocole et de la température", actionCorrective: "Isoler et retraiter ou éliminer le produit non conforme" },
  { code: "CUISSON", nom: "Cuisson", motsCles: ["cuire", "cuisson", "rôtir", "bouillir", "poêler"], risque: "Survie de microorganismes", mesurePreventive: "Cuisson complète avec contrôle de température", limiteCritique: "Température cible définie par la procédure de l'établissement", surveillance: "Contrôle et enregistrement de la température", actionCorrective: "Prolonger la cuisson ou écarter le produit" },
  { code: "REFROIDISSEMENT", nom: "Refroidissement", motsCles: ["refroidir", "refroidissement", "cellule"], risque: "Multiplication microbienne", mesurePreventive: "Refroidissement rapide en cellule", limiteCritique: "+10°C maximum en moins de 2 h selon la procédure retenue", surveillance: "Mesure température/temps", actionCorrective: "Poursuivre le refroidissement si conforme à la procédure, sinon isoler le lot" },
  { code: "REMISE_TEMPERATURE", nom: "Remise en température", motsCles: ["remise en température", "réchauffer", "réchauffage"], risque: "Multiplication microbienne", mesurePreventive: "Remise en température rapide", limiteCritique: "+63°C selon la procédure de l'établissement", surveillance: "Contrôle de température et durée", actionCorrective: "Poursuivre si la procédure le permet, sinon écarter" },
  { code: "FROID", nom: "Maintien au froid", motsCles: ["froid", "réfrigérer", "réfrigération", "sous vide"], risque: "Multiplication microbienne", mesurePreventive: "Maintien de la chaîne du froid", limiteCritique: "Température conforme au plan sanitaire et au produit", surveillance: "Relevés réguliers", actionCorrective: "Isoler le produit et appliquer la procédure de non-conformité" },
];

export function evaluerEtapesHACCP(etapes: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[]) {
  return etapes.map((etape) => {
    const texte = etape.description.toLocaleLowerCase("fr-FR");
    const regles = reglesHACCP.filter((r) => r.motsCles.some((mot) => texte.includes(mot)));
    return { ...etape, reglesDetectees: regles, aValider: regles.length > 0 && !etape.controleHACCP };
  });
}
