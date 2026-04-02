// @refresh reset
import { createContext, useContext, useState, useEffect } from "react";
import { connectSocket, disconnectSocket } from "../socket/socketClient";
import { importPrivateKeyPem, importSigningPrivateKeyPem } from "../crypto/keyUtils";
import { getApiBaseUrl } from "../services/runtimeConfig";
import {
  clearSessionStorage,
  getLegacyKeyPair,
  getStoredKeyPair,
  migrateLegacyKeyPair,
  storeKeyPair,
} from "../services/keyStorage";

const AuthContext = createContext(null);

const API_URL = getApiBaseUrl().replace(/\/api$/, "");

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [token, setToken]             = useState(null);
  const [privateKey, setPrivateKey]   = useState(null);   // CryptoKey object (non-extractable)
  const [privateKeyPem, setPrivateKeyPem] = useState(null); // PEM string for storage
  const [publicKeyPem, setPublicKeyPem] = useState(null);   // Public PEM string
  const [signingKey, setSigningKey]   = useState(null);   // CryptoKey for RSA-PSS
  const [signingKeyPem, setSigningKeyPem] = useState(null); // Signing Private PEM string
  const [signingPublicKeyPem, setSigningPublicKeyPem] = useState(null); // Signing Public PEM string
  const [loading, setLoading]         = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [theme, setTheme]             = useState(() => localStorage.getItem("sc_theme") || "dark");

  // ── Boot: restore session from localStorage ────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sc_theme", theme);
  }, [theme]);

  useEffect(() => {
    const savedUser  = localStorage.getItem("sc_user");
    const savedToken = localStorage.getItem("sc_token");

    if (!savedUser || !savedToken) {
      setLoading(false);
      return;
    }

    const parsedUser = JSON.parse(savedUser);
    setUser(parsedUser);
    setToken(savedToken);
    setNeedsProfile(!parsedUser.isProfileCompleted);

    const storedKeys = getStoredKeyPair(parsedUser.email);
    const legacyKeys = !storedKeys.privateKeyPem ? getLegacyKeyPair() : null;
    const resolvedPrivateKeyPem = storedKeys.privateKeyPem || legacyKeys?.privateKeyPem || null;
    const resolvedPublicKeyPem = storedKeys.publicKeyPem || parsedUser.publicKey || legacyKeys?.publicKeyPem || null;

    if (legacyKeys?.privateKeyPem || legacyKeys?.publicKeyPem) {
      migrateLegacyKeyPair(parsedUser.email, resolvedPublicKeyPem);
    }

    if (resolvedPrivateKeyPem) {
      setPrivateKeyPem(resolvedPrivateKeyPem);
      setPublicKeyPem(resolvedPublicKeyPem || parsedUser.publicKey || null);
      importPrivateKeyPem(resolvedPrivateKeyPem)
        .then((key) => setPrivateKey(key))
        .catch(() => setPrivateKey(null));
    }

    if (storedKeys.signingKeyPem) {
      setSigningKeyPem(storedKeys.signingKeyPem);
      setSigningPublicKeyPem(storedKeys.signingPublicKeyPem || parsedUser.signingPublicKey || null);
      importSigningPrivateKeyPem(storedKeys.signingKeyPem)
        .then((key) => setSigningKey(key))
        .catch(() => setSigningKey(null));
    }

    // Connect socket immediately — token is already in localStorage
    connectSocket();

    // Always verify session with the server before routing
    fetch(`${API_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${savedToken}` },
    })
      .then((r) => r.json())
      .then((freshUser) => {
        if (freshUser._id) {
          setUser(freshUser);
          localStorage.setItem("sc_user", JSON.stringify(freshUser));
          setNeedsProfile(!freshUser.isProfileCompleted);
          storeKeyPair(freshUser.email, {
            privateKeyPem: resolvedPrivateKeyPem,
            signingKeyPem: storedKeys.signingKeyPem,
            publicKeyPem: freshUser.publicKey || resolvedPublicKeyPem,
          });
          setPublicKeyPem(freshUser.publicKey || resolvedPublicKeyPem);
          setSigningPublicKeyPem(freshUser.signingPublicKey || storedKeys.signingPublicKeyPem);
        }
      })
      .catch(() => {
        // Server unreachable — fall back to cached profile status
        setNeedsProfile(!parsedUser.isProfileCompleted);
      })
      .finally(() => {
        setLoading(false); // routing starts only after server confirms profile status
      });
  }, []);

  // ── Auth actions ───────────────────────────────────────────────────────────

  /**
   * Called after successful OTP verification.
   * Stores credentials, imports private key, and connects the socket.
   */
  const login = async (userData, authToken, pk, publicKeyPem = null, reqSigningKeyPem = null, reqSigningPubPem = null) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem("sc_user", JSON.stringify(userData));
    localStorage.setItem("sc_token", authToken);
    setNeedsProfile(!userData.isProfileCompleted);

    const storedKeys = getStoredKeyPair(userData.email);
    const legacyKeys = !storedKeys.privateKeyPem ? getLegacyKeyPair() : null;
    const resolvedPrivateKeyPem = pk || storedKeys.privateKeyPem || legacyKeys?.privateKeyPem || null;
    const resolvedSigningKeyPem = reqSigningKeyPem || storedKeys.signingKeyPem || null;
    const resolvedSigningPubPem = reqSigningPubPem || storedKeys.signingPublicKeyPem || userData.signingPublicKey || null;
    const resolvedPublicKeyPem =
      publicKeyPem ||
      storedKeys.publicKeyPem ||
      userData.publicKey ||
      legacyKeys?.publicKeyPem ||
      null;

    if (legacyKeys?.privateKeyPem || legacyKeys?.publicKeyPem) {
      migrateLegacyKeyPair(userData.email, resolvedPublicKeyPem);
    } else {
      storeKeyPair(userData.email, {
        privateKeyPem: resolvedPrivateKeyPem,
        signingKeyPem: resolvedSigningKeyPem,
        signingPublicKeyPem: resolvedSigningPubPem,
        publicKeyPem: resolvedPublicKeyPem,
      });
    }

    if (resolvedPrivateKeyPem) {
      setPrivateKeyPem(resolvedPrivateKeyPem);
      setPublicKeyPem(resolvedPublicKeyPem);
      const cryptoKey = await importPrivateKeyPem(resolvedPrivateKeyPem);
      setPrivateKey(cryptoKey);
    } else {
      setPrivateKeyPem(null);
      setPublicKeyPem(null);
      setPrivateKey(null);
    }

    if (resolvedSigningKeyPem) {
      setSigningKeyPem(resolvedSigningKeyPem);
      setSigningPublicKeyPem(resolvedSigningPubPem);
      const cryptoKey = await importSigningPrivateKeyPem(resolvedSigningKeyPem);
      setSigningKey(cryptoKey);
    } else {
      setSigningKeyPem(null);
      setSigningPublicKeyPem(null);
      setSigningKey(null);
    }

    // Connect socket now that the token is in localStorage
    connectSocket();
  };

  /**
   * Called after profile setup completes.
   * Updates the user object in state and localStorage.
   */
  const updateUser = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem("sc_user", JSON.stringify(updatedUser));
    if (typeof updatedUser.isProfileCompleted === "boolean") {
      setNeedsProfile(!updatedUser.isProfileCompleted);
    }
  };

  /**
   * Marks profile setup as done without a full user object update.
   */
  const completeProfile = () => {
    setNeedsProfile(false);
  };

  /**
   * Clears all session state and disconnects the socket.
   */
  const logout = () => {
    // Disconnect socket BEFORE clearing the token so the server
    // receives the disconnect event while the session is still valid
    disconnectSocket();

    setUser(null);
    setToken(null);
    setPrivateKey(null);
    setPrivateKeyPem(null);
    setPublicKeyPem(null);
    setSigningKey(null);
    setSigningKeyPem(null);
    setSigningPublicKeyPem(null);
    setNeedsProfile(false);

    clearSessionStorage();
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        privateKey,
        privateKeyPem,
        publicKeyPem,
        signingKey,
        signingKeyPem,
        signingPublicKeyPem,
        login,
        logout,
        updateUser,
        needsProfile,
        completeProfile,
        loading,
        theme,
        toggleTheme,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
