import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Menu } from "../types/menu";

type Props = {
  menus: Menu[];
  onEdit: (menu: Menu) => void;
  onDelete: (menu: Menu) => void;
};

export default function MenusTable({ menus, onEdit, onDelete }: Props) {
  const columns: GridColDef<Menu>[] = [
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
      field: "nbRecettes",
      headerName: "Recettes",
      width: 100,
      valueGetter: (_value, row) => row.lignes.length,
    },
    {
      field: "coutTotal",
      headerName: "Coût / pers.",
      width: 130,
      valueFormatter: (value) => `${Number(value).toFixed(2)} €`,
    },
    {
      field: "prixVenteHT",
      headerName: "Prix de vente HT",
      width: 150,
      valueFormatter: (value) => (value != null ? `${Number(value).toFixed(2)} €` : "—"),
    },
    {
      field: "foodCostPct",
      headerName: "Food cost",
      width: 110,
      valueFormatter: (value) => (value != null ? `${Number(value).toFixed(1)} %` : "—"),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-table" onClick={() => onEdit(params.row)}>Modifier</button>
          <button className="btn-table btn-danger" onClick={() => onDelete(params.row)}>Supprimer</button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ height: 600, width: "100%" }}>
      <DataGrid
        rows={menus}
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
