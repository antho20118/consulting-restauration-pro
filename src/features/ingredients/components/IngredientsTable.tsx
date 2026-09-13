import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Ingredient } from "../types/ingredient";

type Props = {
  ingredients: Ingredient[];
};

export default function IngredientsTable({ ingredients }: Props) {
  const columns: GridColDef[] = [
    {
      field: "nom",
      headerName: "Nom",
      flex: 2,
    },

    {
      field: "categorie",
      headerName: "Catégorie",
      flex: 1,
      valueGetter: (_value, row) => row.categorie?.nom ?? "",
    },

    {
      field: "unite",
      headerName: "Unité",
      width: 120,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.unite?.symbole ?? "",
    },

    {
      field: "fournisseur",
      headerName: "Fournisseur",
      flex: 1,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.fournisseur?.nom ?? "",
    },

    {
      field: "prix",
      headerName: "Prix HT",
      width: 120,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.prixHT ?? 0,

      valueFormatter: (value) =>
        `${Number(value).toFixed(2)} €`,
    },

    {
      field: "stock",
      headerName: "Stock",
      width: 120,
      valueGetter: (_value, row) =>
        row.stocks?.[0]?.quantite ?? 0,
    },
  ];

  return (
    <div style={{ height: 600, width: "100%" }}>
      <DataGrid
        rows={ingredients}
        columns={columns}
        pageSizeOptions={[10, 25, 50]}
        initialState={{
          pagination: {
            paginationModel: {
              pageSize: 25,
            },
          },
        }}
      />
    </div>
  );
}