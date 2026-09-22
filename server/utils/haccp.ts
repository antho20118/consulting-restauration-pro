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

// motsCles : détection heuristique par sous-chaîne sur la description libre d'une étape — jamais
// une preuve de conformité, seulement une suggestion. Chaque mot-clé est vérifié pour ne pas
// apparaître par accident dans un mot français courant sans rapport (ex. "four" seul matcherait
// "fourchette"/"fournisseur" : on utilise "au four" ; "cuit" seul matcherait "biscuit" : on
// n'ajoute pas ce mot-clé). Les racines partagées (ex. "réfrigér" pour réfrigérer/réfrigération/
// réfrigérateur, "désinfect" pour désinfecter/désinfection) sont vérifiées ne pas être des
// sous-chaînes d'un mot non lié avant d'être utilisées — voir tests/unit/haccp.test.ts pour ces
// vérifications explicites (griller/grille, au four/fourchette, frit/confit...).
export const reglesHACCP: RegleHACCP[] = [
  { code: "LEGUMES_CRUS", nom: "Traitement des légumes", motsCles: ["légume", "salade", "crudité", "éplucher", "désinfect"], risque: "Contamination microbiologique", mesurePreventive: "Trier, laver et désinfecter selon le plan sanitaire", limiteCritique: "Respect du protocole interne de désinfection", surveillance: "Contrôle du protocole et de la température", actionCorrective: "Isoler et retraiter ou éliminer le produit non conforme" },
  { code: "CUISSON", nom: "Cuisson", motsCles: ["cuire", "cuisson", "rôtir", "bouillir", "poêler", "au four", "griller", "grillé", "frire", "frit", "saisir", "mijoter", "braiser", "rissoler"], risque: "Survie de microorganismes", mesurePreventive: "Cuisson complète avec contrôle de température", limiteCritique: "Température cible définie par la procédure de l'établissement", surveillance: "Contrôle et enregistrement de la température", actionCorrective: "Prolonger la cuisson ou écarter le produit" },
  { code: "REFROIDISSEMENT", nom: "Refroidissement", motsCles: ["refroidi", "cellule"], risque: "Multiplication microbienne", mesurePreventive: "Refroidissement rapide en cellule", limiteCritique: "+10°C maximum en moins de 2 h selon la procédure retenue", surveillance: "Mesure température/temps", actionCorrective: "Poursuivre le refroidissement si conforme à la procédure, sinon isoler le lot" },
  { code: "REMISE_TEMPERATURE", nom: "Remise en température", motsCles: ["remise en température", "remettre en température", "réchauffer", "réchauffage"], risque: "Multiplication microbienne", mesurePreventive: "Remise en température rapide", limiteCritique: "+63°C selon la procédure de l'établissement", surveillance: "Contrôle de température et durée", actionCorrective: "Poursuivre si la procédure le permet, sinon écarter" },
  { code: "FROID", nom: "Maintien au froid", motsCles: ["froid", "réfrigér", "sous vide", "congélateur"], risque: "Multiplication microbienne", mesurePreventive: "Maintien de la chaîne du froid", limiteCritique: "Température conforme au plan sanitaire et au produit", surveillance: "Relevés réguliers", actionCorrective: "Isoler le produit et appliquer la procédure de non-conformité" },
];

// Une recette (calculerCoutRecette) évalue chaque ligne par rapport à un article et un tarif ;
// evaluerEtapesHACCP évalue chaque étape par rapport à deux signaux indépendants, réunis par un OU
// logique (l'un ou l'autre suffit à exiger un contrôle documenté) :
//
// 1. la détection par mots-clés sur la description libre (regles.length > 0) — un filet de
//    sécurité automatique, mais nécessairement imparfait : une étape de cuisson rédigée sans aucun
//    des mots-clés ("Passer au four à 220°C" avant l'ajout de "au four" à la liste, par exemple)
//    ne déclenchait rien, silencieusement ;
// 2. le signal humain explicite etape.pointCritiqueHACCP (case cochée par l'utilisateur en
//    éditant la recette) — auparavant reçu en paramètre mais jamais lu par cette fonction : un
//    utilisateur pouvait cocher « point critique » sur une étape que les mots-clés ne détectaient
//    pas, et l'évaluation automatique disait quand même aValider=false, contredisant
//    silencieusement sa propre déclaration.
//
// Un contrôle est considéré comme documenté seulement si controleHACCP contient un texte non vide
// après suppression des espaces — auparavant, une simple chaîne non vide (y compris un seul
// espace) suffisait à faire disparaître définitivement l'alerte, sans aucune garantie qu'un
// contrôle réel ait été noté.
//
// Générique (comme calculerCoutRecette dans coutRecette.ts) pour que le type de retour conserve
// tous les champs de l'étape d'origine (id, ordre...), pas seulement les trois lus ici.
export function evaluerEtapesHACCP<
  T extends { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null },
>(etapes: T[]) {
  return etapes.map((etape) => {
    const texte = etape.description.toLocaleLowerCase("fr-FR");
    const regles = reglesHACCP.filter((r) => r.motsCles.some((mot) => texte.includes(mot)));
    const controleDocumente = etape.controleHACCP != null && etape.controleHACCP.trim().length > 0;
    const aValider = (regles.length > 0 || etape.pointCritiqueHACCP) && !controleDocumente;
    return { ...etape, reglesDetectees: regles, aValider };
  });
}
