import { createContext, useContext, useEffect, useState } from 'react';
import {
  init, subscribe, signIn, signOut as gisSignOut, getState,
  isConfigured as gisConfigured,
  grantedScope, SCOPES_REQUESTED,
} from '../auth/gis.js';
import { resetSyncToken } from '../api/calendarApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const configured = gisConfigured();
  const [gisState, setGisState] = useState(getState());
  const [bootLoading, setBootLoading] = useState(true);

  useEffect(() => {
    if (!configured) { setBootLoading(false); return; }
    init()
      .catch((err) => console.error('GIS init failed:', err))
      .finally(() => setBootLoading(false));
    return subscribe(setGisState);
  }, [configured]);

  const user = gisState.accessToken
    ? {
        accessToken: gisState.accessToken,
        expiresAt:   gisState.expiresAt,
        scopes:      gisState.scopes,
        profile:     gisState.profile,
      }
    : null;

  const value = {
    user,
    profile:           gisState.profile,
    loading:           bootLoading || gisState.loading,
    error:             gisState.error,
    login:             signIn,
    signOut:           () => { resetSyncToken('primary'); gisSignOut(); },
    configured,
    grantedScope:      (s) => grantedScope(s),
    scopesRequested:   SCOPES_REQUESTED,
    fullyAuthorized:   user ? SCOPES_REQUESTED.every((s) => user.scopes.includes(s)) : false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
