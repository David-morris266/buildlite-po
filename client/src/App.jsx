import { useState, useEffect } from "react";
import POForm from "./components/POForm";
import POList from "./components/POList";
import POArchive from "./components/POArchive";
import BrandHeader from "./components/Brandheader";
import "./styles/brand.css";

export default function App() {
  const [tab, setTab] = useState("form"); // "form" | "list" | "archive"

  // Set a test identity/role (requester by default)
  useEffect(() => {
    localStorage.setItem("userEmail", "david@dmcommercialconsulting.co.uk");
    localStorage.setItem("userName", "David");
    localStorage.setItem("userRole", "requester"); // requester sees "Send for approval"
  }, []);

  return (
    <div id="app">
      {/* Brand header at the very top */}
      <BrandHeader activeTab={tab} onTab={setTab} />

      <main style={{ padding: "16px", display: "grid", gap: "16px" }}>
        {tab === "form" && <POForm />}
        {tab === "list" && <POList />}
        {tab === "archive" && <POArchive />}
      </main>
    </div>
  );
}

















