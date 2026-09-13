import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Société (référencée en dur par societeId: 1 dans IngredientForm.tsx)
  const societe = await prisma.societe.upsert({
    where: { id: 1 },
    update: {},
    create: { nom: "Mon entreprise" },
  });

  // TVA (référencée en dur par tvaId: 1 dans IngredientForm.tsx)
  // NOTE : taux stocké ici en pourcentage (5.5 = 5,5 %) — à adapter si un calcul
  // de prix TTC est ajouté plus tard et attend une fraction (0.055).
  await prisma.tVA.upsert({
    where: { id: 1 },
    update: {},
    create: { nom: "TVA 5,5 %", taux: 5.5 },
  });
  await prisma.tVA.upsert({
    where: { id: 2 },
    update: {},
    create: { nom: "TVA 20 %", taux: 20 },
  });
  // Taux particulier applicable en Corse sur certains produits (art. 297 du CGI)
  await prisma.tVA.upsert({
    where: { id: 3 },
    update: {},
    create: { nom: "TVA 2,1 %", taux: 2.1 },
  });

  // Dépôt par défaut (nécessaire pour enregistrer du stock)
  const depotExistant = await prisma.depot.findFirst({ where: { societeId: societe.id } });
  if (!depotExistant) {
    await prisma.depot.create({ data: { nom: "Dépôt principal", societeId: societe.id } });
  }

  // Catégories de base (ingrédients)
  for (const nom of ["Épicerie", "Frais", "Surgelés", "Boissons", "Entretien"]) {
    await prisma.categorie.upsert({
      where: { nom },
      update: {},
      create: { nom },
    });
  }

  // Catégories de recettes (distinctes des catégories d'ingrédients ci-dessus)
  for (const nom of ["Entrée", "Plat", "Dessert", "Autre", "Festif", "Mariage"]) {
    await prisma.categorieRecette.upsert({
      where: { nom },
      update: {},
      create: { nom },
    });
  }

  // Unités
  const unites: { nom: string; symbole: string; type: string; facteurBase: number }[] = [
    { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 },
    { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 },
    { nom: "Litre", symbole: "L", type: "volume", facteurBase: 1000 },
    { nom: "Millilitre", symbole: "mL", type: "volume", facteurBase: 1 },
    { nom: "Pièce", symbole: "pièce", type: "unite", facteurBase: 1 },
    { nom: "Boîte", symbole: "boîte", type: "unite", facteurBase: 1 },
  ];
  for (const u of unites) {
    const existing = await prisma.unite.findFirst({ where: { symbole: u.symbole } });
    if (!existing) await prisma.unite.create({ data: u });
  }

  // Conditionnements
  for (const nom of ["Sac", "Carton", "Unité", "Bidon", "Palette"]) {
    const existing = await prisma.conditionnement.findFirst({ where: { nom } });
    if (!existing) await prisma.conditionnement.create({ data: { nom } });
  }

  // Allergènes (liste réglementaire des 14)
  const allergenes: { code: string; nom: string }[] = [
    { code: "GLUTEN", nom: "Gluten" },
    { code: "CRUSTACES", nom: "Crustacés" },
    { code: "OEUFS", nom: "Œufs" },
    { code: "POISSON", nom: "Poisson" },
    { code: "ARACHIDES", nom: "Arachides" },
    { code: "SOJA", nom: "Soja" },
    { code: "LAIT", nom: "Lait" },
    { code: "FRUITS_A_COQUE", nom: "Fruits à coque" },
    { code: "CELERI", nom: "Céleri" },
    { code: "MOUTARDE", nom: "Moutarde" },
    { code: "SESAME", nom: "Sésame" },
    { code: "SULFITES", nom: "Sulfites" },
    { code: "LUPIN", nom: "Lupin" },
    { code: "MOLLUSQUES", nom: "Mollusques" },
  ];
  for (const a of allergenes) {
    await prisma.allergene.upsert({ where: { code: a.code }, update: {}, create: a });
  }

  console.log("✅ Données de départ créées : société #%d, TVA, catégories, unités, conditionnements, allergènes.", societe.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
