import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { can as canRole, isRole, type Permission, type Role, type UserProfile } from "@rapifix/shared";
import { auth, callable, db } from "@/lib/firebase";

const touchSession = callable<void, { ok: boolean }>("touchSession");

export type AuthStatus = "loading" | "signedOut" | "noRole" | "ready";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  role: Role | null;
  tid: string | null;
  profile: UserProfile | null;
  can: (permission: Permission) => boolean;
  refreshClaims: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [tid, setTid] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const lastClaimsAt = useRef<number | null>(null);

  const readClaims = useCallback(async (u: User, force = false) => {
    const token = await u.getIdTokenResult(force);
    const r = token.claims.role;
    const t = token.claims.tid;
    if (isRole(r) && typeof t === "string") {
      setRole(r);
      setTid(t);
      setStatus("ready");
    } else {
      setRole(null);
      setTid(null);
      setStatus("noRole");
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setRole(null);
        setTid(null);
        setProfile(null);
        setStatus("signedOut");
        return;
      }
      try {
        await readClaims(u);
      } catch {
        setStatus("noRole");
      }
    });
  }, [readClaims]);

  // Perfil del usuario. Cuando un admin cambia su rol, claimsUpdatedAt cambia y
  // se refresca el token para aplicar los permisos nuevos sin cerrar sesión.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        const data = snap.exists() ? ({ id: snap.id, ...snap.data() } as UserProfile) : null;
        setProfile(data);
        const at = data?.claimsUpdatedAt?.toMillis?.() ?? null;
        if (at && lastClaimsAt.current !== null && at !== lastClaimsAt.current) {
          void readClaims(user, true);
        }
        lastClaimsAt.current = at ?? lastClaimsAt.current ?? 0;
      },
      () => setProfile(null),
    );
  }, [user, readClaims]);

  // Registra el acceso una vez por sesión (actualiza el directorio del personal)
  const touched = useRef<string | null>(null);
  useEffect(() => {
    if (status === "ready" && user && touched.current !== user.uid) {
      touched.current = user.uid;
      touchSession().catch(() => undefined);
    }
  }, [status, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      role,
      tid,
      profile,
      can: (p) => canRole(role, p),
      refreshClaims: async () => {
        if (auth.currentUser) await readClaims(auth.currentUser, true);
      },
      signOut: () => fbSignOut(auth),
    }),
    [status, user, role, tid, profile, readClaims],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
