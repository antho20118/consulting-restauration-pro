import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { MouvementStock } from "../types/mouvement";

type Props = {
  mouvements: MouvementStock[];
};

export default function MouvementsTable({ mouvements }: Props) {
  const columns: GridColDef<MouvementStock>[] = [
    {
      field: "date",
      headerName: "Date",
      width: 160,
      valueGetter: (_value, row) => new Date(row.date).toLocaleString("fr-FR"),
    },
    {
      field: "article",
      headerName: "Ingrédient",
      flex: 1,
      valueGetter: (_value, row) => row.article.nom,
    },
    {
      field: "depot",
      headerName: "Dépôt",
      width: 140,
      valueGetter: (_value, row) => row.depot.nom,
    },
    {
      field: "type",
      headerName: "Type",
      width: 100,
      valueGetter: (_value, row) => (row.type === "ENTREE" ? "Entrée" : "Sortie"),
    },
    {
      field: "quantite",
      headerName: "Quantité",
      width: 110,
      valueGetter: (_value, row) => (row.type === "ENTREE" ? row.quantite : -row.quantite),
    },
    {
      field: "motif",
      headerName: "Motif",
      flex: 1,
      valueGetter: (_value, row) => row.motif ?? "",
    },
  ];

  return (
    <div style={{ height: 600, width: "100%" }}>
      <DataGrid
        rows={mouvements}
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
