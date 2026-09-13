import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function MainLayout() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#f4f6f8",
      }}
    >
      <Sidebar />

      <main
        style={{
          flex: 1,
          padding: 24,
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}