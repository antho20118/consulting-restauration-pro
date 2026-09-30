import type { ReactNode } from "react";
import { getUtilisateur } from "../../../config/api";
import SocieteSection from "../components/SocieteSection";
import CategoriesManager from "../components/CategoriesManager";
import CategoriesRecetteManager from "../components/CategoriesRecetteManager";
import SousCategoriesRecetteManager from "../components/SousCategoriesRecetteManager";
import UnitesManager from "../components/UnitesManager";
import TvaManager from "../components/TvaManager";
import ComptesManager from "../components/ComptesManager";
import IdentifiantsSection from "../components/IdentifiantsSection";
import SauvegardesSection from "../components/SauvegardesSection";
import JournalErreursSection from "../components/JournalErreursSection";

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 10,
        padding: 20,
        marginBottom: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,.08)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{titre}</h3>
      {children}
    </div>
  );
}

export default function ParametresPage() {
  // Masqué côté client à qui n'est pas PROPRIETAIRE (server/routes/utilisateurs.ts refuse
  // de toute façon la moindre requête avec un autre rôle — jamais une sécurité côté client seule).
  const estProprietaire = getUtilisateur()?.role === "PROPRIETAIRE";

  return (
    <div style={{ padding: 20 }}>
      <h1>⚙ Paramètres</h1>

      <Section titre="Société">
        <SocieteSection />
      </Section>

      {estProprietaire && (
        <Section titre="Comptes utilisateurs">
          <ComptesManager />
        </Section>
      )}

      <Section titre="Catégories d'ingrédients">
        <CategoriesManager />
      </Section>

      <Section titre="Catégories de recettes">
        <CategoriesRecetteManager />
      </Section>

      <Section titre="Sous-catégories de recettes">
        <SousCategoriesRecetteManager />
      </Section>

      <Section titre="Unités">
        <UnitesManager />
      </Section>

      <Section titre="TVA">
        <TvaManager />
      </Section>

      <Section titre="Mon compte">
        <IdentifiantsSection />
      </Section>

      <Section titre="Sauvegardes">
        <SauvegardesSection />
      </Section>

      {estProprietaire && (
        <Section titre="Journal des erreurs">
          <JournalErreursSection />
        </Section>
      )}
    </div>
  );
}
