import { API_URL } from "../../../config/api";
import type { DashboardData } from "../types/dashboard";

export async function getDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_URL}/dashboard`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les indicateurs du tableau de bord");
  }

  return response.json();
}
