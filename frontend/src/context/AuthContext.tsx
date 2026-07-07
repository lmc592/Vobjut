import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, clearToken, getToken } from "@/src/api/client";

type User = { id: string; name: string; email: string; role: string; company_id: string };
type Company = { id: string; name: string; abn?: string };

type AuthState = {
  user: User | null;
  company: Company | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (p: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
};

type RegisterPayload = {
  company_name: string;
  name: string;
  email: string;
  password: string;
  abn?: string;
};

const Ctx = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const me = await api<{ user: User; company: Company }>("/auth/me");
          setUser(me.user);
          setCompany(me.company);
        } catch {
          await clearToken();
        }
      }
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: User; company: Company }>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    await setToken(res.token);
    setUser(res.user);
    setCompany(res.company);
  }

  async function register(p: RegisterPayload) {
    const res = await api<{ token: string; user: User; company: Company }>("/auth/register", {
      method: "POST",
      auth: false,
      body: p,
    });
    await setToken(res.token);
    setUser(res.user);
    setCompany(res.company);
  }

  async function logout() {
    await clearToken();
    setUser(null);
    setCompany(null);
  }

  return (
    <Ctx.Provider value={{ user, company, loading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
