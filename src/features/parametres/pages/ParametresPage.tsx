import type { ReactNode } from "react";
import SocieteSection from "../components/SocieteSection";
import CategoriesManager from "../components/CategoriesManager";
import UnitesManager from "../components/UnitesManager";

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
  return (
    <div style={{ padding: 20 }}>
      <h1>⚙ Paramètres</h1>

      <Section titre="Société">
        <SocieteSection />
      </Section>

      <Section titre="Catégories">
        <CategoriesManager />
      </Section>

      <Section titre="Unités">
        <UnitesManager />
      </Section>
    </div>
  );
}
