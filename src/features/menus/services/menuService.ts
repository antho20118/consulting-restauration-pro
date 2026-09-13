import { API_URL } from "../../../config/api";
import type { Menu, MenuInput } from "../types/menu";

export async function getMenus(): Promise<Menu[]> {
  const response = await fetch(`${API_URL}/menus`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les menus");
  }

  return response.json();
}

export async function creerMenu(input: MenuInput & { societeId: number }): Promise<Menu> {
  const response = await fetch(`${API_URL}/menus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer le menu");
  }

  return response.json();
}

export async function modifierMenu(id: number, input: MenuInput): Promise<Menu> {
  const response = await fetch(`${API_URL}/menus/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier le menu");
  }

  return response.json();
}

export async function supprimerMenu(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/menus/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer le menu");
  }
}
