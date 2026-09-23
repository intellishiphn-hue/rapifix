import { useContext } from "react";
import { AuthContext } from "./AuthProvider";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

/** Nombre visible del usuario actual */
export function useDisplayName() {
  const { profile, user } = useAuth();
  return profile?.displayName || user?.displayName || user?.email?.split("@")[0] || "Usuario";
}
