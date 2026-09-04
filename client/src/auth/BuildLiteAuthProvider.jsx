import {ClerkProvider,Show,SignIn,useAuth} from '@clerk/react';
import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {configureAuthenticatedFetch} from './authenticatedFetch';

const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
const BuildLitePrincipalContext=createContext(null);

export function useBuildLitePrincipal(){return useContext(BuildLitePrincipalContext);}
export function useBuildLitePermission(permission){
  const principal=useBuildLitePrincipal();
  return Array.isArray(principal?.permissions)&&principal.permissions.includes(permission);
}

function AuthenticatedShell({children}){
  const {getToken}=useAuth();
  const [ready,setReady]=useState(false),[principal,setPrincipal]=useState(null),[authorizationError,setAuthorizationError]=useState('');
  useEffect(()=>{configureAuthenticatedFetch(getToken);setReady(true);},[getToken]);
  useEffect(()=>{if(!ready)return;fetch(`${API_BASE}/api/auth/me`).then(async response=>{if(!response.ok)throw new Error(response.status===403?'Your BuildLite account has no active tenant membership.':'Your BuildLite session could not be established.');return response.json();}).then(setPrincipal).catch(error=>setAuthorizationError(error.message));},[ready]);
  useEffect(()=>{const show=event=>setAuthorizationError(event.detail?.status===403?'You do not have permission to perform that action.':'Your session has expired. Please sign in again.');globalThis.addEventListener('buildlite:authorization-error',show);return()=>globalThis.removeEventListener('buildlite:authorization-error',show);},[]);
  const contextValue=useMemo(()=>principal,[principal]);
  if(!ready||(!principal&&!authorizationError))return <main className="auth-loading">Establishing secure BuildLite session…</main>;
  if(authorizationError&&!principal)return <main className="auth-configuration"><h1>BuildLite access unavailable</h1><p>{authorizationError}</p></main>;
  return <BuildLitePrincipalContext.Provider value={contextValue}><div className="buildlite-auth-status" role="status">{`Signed in as ${principal.user.displayName} · ${principal.activeTenant.roleName}`}</div>{authorizationError&&<div className="buildlite-auth-error" role="alert">{authorizationError}</div>}{children}</BuildLitePrincipalContext.Provider>;
}

export default function BuildLiteAuthProvider({children}){
  const publishableKey=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if(!publishableKey)return <main className="auth-configuration"><h1>BuildLite authentication is not configured</h1><p>Set VITE_CLERK_PUBLISHABLE_KEY for this environment.</p></main>;
  const returnUrl=typeof window==='undefined'?'/':`${window.location.pathname}${window.location.search}`;
  return <ClerkProvider publishableKey={publishableKey} signInFallbackRedirectUrl={returnUrl}>
    <Show when="signed-out"><main className="auth-sign-in"><SignIn withSignUp={false}/></main></Show>
    <Show when="signed-in"><AuthenticatedShell>{children}</AuthenticatedShell></Show>
  </ClerkProvider>;
}
