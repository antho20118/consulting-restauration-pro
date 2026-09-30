// Import explicite nécessaire : `tsx` (esbuild), qui exécute ce fichier côté serveur, résout le
// tsconfig.json le plus proche par répertoires successifs — ici la racine du projet, qui ne
// déclare elle-même aucune option "jsx" (seulement des "references" vers les sous-projets) — et
// retombe donc sur le runtime JSX classique (React.createElement), jamais le runtime automatique
// utilisé côté frontend par Vite. "jsx": "react" dans tsconfig.node.json/tsconfig.tests.json
// (plutôt que "react-jsx") aligne volontairement tsc sur ce même choix, pour que cet import soit
// à la fois nécessaire à l'exécution et reconnu "utilisé" par noUnusedLocals au typecheck.
import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

// Fiche technique recette en PDF téléchargeable — même contenu que l'aperçu imprimable existant
// (src/features/recettes/components/RecetteDetail.tsx, window.print()), mais un vrai fichier .pdf
// plutôt qu'une boîte de dialogue d'impression au rendu variable selon le navigateur. Bibliothèque
// choisie (@react-pdf/renderer) : mise en page en code React, aucun navigateur headless à déployer
// (Chromium/Playwright aurait ajouté un poids et un coût mémoire significatifs sur Railway pour ce
// seul usage). N'accepte QUE la sortie de calculerCoutRecette (jamais une recette brute) : jamais
// de recalcul du coût ici, uniquement de la mise en forme d'un résultat déjà calculé et validé.
//
// Interface écrite à la main (plutôt que dérivée de ReturnType<typeof calculerCoutRecette>, dont
// le T générique n'est pas résolu sans argument concret) : ne liste que les champs réellement
// utilisés dans cette fiche. La compatibilité structurelle avec le vrai résultat de
// calculerCoutRecette (server/utils/coutRecette.ts), qui en a toujours au moins autant, est
// garantie par TypeScript sans avoir besoin d'importer son type générique.
type RecetteFichePdf = {
  nom: string;
  categorie: { nom: string } | null;
  sousCategorie: { nom: string } | null;
  portions: number;
  instructions: string | null;
  allergenes: { id: number; nom: string }[];
  nutritionIncomplete: boolean;
  valeursNutritionnelles: {
    energie: number;
    proteines: number;
    glucides: number;
    sucres: number;
    lipides: number;
    acidesGrasSatures: number;
    fibres: number;
    sel: number;
  };
  lignes: {
    id: number;
    quantite: number;
    unite: { symbole: string };
    article: { nom: string };
    coutLigne: number;
  }[];
  etapes: {
    id: number;
    description: string;
    pointCritiqueHACCP: boolean;
    controleHACCP: string | null;
  }[];
  coutParPortion: number;
  prixVenteHT: number | null;
  foodCostPct: number | null;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#222222" },
  titre: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  sousTitre: { fontSize: 11, color: "#555555", marginBottom: 12 },
  sectionTitre: {
    fontSize: 13,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
    borderBottomStyle: "solid",
    paddingBottom: 2,
  },
  ligneAllergenes: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  badgeAllergene: {
    backgroundColor: "#fdecea",
    color: "#b3261e",
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 9,
    marginRight: 6,
    marginBottom: 4,
  },
  grilleNutrition: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  celluleNutrition: { width: "25%", marginBottom: 4 },
  ligneTableauEntete: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
    borderBottomStyle: "solid",
    paddingBottom: 4,
    marginBottom: 2,
    fontWeight: 700,
  },
  ligneTableau: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#eeeeee",
    borderBottomStyle: "solid",
    paddingVertical: 3,
  },
  colIngredient: { width: "50%" },
  colQuantite: { width: "25%" },
  colCout: { width: "25%", textAlign: "right" },
  etape: { marginBottom: 8 },
  etapeHeader: { flexDirection: "row" },
  etapeNumero: { fontWeight: 700, marginRight: 6 },
  etapeDescription: { flex: 1 },
  encartHACCP: {
    marginTop: 4,
    marginLeft: 16,
    backgroundColor: "#fff4e5",
    borderWidth: 1,
    borderColor: "#f0b429",
    borderStyle: "solid",
    borderRadius: 4,
    padding: 6,
    fontSize: 9,
  },
  encartHACCPTitre: { fontWeight: 700, marginBottom: 2 },
  piedPage: {
    marginTop: 16,
    backgroundColor: "#f4f6f8",
    borderRadius: 4,
    padding: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function formaterEuros(valeur: number): string {
  return `${valeur.toFixed(2)} €`;
}

export async function genererFicheRecettePdf(recette: RecetteFichePdf): Promise<Buffer> {
  const sousTitreParts = [
    recette.categorie?.nom ?? "Sans catégorie",
    recette.sousCategorie?.nom,
    `${recette.portions} portion${recette.portions > 1 ? "s" : ""}`,
  ].filter((partie): partie is string => Boolean(partie));

  return renderToBuffer(
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.titre}>{recette.nom}</Text>
        <Text style={styles.sousTitre}>{sousTitreParts.join(" · ")}</Text>

        {recette.allergenes.length > 0 && (
          <View style={styles.ligneAllergenes}>
            {recette.allergenes.map((allergene) => (
              <Text key={allergene.id} style={styles.badgeAllergene}>
                {allergene.nom}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitre}>
          Valeurs nutritionnelles (par portion){recette.nutritionIncomplete ? " — approximation" : ""}
        </Text>
        <View style={styles.grilleNutrition}>
          <Text style={styles.celluleNutrition}>
            Énergie : {recette.valeursNutritionnelles.energie.toFixed(0)} kcal
          </Text>
          <Text style={styles.celluleNutrition}>
            Protéines : {recette.valeursNutritionnelles.proteines.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>
            Glucides : {recette.valeursNutritionnelles.glucides.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>
            dont sucres : {recette.valeursNutritionnelles.sucres.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>
            Lipides : {recette.valeursNutritionnelles.lipides.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>
            dont acides gras saturés : {recette.valeursNutritionnelles.acidesGrasSatures.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>
            Fibres : {recette.valeursNutritionnelles.fibres.toFixed(1)} g
          </Text>
          <Text style={styles.celluleNutrition}>Sel : {recette.valeursNutritionnelles.sel.toFixed(2)} g</Text>
        </View>

        <Text style={styles.sectionTitre}>Ingrédients</Text>
        <View style={styles.ligneTableauEntete}>
          <Text style={styles.colIngredient}>Ingrédient</Text>
          <Text style={styles.colQuantite}>Quantité</Text>
          <Text style={styles.colCout}>Coût</Text>
        </View>
        {recette.lignes.map((ligne) => (
          <View key={ligne.id} style={styles.ligneTableau}>
            <Text style={styles.colIngredient}>{ligne.article.nom}</Text>
            <Text style={styles.colQuantite}>
              {ligne.quantite} {ligne.unite.symbole}
            </Text>
            <Text style={styles.colCout}>{formaterEuros(ligne.coutLigne)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitre}>Procédé pas à pas</Text>
        {recette.etapes.length === 0 && <Text>Aucune étape renseignée.</Text>}
        {recette.etapes.map((etape, index) => (
          <View key={etape.id} style={styles.etape}>
            <View style={styles.etapeHeader}>
              <Text style={styles.etapeNumero}>{index + 1}.</Text>
              <Text style={styles.etapeDescription}>{etape.description}</Text>
            </View>
            {etape.pointCritiqueHACCP && (
              <View style={styles.encartHACCP}>
                <Text style={styles.encartHACCPTitre}>⚠ Point critique HACCP</Text>
                {etape.controleHACCP && <Text>{etape.controleHACCP}</Text>}
              </View>
            )}
          </View>
        ))}

        {recette.instructions && (
          <>
            <Text style={styles.sectionTitre}>Notes complémentaires</Text>
            <Text>{recette.instructions}</Text>
          </>
        )}

        <View style={styles.piedPage}>
          <Text>Coût / portion : {formaterEuros(recette.coutParPortion)}</Text>
          <Text>Prix de vente HT : {recette.prixVenteHT != null ? formaterEuros(recette.prixVenteHT) : "—"}</Text>
          <Text>Food cost : {recette.foodCostPct != null ? `${recette.foodCostPct.toFixed(1)} %` : "—"}</Text>
        </View>
      </Page>
    </Document>
  );
}
