"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
  type ParsedToken,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { accountInitializeFn } from "./functions";
import { serializeCallableError } from "./callableDiagnostics";
import type { UserRole, UserDoc } from "@hi/shared";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** Custom claims from the ID token (role is authoritative here) */
  claims: ParsedToken | null;
  /** Role from custom claims — shorthand for claims?.role */
  role: UserRole | null;
  /** User doc from Firestore (entitlements live here, not in claims) */
  userDoc: UserDoc | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Force-refresh the ID token to pick up new claims */
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  claims: null,
  role: null,
  userDoc: null,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  refreshClaims: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<ParsedToken | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const repairAttemptedForUid = useRef<Set<string>>(new Set());

  // Fetch claims from the ID token
  const fetchClaims = useCallback(async (u: User, forceRefresh = false) => {
    const result = await u.getIdTokenResult(forceRefresh);
    setClaims(result.claims);
  }, []);

  const initializeAccount = useCallback(async (u: User, idempotencyKey: string) => {
    await accountInitializeFn({
      ...(u.displayName ? { displayName: u.displayName } : {}),
      idempotencyKey,
      registrationVersion: 1,
    });
    await u.getIdToken(true);
    await fetchClaims(u);
  }, [fetchClaims]);

  // ID token listener: updates on sign-in/sign-out and token refresh (incl. custom claims changes)
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await fetchClaims(u);
      } else {
        setClaims(null);
        setUserDoc(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchClaims]);

  // Real-time listener for Firestore user doc (entitlements)
  useEffect(() => {
    if (!user) {
      setUserDoc(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (snap.exists()) {
          setUserDoc(snap.data() as UserDoc);
        } else {
          setUserDoc(null);
          if (!repairAttemptedForUid.current.has(user.uid)) {
            repairAttemptedForUid.current.add(user.uid);
            void initializeAccount(user, "missing-user-repair-v1").catch((error) => {
              console.warn("Authoritative account repair failed", serializeCallableError(error, {
                functionName: "account_initialize",
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                region: "us-central1",
              }));
            });
          }
        }
      },
      () => {
        console.warn("Authoritative user document listener failed");
        setUserDoc(null);
      }
    );

    return () => unsub();
  }, [initializeAccount, user]);

  const signIn = useCallback(async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await initializeAccount(credential.user, "sign-in-repair-v1");
  }, [initializeAccount]);

  const signUp = useCallback(async (email: string, password: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await initializeAccount(credential.user, "context-sign-up-v1");
  }, [initializeAccount]);

  const signOutFn = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const refreshClaims = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true);
      await fetchClaims(auth.currentUser);
    }
  }, [fetchClaims]);

  const role = (claims?.role as UserRole) ?? null;

  return (
    <AuthContext.Provider
      value={{ user, loading, claims, role, userDoc, signIn, signUp, signOut: signOutFn, refreshClaims }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
